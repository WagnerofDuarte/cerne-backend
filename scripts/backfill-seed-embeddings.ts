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
// Uso:
//   deno run --allow-net --allow-env scripts/backfill-seed-embeddings.ts
//
// Variáveis de ambiente:
//   VOYAGE_API_KEY
//   SUPABASE_DB_URL   (default: postgresql://postgres:postgres@127.0.0.1:54322/postgres —
//                       a "Database URL" que o `supabase status` imprime)

import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";

const VOYAGE_API_KEY = Deno.env.get("VOYAGE_API_KEY");
const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CONTA_A_USER_ID = "a0000000-0000-0000-0000-000000000001";
const VOYAGE_MODEL = "voyage-4";
const VOYAGE_OUTPUT_DIMENSION = 1024;

if (!VOYAGE_API_KEY) {
  console.error("Falta a variável de ambiente VOYAGE_API_KEY.");
  Deno.exit(1);
}

async function embedDocument(text: string): Promise<number[]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      input: [text],
      model: VOYAGE_MODEL,
      input_type: "document",
      output_dimension: VOYAGE_OUTPUT_DIMENSION,
    }),
  });

  if (!res.ok) {
    throw new Error(`Voyage respondeu ${res.status}: ${await res.text()}`);
  }

  const body = await res.json();
  const embedding = body?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length !== VOYAGE_OUTPUT_DIMENSION) {
    throw new Error(
      `Resposta da Voyage não tem ${VOYAGE_OUTPUT_DIMENSION} floats: ${JSON.stringify(body)}`,
    );
  }
  return embedding;
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
      console.log("Nenhuma entrada pendente — nada a fazer (já rodou antes, ou o seed não foi carregado).");
      return;
    }

    console.log(`Encontradas ${pendentes.length} entradas pendentes. Chamando a Voyage...`);

    let ok = 0;
    let falhas = 0;

    for (const entry of pendentes) {
      try {
        const embedding = await embedDocument(entry.content);
        const vectorLiteral = `[${embedding.join(",")}]`;

        await sql`
          update entries
          set embedding = ${vectorLiteral}::vector,
              embedding_model = ${VOYAGE_MODEL},
              embedding_dim = ${VOYAGE_OUTPUT_DIMENSION},
              embedding_input_type = 'document',
              embedding_status = 'ready'
          where id = ${entry.id}
        `;

        ok++;
        console.log(`  ✅ ${entry.id}`);
      } catch (err) {
        falhas++;
        console.error(`  ❌ ${entry.id}: ${err instanceof Error ? err.message : err}`);
      }
    }

    console.log(`\nConcluído: ${ok} embeddings gravados, ${falhas} falhas.`);
    if (falhas > 0) Deno.exit(1);
  } finally {
    await sql.end();
  }
}

await main();
