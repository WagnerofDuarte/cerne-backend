#!/usr/bin/env -S deno run --allow-net --allow-env --allow-write
// T-064 (Fase 7, Plano técnico §12 passo 3) — "Gerar hash do schema dos três
// ambientes e confirmar que são idênticos".
//
// Este script não existia em nenhuma fase anterior — nenhuma tarefa até a
// Fase 6 precisou comparar estrutura entre ambientes (só `dev` foi tocado;
// `ciclo-a`/`ciclo-b` estreiam nesta fase). Conecta direto no Postgres do
// ambiente indicado (mesmo padrão de `replay-cache-export.ts`/`backfill-
// seed-embeddings.ts` — `experiment` não é exposto via PostgREST, e ler
// catálogo do sistema também não tem rota de API), introspecciona só o que
// as migrações deste projeto criam (schemas `public` e `experiment` — nunca
// `auth`/`storage`/`extensions`/`pgmq`/`cron`/`net`, que são internos do
// Supabase/das extensões e não são "nossa estrutura"), e produz:
//   1. um texto canônico (determinístico: mesma consulta SQL com ORDER BY
//      completo, sem valor de linha nenhum — só forma, nunca dado de
//      usuário) que pode ser salvo e comparado com `diff` comum se dois
//      hashes não baterem;
//   2. um hash SHA-256 desse texto, para comparar de cabeça (bateu = uma
//      linha idêntica; não bateu = abrir os dois arquivos e rodar `diff`).
//
// O que entra na comparação, e por quê:
//   - extensões instaladas (nome+versão) — só as que 0001_extensions.sql/
//     0014_export_queue.sql declaram; outras que o Supabase instala por
//     padrão (plpgsql, pg_stat_statements, supabase_vault, ...) não são
//     nossas e podem legitimamente variar entre projetos sem significar
//     schema divergente.
//   - tabelas + colunas (tipo exato via format_type, nullability, default)
//   - RLS: `relrowsecurity`/`relforcerowsecurity` por tabela (regra
//     inviolável: toda tabela com dono tem as duas ligadas)
//   - constraints (PK/UNIQUE/CHECK/FK) via `pg_get_constraintdef`
//   - índices via `pg_get_indexdef` — inclui o índice único parcial de
//     idempotência (T-014) e a UNIQUE de `insights` (T-016) na forma exata
//   - triggers via `pg_get_triggerdef`
//   - funções (só as de `public`/`experiment` — funções de extensão vivem
//     no schema da própria extensão, então o filtro de schema já as
//     exclui) via `pg_get_functiondef`
//   - políticas de RLS via `pg_policies` (qual/with_check já vêm como texto)
//   - grants de tabela para `anon`/`authenticated`/`service_role`/`PUBLIC`
//     — é o que comprova (ou não) o `REVOKE ALL FROM anon` da migração
//     0009 e os `REVOKE ... FROM PUBLIC` da 0010 (achado real do T-029/
//     T-030, documentado no encerramento da Fase 2)
//
// Bônus deliberado: falha alto e explicado se qualquer índice usar
// `USING hnsw`/`USING ivfflat` — checagem direta da regra inviolável nº7
// ("nunca criar índice vetorial aproximado"), não só uma comparação cega.
//
// NÃO cobre (limitação documentada, não escondida): EXECUTE de função por
// role (o "nasce PUBLIC por padrão" que pegou a migração 0010) fica de fora
// — só grants de TABELA. Se um dia importar comparar isso também, é uma
// extensão natural deste mesmo arquivo.
//
// Uso (uma vez por ambiente — `dev` primeiro, contra Docker local; depois
// `ciclo-a`/`ciclo-b` contra a Connection String de cada projeto, nunca a
// mesma URL duas vezes):
//   SUPABASE_DB_URL=<postgres do ambiente> \
//     deno run -A scripts/schema-hash.ts --out /tmp/schema-dev.txt
//
// Comparar dois ambientes: o hash impresso no stdout já resolve o critério
// ("confirmar que são idênticos") sem abrir nada. Se os hashes não
// baterem, `diff /tmp/schema-a.txt /tmp/schema-b.txt` mostra exatamente
// onde.
//
// Variável de ambiente:
//   SUPABASE_DB_URL (default: postgresql://postgres:postgres@127.0.0.1:54322/postgres —
//                     a "Database URL" que `supabase status` imprime)

import postgres from "postgres";

const DEFAULT_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// Allowlist fechada — reflete exatamente o que 0001_extensions.sql e
// 0014_export_queue.sql declaram. Não usar `select * from pg_extension`:
// isso pegaria extensões do próprio Supabase que não são "nossa estrutura".
const OUR_EXTENSIONS = ["pgcrypto", "vector", "pgtap", "pg_cron", "pgmq", "pg_net"] as const;
const OUR_SCHEMAS = ["public", "experiment"] as const;

