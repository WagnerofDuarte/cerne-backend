#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// T-061 — Exporta o cache de replay (`experiment.ai_replay_cache`) de um
// ambiente (Plano técnico §12, passo 6: "Executar o roteiro em `record` no
// `ciclo-a`; exportar o cache").
//
// Conecta direto no Postgres, mesma abordagem de `backfill-seed-
// embeddings.ts`/`prove-rf06.ts` (T-022/T-024) — `experiment` não é exposto
// via PostgREST (migração 0010, decisão registrada inline lá), então não
// existe rota de API para isso; só acesso direto ao banco resolve, e
// conectar como `postgres` (superusuário local) evita qualquer ambiguidade
// de papel/RLS.
//
// Formato do arquivo: um JSON array de linhas de `ai_replay_cache`,
// ordenado por `cache_key` (determinístico — duas exportações do mesmo
// estado de cache produzem o mesmo arquivo byte a byte, útil pra diff/
// conferência manual antes de importar em `ciclo-b`). `hit_count` e
// `created_at` são exportados por completude/auditoria, mas o import
// (`replay-cache-import.ts`) os ignora deliberadamente — ver esse arquivo.
//
// Uso:
//   deno run -A scripts/replay-cache-export.ts --out cache-ciclo-a.json
//
// Variável de ambiente:
//   SUPABASE_DB_URL (default: postgresql://postgres:postgres@127.0.0.1:54322/postgres —
//                     a "Database URL" que `supabase status` imprime; para
//                     exportar de `ciclo-a`/`ciclo-b`, apontar para o
//                     Postgres DESSE projeto, nunca do `dev` local)

import postgres from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export interface ReplayCacheRow {
  readonly cache_key: string;
  readonly operation: string;
  readonly provider: string;
  readonly model: string;
  readonly prompt_version: string;
  readonly request_envelope: unknown;
  readonly response: unknown;
  readonly hit_count: number;
  readonly created_at: string;
}

function parseArgs(argv: string[]): { out: string } {
  const idx = argv.indexOf("--out");
  const out = idx !== -1 ? argv[idx + 1] : undefined;
  if (!out) {
    console.error("Uso: deno run -A scripts/replay-cache-export.ts --out <arquivo.json>");
    Deno.exit(1);
  }
  return { out };
}

export async function exportReplayCache(dbUrl: string): Promise<ReplayCacheRow[]> {
  const sql = postgres(dbUrl);
  try {
    const rows = await sql<ReplayCacheRow[]>`
      select cache_key, operation, provider, model, prompt_version,
             request_envelope, response, hit_count, created_at
      from experiment.ai_replay_cache
      order by cache_key
    `;
    return rows;
  } finally {
    await sql.end();
  }
}

async function main() {
  const { out } = parseArgs(Deno.args);

  console.log(`Conectando em ${DB_URL.replace(/:[^:@]*@/, ":***@")}...`);
  const rows = await exportReplayCache(DB_URL);

  if (rows.length === 0) {
    console.error(
      "experiment.ai_replay_cache está vazia — nada a exportar. " +
        "Rodou o roteiro em modo `record` (T-060) contra este ambiente antes?",
    );
    Deno.exit(1);
  }

  await Deno.writeTextFile(out, JSON.stringify(rows, null, 2) + "\n");

  const totalHits = rows.reduce((sum, r) => sum + r.hit_count, 0);
  const porOperacao = new Map<string, number>();
  for (const r of rows) porOperacao.set(r.operation, (porOperacao.get(r.operation) ?? 0) + 1);

  console.log(`\n${rows.length} entradas exportadas para ${out}.`);
  console.log(`hit_count somado (no ambiente de origem): ${totalHits}.`);
  console.log("Por operação:");
  for (const [op, count] of [...porOperacao.entries()].sort()) {
    console.log(`  ${op}: ${count}`);
  }
}

if (import.meta.main) {
  await main();
}
