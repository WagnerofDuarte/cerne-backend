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
// Uso:
//   deno run --allow-net --allow-env scripts/backfill-seed-embeddings.ts
//
// Variáveis de ambiente exigidas:
//   SUPABASE_URL               (local: http://127.0.0.1:54321)
//   SUPABASE_SERVICE_ROLE_KEY  (chave de service_role do ambiente local —
//                                nunca usada em Edge Function de aplicativo,
//                                só aqui, num script de manutenção offline)
//   VOYAGE_API_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const VOYAGE_API_KEY = Deno.env.get("VOYAGE_API_KEY");

const CONTA_A_USER_ID = "a0000000-0000-0000-0000-000000000001";
const VOYAGE_MODEL = "voyage-4";
const VOYAGE_OUTPUT_DIMENSION = 1024;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !VOYAGE_API_KEY) {
  console.error(
    "Faltam variáveis de ambiente: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e VOYAGE_API_KEY são obrigatórias.",
  );
  Deno.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
  const { data: pendentes, error: fetchError } = await supabase
    .from("entries")
    .select("id, content")
    .eq("user_id", CONTA_A_USER_ID)
    .eq("embedding_status", "pending");

  if (fetchError) {
    console.error("Falha ao buscar entradas pendentes:", fetchError.message);
    Deno.exit(1);
  }

  if (!pendentes || pendentes.length === 0) {
    console.log("Nenhuma entrada pendente — nada a fazer (já rodou antes, ou o seed não foi carregado).");
    return;
  }

  console.log(`Encontradas ${pendentes.length} entradas pendentes. Chamando a Voyage...`);

  let ok = 0;
  let falhas = 0;

  for (const entry of pendentes) {
    try {
      const embedding = await embedDocument(entry.content);
      const { error: updateError } = await supabase
        .from("entries")
        .update({
          embedding: `[${embedding.join(",")}]`,
          embedding_model: VOYAGE_MODEL,
          embedding_dim: VOYAGE_OUTPUT_DIMENSION,
          embedding_input_type: "document",
          embedding_status: "ready",
        })
        .eq("id", entry.id);

      if (updateError) throw new Error(updateError.message);
      ok++;
      console.log(`  ✅ ${entry.id}`);
    } catch (err) {
      falhas++;
      console.error(`  ❌ ${entry.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\nConcluído: ${ok} embeddings gravados, ${falhas} falhas.`);
  if (falhas > 0) Deno.exit(1);
}

await main();
