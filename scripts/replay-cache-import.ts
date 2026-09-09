#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// T-061 — Importa o cache de replay exportado por `replay-cache-export.ts`
// para outro ambiente (Plano técnico §12, passo 6: "...importar o mesmo
// cache no `ciclo-b`"). Ver esse arquivo para o formato/motivo da conexão
// direta ao Postgres.
//
// Salvaguarda central deste script (o motivo de ele existir, não só um
// `psql -c "copy ..."` qualquer): o big-plan.md e o plano técnico (§12)
// são explícitos — "gravar o cache duas vezes (uma por ciclo) anula todo o
// mecanismo de determinismo". Por padrão, este script se RECUSA a importar
// se o destino já tiver qualquer linha em `ai_replay_cache` — o cenário
// real que essa recusa evita é `ciclo-b` ter rodado o roteiro em `record`
// por engano (em vez de só receber o cache importado), o que geraria
// respostas de IA PRÓPRIAS de `ciclo-b`, diferentes das de `ciclo-a` line a
// linha (a IA não é determinística entre chamadas reais) — os dois ciclos
// deixariam de ser comparáveis sem que nada no HTTP acuse isso (nenhuma das
// duas execuções erraria `REPLAY_MISS` sozinha). `--force` existe só para
// o caso deliberado de reimportar depois de um `db reset` (destino
// legitimamente vazio de novo, mas alguém já rodou este script antes nesta
// sessão de terminal) — usar com o mesmo cuidado do `--force` de git.
//
// `hit_count`/`created_at` do arquivo são IGNORADOS de propósito na
// importação — não fazem parte da identidade semântica de uma entrada de
// cache (`cache_key` → `response`), só telemetria de uso do ambiente que
// gravou. Copiar o `hit_count` de origem misturaria o uso de `ciclo-a` com
// o de `ciclo-b`; cada ambiente conta os próprios hits a partir de 0,
// pela mesma RPC (`experiment_replay_cache_lookup`) que qualquer chamada a
// IA atrás do cache já usa.
//
// Uso:
//   deno run -A scripts/replay-cache-import.ts --in cache-ciclo-a.json [--force]
//
// Variável de ambiente:
//   SUPABASE_DB_URL (default: postgresql://postgres:postgres@127.0.0.1:54322/postgres;
//                     apontar para o Postgres do ambiente DE DESTINO, ex. `ciclo-b`)

import postgres from "postgres";
import type { ReplayCacheRow } from "./replay-cache-export.ts";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

function parseArgs(argv: string[]): { in: string; force: boolean } {
  const idx = argv.indexOf("--in");
  const input = idx !== -1 ? argv[idx + 1] : undefined;
  if (!input) {
    console.error(
      "Uso: deno run -A scripts/replay-cache-import.ts --in <arquivo.json> [--force]",
    );
    Deno.exit(1);
  }
  return { in: input, force: argv.includes("--force") };
}

export interface ImportResult {
  readonly inserted: number;
  readonly alreadyPresent: number;
}

/**
 * `sql` já deve estar conectado ao destino correto — esta função não abre/
 * fecha a conexão (facilita testar contra um client injetado).
 */
export async function importReplayCache(
  sql: postgres.Sql,
  rows: readonly ReplayCacheRow[],
  opts: { force: boolean },
): Promise<ImportResult> {
  const [{ count }] = await sql<[{ count: string }]>`
    select count(*)::text as count from experiment.ai_replay_cache
  `;
  const existing = Number(count);

  if (existing > 0 && !opts.force) {
    throw new Error(
      `experiment.ai_replay_cache do destino já tem ${existing} linha(s). ` +
        "Importar por cima arrisca misturar cache de dois ciclos (ver comentário " +
        "no topo deste arquivo) — recusado. Se isso é intencional (ex.: reimportar " +
        "depois de um `db reset` real), rode de novo com --force.",
    );
  }

  let inserted = 0;
  let alreadyPresent = 0;

  await sql.begin(async (tx) => {
    for (const row of rows) {
      const result = await tx`
        insert into experiment.ai_replay_cache
          (cache_key, operation, provider, model, prompt_version, request_envelope, response)
        values
          (${row.cache_key}, ${row.operation}, ${row.provider}, ${row.model},
           ${row.prompt_version}, ${tx.json(row.request_envelope as postgres.JSONValue)},
           ${tx.json(row.response as postgres.JSONValue)})
        on conflict (cache_key) do nothing
      `;
      if (result.count > 0) inserted++;
      else alreadyPresent++;
    }
  });

  return { inserted, alreadyPresent };
}

async function main() {
  const { in: inputPath, force } = parseArgs(Deno.args);

  const raw = await Deno.readTextFile(inputPath);
  const rows = JSON.parse(raw) as ReplayCacheRow[];
  if (!Array.isArray(rows) || rows.length === 0) {
    console.error(`${inputPath} não contém um array de linhas de cache não-vazio.`);
    Deno.exit(1);
  }

  console.log(`Conectando em ${DB_URL.replace(/:[^:@]*@/, ":***@")}...`);
  const sql = postgres(DB_URL);
  try {
    const { inserted, alreadyPresent } = await importReplayCache(sql, rows, { force });
    console.log(`\n${inserted} entradas novas importadas de ${inputPath}.`);
    if (alreadyPresent > 0) {
      console.log(`${alreadyPresent} já existiam no destino (cache_key repetida) — ignoradas.`);
    }
    if (inserted + alreadyPresent !== rows.length) {
      // Não deveria acontecer (todo `cache_key` do arquivo é único, é PK na
      // origem) — se acontecer, o arquivo de entrada está corrompido/editado à mão.
      console.error(
        `Aviso: ${rows.length} linhas no arquivo, mas só ${inserted + alreadyPresent} contabilizadas.`,
      );
    }
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  await main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    Deno.exit(1);
  });
}