export interface ExtensionRow {
  readonly extname: string;
  readonly extversion: string;
}

export interface ColumnRow {
  readonly table_schema: string;
  readonly table_name: string;
  readonly column_name: string;
  readonly ordinal_position: number;
  readonly is_nullable: "YES" | "NO";
  readonly column_default: string | null;
  readonly data_type: string;
}

export interface TableRlsRow {
  readonly table_schema: string;
  readonly table_name: string;
  readonly rls_enabled: boolean;
  readonly rls_forced: boolean;
}

export interface ConstraintRow {
  readonly table_schema: string;
  readonly table_name: string;
  readonly constraint_name: string;
  readonly constraint_type: string;
  readonly definition: string;
}

export interface IndexRow {
  readonly schema_name: string;
  readonly table_name: string;
  readonly index_name: string;
  readonly definition: string;
}

export interface TriggerRow {
  readonly schema_name: string;
  readonly table_name: string;
  readonly trigger_name: string;
  readonly definition: string;
}

export interface FunctionRow {
  readonly schema_name: string;
  readonly function_name: string;
  readonly args: string;
  readonly definition: string;
}

export interface PolicyRow {
  readonly schemaname: string;
  readonly tablename: string;
  readonly policyname: string;
  readonly permissive: string;
  readonly roles: string[];
  readonly cmd: string;
  readonly qual: string | null;
  readonly with_check: string | null;
}

export interface GrantRow {
  readonly table_schema: string;
  readonly table_name: string;
  readonly grantee: string;
  readonly privilege_type: string;
}

export interface SchemaSnapshot {
  readonly extensions: ExtensionRow[];
  readonly columns: ColumnRow[];
  readonly tableRls: TableRlsRow[];
  readonly constraints: ConstraintRow[];
  readonly indexes: IndexRow[];
  readonly triggers: TriggerRow[];
  readonly functions: FunctionRow[];
  readonly policies: PolicyRow[];
  readonly grants: GrantRow[];
}

export async function fetchSchemaSnapshot(dbUrl: string): Promise<SchemaSnapshot> {
  const sql = postgres(dbUrl);
  try {
    const [
      extensions,
      columns,
      tableRls,
      constraints,
      indexes,
      triggers,
      functions,
      policies,
      grants,
    ] = await Promise.all([
      sql<ExtensionRow[]>`
          select extname, extversion
          from pg_extension
          where extname in ${sql(OUR_EXTENSIONS)}
          order by extname
        `,
      sql<ColumnRow[]>`
          select n.nspname as table_schema,
                 cl.relname as table_name,
                 a.attname as column_name,
                 a.attnum as ordinal_position,
                 case when a.attnotnull then 'NO' else 'YES' end as is_nullable,
                 pg_get_expr(ad.adbin, ad.adrelid) as column_default,
                 format_type(a.atttypid, a.atttypmod) as data_type
          from pg_attribute a
          join pg_class cl on cl.oid = a.attrelid
          join pg_namespace n on n.oid = cl.relnamespace
          left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
          where n.nspname in ${sql(OUR_SCHEMAS)}
            and cl.relkind = 'r'
            and a.attnum > 0
            and not a.attisdropped
          order by n.nspname, cl.relname, a.attnum
        `,
      sql<TableRlsRow[]>`
          select n.nspname as table_schema, cl.relname as table_name,
                 cl.relrowsecurity as rls_enabled, cl.relforcerowsecurity as rls_forced
          from pg_class cl
          join pg_namespace n on n.oid = cl.relnamespace
          where n.nspname in ${sql(OUR_SCHEMAS)} and cl.relkind = 'r'
          order by n.nspname, cl.relname
        `,
      sql<ConstraintRow[]>`
          select n.nspname as table_schema, cl.relname as table_name,
                 con.conname as constraint_name, con.contype::text as constraint_type,
                 pg_get_constraintdef(con.oid) as definition
          from pg_constraint con
          join pg_class cl on cl.oid = con.conrelid
          join pg_namespace n on n.oid = cl.relnamespace
          where n.nspname in ${sql(OUR_SCHEMAS)}
          order by n.nspname, cl.relname, con.conname
        `,
      sql<IndexRow[]>`
          select n.nspname as schema_name, cl.relname as table_name,
                 ic.relname as index_name,
                 pg_get_indexdef(i.indexrelid) as definition
          from pg_index i
          join pg_class cl on cl.oid = i.indrelid
          join pg_class ic on ic.oid = i.indexrelid
          join pg_namespace n on n.oid = cl.relnamespace
          where n.nspname in ${sql(OUR_SCHEMAS)}
          order by n.nspname, cl.relname, ic.relname
        `,
      sql<TriggerRow[]>`
          select n.nspname as schema_name, cl.relname as table_name,
                 t.tgname as trigger_name,
                 pg_get_triggerdef(t.oid) as definition
          from pg_trigger t
          join pg_class cl on cl.oid = t.tgrelid
          join pg_namespace n on n.oid = cl.relnamespace
          where n.nspname in ${sql(OUR_SCHEMAS)} and not t.tgisinternal
          order by n.nspname, cl.relname, t.tgname
        `,
      sql<FunctionRow[]>`
          select n.nspname as schema_name, p.proname as function_name,
                 pg_get_function_identity_arguments(p.oid) as args,
                 pg_get_functiondef(p.oid) as definition
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ${sql(OUR_SCHEMAS)}
          order by n.nspname, p.proname, args
        `,
      sql<PolicyRow[]>`
          select schemaname, tablename, policyname, permissive, roles::text[], cmd,
                 qual, with_check
          from pg_policies
          where schemaname in ${sql(OUR_SCHEMAS)}
          order by schemaname, tablename, policyname
        `,
      sql<GrantRow[]>`
          select table_schema, table_name, grantee, privilege_type
          from information_schema.role_table_grants
          where table_schema in ${sql(OUR_SCHEMAS)}
            and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
          order by table_schema, table_name, grantee, privilege_type
        `,
    ]);

    return {
      extensions,
      columns,
      tableRls,
      constraints,
      indexes,
      triggers,
      functions,
      policies,
      grants,
    };
  } finally {
    await sql.end();
  }
}

