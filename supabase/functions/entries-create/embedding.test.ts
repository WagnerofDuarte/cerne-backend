// Teste do módulo `embedding` (T-037).
// Critério de conclusão do checklist: "Voyage forçada a falhar ainda deixa
// a entrada gravada com embedding_status='failed'" — este módulo nunca
// lança, só devolve { status: 'failed' }.

import { assertEquals } from "../_shared/_test_utils.ts";
import type { ReplayDeps } from "../_shared/replay.ts";
import { generateEntryEmbedding } from "./embedding.ts";

const env = { voyageApiKey: "test-key" };
const offReplay: ReplayDeps = {
  mode: "off",
  lookup: () => Promise.resolve(null),
  store: () => Promise.resolve(),
};

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    )) as typeof fetch;
}

Deno.test("sucesso: status 'ready' com o embedding de 1024 floats, model/dimension/inputType corretos (D8)", async () => {
  const embedding = Array(1024).fill(0.01);
  const fetchImpl = fakeFetch(200, { data: [{ embedding }] });
  const result = await generateEntryEmbedding("texto da entrada", "v1", {
    ...env,
    fetchImpl,
    replay: offReplay,
  });
  assertEquals(result.status, "ready");
  if (result.status === "ready") {
    assertEquals(result.embedding.length, 1024);
    assertEquals(result.model, "voyage-4");
    assertEquals(result.dimension, 1024);
    assertEquals(result.inputType, "document");
  }
});

Deno.test("Voyage indisponível (não-2xx) → status 'failed', nunca lança", async () => {
  const fetchImpl = fakeFetch(503, { error: "service unavailable" });
  const result = await generateEntryEmbedding("texto da entrada", "v1", {
    ...env,
    fetchImpl,
    replay: offReplay,
  });
  assertEquals(result, { status: "failed" });
});

Deno.test("Voyage devolve dimensão errada → status 'failed', nunca lança", async () => {
  const fetchImpl = fakeFetch(200, { data: [{ embedding: [0.1, 0.2] }] }); // só 2, não 1024
  const result = await generateEntryEmbedding("texto da entrada", "v1", {
    ...env,
    fetchImpl,
    replay: offReplay,
  });
  assertEquals(result, { status: "failed" });
});
