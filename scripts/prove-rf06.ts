// T-024 — Prova do RF06: busca semântica encontra o par plantado.
//
// Ferramenta de validação da Fase 1, não o endpoint de produção (esse é o
// GET /entries/search, T-040, Fase 3) — usa uma conexão direta ao Postgres
// local porque o endpoint ainda não existe neste ponto do checklist.
//
// Pré-requisito: rodar scripts/backfill-seed-embeddings.ts antes (os 3
// pares só têm embedding real depois do backfill).
//
// Regra de aceite (Plano técnico §6.4): pelo menos 1 dos 3 pares precisa
// aparecer no top-5 da busca pelo termo correspondente. Se os três
// falharem, é condição de viabilidade do RF06 — parar e reportar, não é
// detalhe.
//
// Uso:
//   deno run --allow-net --allow-env scripts/prove-rf06.ts
//
// Variáveis de ambiente:
//   VOYAGE_API_KEY
//   SUPABASE_DB_URL   (default: postgresql://postgres:postgres@127.0.0.1:54322/postgres —
//                       a conexão padrão do `supabase start` local)

import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";

const VOYAGE_API_KEY = Deno.env.get("VOYAGE_API_KEY");
const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CONTA_A_USER_ID = "a0000000-0000-0000-0000-000000000001";
const VOYAGE_MODEL = "voyage-4";
const VOYAGE_OUTPUT_DIMENSION = 1024;
const TOP_K = 5;

// par -> termo buscado -> id da entrada plantada em seed.sql
const PARES = [
  { par: 1, termo: "ansiedade", entryId: "a0000000-0000-0000-0004-000000000003" },
  { par: 2, termo: "cansaço", entryId: "a0000000-0000-0000-0004-000000000004" },
  { par: 3, termo: "gratidão", entryId: "a0000000-0000-0000-0004-000000000005" },
];

if (!VOYAGE_API_KEY) {
  console.error("Falta a variável de ambiente VOYAGE_API_KEY.");
  Deno.exit(1);
}

async function embedQuery(text: string): Promise<number[]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      input: [text],
      model: VOYAGE_MODEL,
      input_type: "query",
      output_dimension: VOYAGE_OUTPUT_DIMENSION,
    }),
  });
  if (!res.ok) {
    throw new Error(`Voyage respondeu ${res.status}: ${await res.text()}`);
  }
  const body = await res.json();
  const embedding = body?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length !== VOYAGE_OUTPUT_DIMENSION) {
    throw new Error(`Resposta da Voyage não tem ${VOYAGE_OUTPUT_DIMENSION} floats.`);
  }
  return embedding;
}

async function main() {
  const sql = postgres(DB_URL);
  let algumParPassou = false;

  try {
    // o tipo vector e os operadores do pgvector moram no schema extensions
    await sql`set search_path to public, extensions`;

    const pendentes = await sql`
      select count(*)::int as n
      from entries
      where user_id = ${CONTA_A_USER_ID} and embedding_status = 'pending'
    `;
    if (pendentes[0].n > 0) {
      console.error(
        `Ainda há ${pendentes[0].n} entradas 'pending' na conta A — rode scripts/backfill-seed-embeddings.ts antes.`,
      );
      Deno.exit(1);
    }

    for (const { par, termo, entryId } of PARES) {
      const queryEmbedding = await embedQuery(termo);
      const vectorLiteral = `[${queryEmbedding.join(",")}]`;

      // varredura exata (sem índice aproximado, regra invólavel nº7) —
      // distância de cosseno via pgvector (<=>)
      const rows = await sql`
        select id, content, (embedding <=> ${vectorLiteral}::vector) as distance
        from entries
        where user_id = ${CONTA_A_USER_ID} and embedding_status = 'ready'
        order by embedding <=> ${vectorLiteral}::vector, id asc
        limit ${TOP_K}
      `;

      const posicao = rows.findIndex((r) => r.id === entryId);
      const passou = posicao !== -1;
      if (passou) algumParPassou = true;

      console.log(`\nPar ${par} — termo "${termo}"`);
      rows.forEach((r, i) => {
        const marca = r.id === entryId ? " ← entrada plantada" : "";
        console.log(`  ${i + 1}. [${r.distance.toFixed(4)}] ${r.content.slice(0, 60)}...${marca}`);
      });
      console.log(passou ? `  ✅ PASSOU (posição ${posicao + 1} do top-${TOP_K})` : `  ❌ não apareceu no top-${TOP_K}`);
    }

    console.log("\n" + "=".repeat(60));
    if (algumParPassou) {
      console.log("✅ RF06 comprovado — pelo menos um par encontrou a entrada plantada.");
    } else {
      console.error(
        "❌ RF06 NÃO comprovado — nenhum dos 3 pares encontrou a entrada plantada.\n" +
          "Isso é condição de viabilidade do RF06 (T-024) — pare e reporte, não é um detalhe.",
      );
      Deno.exit(1);
    }
  } finally {
    await sql.end();
  }
}

await main();