/** Regra inviolável nº7: nunca índice vetorial aproximado. Falha alto, não silencioso. */
export function assertNoApproximateVectorIndexes(indexes: readonly IndexRow[]): void {
  const offenders = indexes.filter((i) => /using\s+(hnsw|ivfflat)/i.test(i.definition));
  if (offenders.length > 0) {
    const lista = offenders.map((o) => `${o.schema_name}.${o.index_name}`).join(", ");
    throw new Error(
      `Regra inviolável nº7 violada: índice(s) vetorial(is) aproximado(s) encontrado(s): ${lista}. ` +
        `Varredura exata é obrigatória para determinismo — ver apêndice do big-plan.md.`,
    );
  }
}

function block(title: string, rows: readonly unknown[]): string {
  const lines = rows.map((r) => JSON.stringify(r));
  return `## ${title} (${lines.length})\n${lines.join("\n")}`;
}

/**
 * Texto canônico e determinístico do snapshot: mesma entrada -> mesma
 * saída, sempre, byte a byte. Não reordena nada (confia no ORDER BY
 * completo de cada consulta) — se uma consulta um dia perder o desempate
 * final, o sintoma vira "hash não bate entre duas execuções contra o MESMO
 * banco", fácil de perceber.
 */
export function canonicalize(s: SchemaSnapshot): string {
  return (
    [
      block("extensions", s.extensions),
      block("tables.columns", s.columns),
      block("tables.rls", s.tableRls),
      block("constraints", s.constraints),
      block("indexes", s.indexes),
      block("triggers", s.triggers),
      block("functions", s.functions),
      block("policies", s.policies),
      block("grants", s.grants),
    ].join("\n\n") + "\n"
  );
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parseArgs(argv: string[]): { out?: string } {
  const idx = argv.indexOf("--out");
  return { out: idx !== -1 ? argv[idx + 1] : undefined };
}

async function main() {
  const dbUrl = Deno.env.get("SUPABASE_DB_URL") ?? DEFAULT_DB_URL;
  const { out } = parseArgs(Deno.args);

  console.log(`Conectando em ${dbUrl.replace(/:[^:@]*@/, ":***@")}...`);
  const snapshot = await fetchSchemaSnapshot(dbUrl);
  assertNoApproximateVectorIndexes(snapshot.indexes);

  const canonical = canonicalize(snapshot);
  const hash = await sha256Hex(canonical);

  console.log(`\nhash: ${hash}`);
  console.log(
    `(extensões=${snapshot.extensions.length}, colunas=${snapshot.columns.length}, ` +
      `tabelas com RLS=${snapshot.tableRls.length}, constraints=${snapshot.constraints.length}, ` +
      `índices=${snapshot.indexes.length}, triggers=${snapshot.triggers.length}, ` +
      `funções=${snapshot.functions.length}, políticas=${snapshot.policies.length}, ` +
      `grants=${snapshot.grants.length})`,
  );

  if (out) {
    await Deno.writeTextFile(out, canonical);
    console.log(`\nDump canônico salvo em ${out}.`);
    console.log(
      "Para achar exatamente onde dois ambientes divergem (se os hashes não baterem): " +
        `diff <arquivo-do-ambiente-A> <arquivo-do-ambiente-B>.`,
    );
  }
}

if (import.meta.main) {
  await main();
}
