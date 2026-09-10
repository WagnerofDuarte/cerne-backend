// T-022 — Backfill dos embeddings reais da conta A do seed.
//
// seed.sql insere as entradas da conta A com embedding_status='pending'
// porque SQL puro não faz chamada HTTP (ver supabase/seed/ancora.md para o
// motivo completo). Este script roda uma vez, depois de `supabase db
// reset`, chama a Voyage (voyage-4, 1024 dimensões, input_type='document')
// para cada entrada ainda pendente da conta A, e grava o embedding real.
//
// Idempotente: só processa linhas com embedding_status='pending'. Rodar de
// novo depois que tudo já está 'ready' não faz nada. A entrada
// propositalmente 'failed' (T-022) nunca é tocada — não faz parte do
// filtro.
//
// Conecta direto no Postgres local (mesma abordagem do prove-rf06.ts), não
// via API/PostgREST — evita depender de qualquer formato específico de
// chave (anon/service_role clássica, ou o esquema novo
// publishable/secret) mapear corretamente para o papel com privilégio
// total. Conectar como `postgres` (o superusuário do banco local) ignora a
// RLS de forma garantida, sem ambiguidade.
//
// Achado real (Wagner, T-062, 1ª execução completa do teste de
// determinismo): antes desta versão, este script chamava
// `ai/voyage.ts::callVoyageRaw` direto, FORA do cache de replay — cada
// `db reset` (a cada uma das 3 passadas de `tests/determinism/run.sh`)
// disparava uma chamada nova e real à Voyage para as mesmas 33 entradas.
// A Voyage não garante o mesmo vetor bit a bit em duas chamadas (mesmo
// texto, mesmo modelo) — resultado: `entries-search` (RF06) devolvia a
// MESMA entrada, na MESMA ordem, mas com um `similarity` sutilmente
// diferente entre `ciclo-a`/`ciclo-b` (0,4852 vs 0,4845 — real, não
// arredondamento de ponto flutuante) — derrubando a comparação byte a
// byte por um campo que a Voyage nunca prometeu manter estável, não um
// bug de determinismo do projeto.
//
// Corrigido religando este script ao MESMO cache de replay do resto do
// projeto: reaproveita `generateEntryEmbedding` (a função exata que
// `POST /entries`, T-037, usa) e implementa `lookup`/`store` (`ReplayDeps`)
// direto contra `experiment.ai_replay_cache` — mesma tabela das RPCs da
// migração 0010, só sem passar pelo PostgREST (este script já tem acesso
// de superusuário, então SQL direto é equivalente e evita reimplementar a
// própria RPC aqui). Na 1ª vez que um texto é embutido (miss), chama a
// Voyage de verdade e grava; em qualquer `db reset` seguinte, dado que o
// texto das 33 entradas do seed nunca muda, a MESMA chave de cache bate —
// o vetor gravado na 1ª vez é reaproveitado sempre, byte a byte.
//
// Uso:
//   deno run --allow-net --allow-env scripts/backfill-seed-embeddings.ts
//
// Variáveis de ambiente:
//   VOYAGE_API_KEY
//   PROMPT_VERSION   (mesmo valor usado pelo `supabase/.env.local` — entra
//                      no envelope canônico do cache, precisa bater com o
//                      resto do projeto para a chave ficar consistente)
//   SUPABASE_DB_URL  (default: postgresql://postgres:postgres@127.0.0.1:54322/postgres —
//                      a "Database URL" que o `supabase status` imprime)

import postgres from "postgres";
import { generateEntryEmbedding } from "../supabase/functions/entries-create/embedding.ts";
import type { ReplayDeps } from "../supabase/functions/_shared/replay.ts";

const VOYAGE_API_KEY = Deno.env.get("VOYAGE_API_KEY");
const PROMPT_VERSION = Deno.env.get("PROMPT_VERSION");
const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CONTA_A_USER_ID = "a0000000-0000-0000-0000-000000000001";

if (!VOYAGE_API_KEY) {
  console.error("Falta a variável de ambiente VOYAGE_API_KEY.");
  Deno.exit(1);
}
if (!PROMPT_VERSION) {
  console.error(
    "Falta a variável de ambiente PROMPT_VERSION (mesmo valor do supabase/.env.local).",
  );
  Deno.exit(1);
}

/**
 * Mesma leitura/gravação das RPCs `experiment_replay_cache_lookup`/
 * `_store` (migração 0010), direto na tabela — este script já conecta
 * como superusuário. `onHit` só existe para o resumo impresso no fim
 * (quantas das 33 vieram do cache vs. chamaram a Voyage de verdade).
 */
function buildReplayDeps(sql: postgres.Sql, onHit: () => void): ReplayDeps {
  return {
    mode: "record",
    async lookup(cacheKey) {
      const rows = await sql<{ response: unknown; hit_count: number }[]>`
        update experiment.ai_replay_cache
        set hit_count = hit_count + 1
        where cache_key = ${cacheKey}
        returning response, hit_count
      `;
      const row = rows[0];
      if (!row) return null;
      onHit();
      return { response: row.response, hitCount: row.hit_count };
    },
    async store(args) {
      await sql`
        insert into experiment.ai_replay_cache
          (cache_key, operation, provider, model, prompt_version, request_envelope, response)
        values
          (${args.cacheKey}, ${args.operation}, ${args.provider}, ${args.model},
           ${args.promptVersion}, ${
        sql.json(args.requestEnvelope as unknown as postgres.JSONValue)
      },
           ${sql.json(args.response as postgres.JSONValue)})
        on conflict (cache_key) do nothing
      `;
    },
  };
}

async function main() {
  const sql = postgres(DB_URL);

  try {
    // o tipo vector e os operadores do pgvector moram no schema extensions
    await sql`set search_path to public, extensions`;

    const pendentes = await sql`
      select id, content
      from entries
      where user_id = ${CONTA_A_USER_ID} and embedding_status = 'pending'
    `;

    if (pendentes.length === 0) {
      console.log(
        "Nenhuma entrada pendente — nada a fazer (já rodou antes, ou o seed não foi carregado).",
      );
      return;
    }

    console.log(
      `Encontradas ${pendentes.length} entradas pendentes. Embutindo (atrás do cache de replay)...`,
    );

    let ok = 0;
    let falhas = 0;
    let hits = 0;
    const replay = buildReplayDeps(sql, () => hits++);

    for (const entry of pendentes) {
      const result = await generateEntryEmbedding(entry.content, PROMPT_VERSION!, {
        voyageApiKey: VOYAGE_API_KEY!,
        replay,
      });

      if (result.status === "failed") {
        falhas++;
        console.error(
          `  ❌ ${entry.id}: Voyage falhou (ver embedding.ts, motivo não propagado por design)`,
        );
        continue;
      }

      const vectorLiteral = `[${result.embedding.join(",")}]`;
      await sql`
        update entries
        set embedding = ${vectorLiteral}::vector,
            embedding_model = ${result.model},
            embedding_dim = ${result.dimension},
            embedding_input_type = ${result.inputType},
            embedding_status = 'ready'
        where id = ${entry.id}
      `;

      ok++;
      console.log(`  ✅ ${entry.id}`);
    }

    console.log(`\nConcluído: ${ok} embeddings gravados, ${falhas} falhas.`);
    if (hits > 0) console.log(`(${hits} vieram do cache de replay, sem chamar a Voyage de novo)`);
    if (falhas > 0) Deno.exit(1);
  } finally {
    await sql.end();
  }
}

await main();
