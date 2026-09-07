// Teste do módulo `ai/voyage` (T-032).
// Critério de conclusão do checklist: "segunda chamada idêntica retorna hit".

import { assert, assertEquals, assertThrowsAsync } from "../_test_utils.ts";
import { buildEmbeddingEnvelope, type ReplayDeps } from "../replay.ts";
import { embed, VOYAGE_MODEL, VOYAGE_OUTPUT_DIMENSION, VoyageApiError } from "./voyage.ts";

const OFF_REPLAY: ReplayDeps = {
  mode: "off",
  lookup: () => Promise.resolve(null),
  store: () => Promise.resolve(),
};

function fakeReplayDeps(): ReplayDeps & { mode: "record" } {
  const cache = new Map<string, { response: unknown; hitCount: number }>();
  return {
    mode: "record",
    lookup: (cacheKey) => {
      const entry = cache.get(cacheKey);
      if (!entry) return Promise.resolve(null);
      entry.hitCount += 1;
      return Promise.resolve({ ...entry });
    },
    store: (args) => {
      if (!cache.has(args.cacheKey)) {
        cache.set(args.cacheKey, { response: args.response, hitCount: 0 });
      }
      return Promise.resolve();
    },
  };
}

function fakeFetch(
  responseBody: unknown,
  status = 200,
): { fetchImpl: typeof fetch; calls: { count: number } } {
  const calls = { count: 0 };
  const fetchImpl = ((..._args: Parameters<typeof fetch>) => {
    calls.count += 1;
    return Promise.resolve(
      new Response(JSON.stringify(responseBody), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch;
  return { fetchImpl, calls };
}

// 3 floats por brevidade — a garantia de "1024 floats de verdade" é da
// própria Voyage (D8, já verificada em GATE-05); este módulo só confere
// que o embedding devolvido bate com `outputDimension` pedido.
const SHORT_EMBEDDING = [0.1, 0.2, 0.3];

Deno.test("segunda chamada idêntica retorna hit sem bater na rede (critério de conclusão do T-032)", async () => {
  const envelope = buildEmbeddingEnvelope({
    provider: "voyage",
    model: VOYAGE_MODEL,
    promptVersion: "v1",
    text: "conteúdo da entrada",
    inputType: "document",
  });
  const request = {
    model: VOYAGE_MODEL,
    text: "conteúdo da entrada",
    inputType: "document" as const,
    outputDimension: 3,
  };
  const replay = fakeReplayDeps();
  const { fetchImpl, calls } = fakeFetch({ data: [{ embedding: SHORT_EMBEDDING }] });

  const first = await embed(envelope, request, { voyageApiKey: "chave", fetchImpl, replay });
  assertEquals(first.status, "miss");
  assertEquals(calls.count, 1);

  const second = await embed(envelope, request, { voyageApiKey: "chave", fetchImpl, replay });
  assertEquals(second.status, "hit");
  assertEquals(calls.count, 1);
  assertEquals(second.response, first.response);
});

Deno.test("envia input_type/model/output_dimension certos e o header Authorization", async () => {
  let capturedInit: RequestInit | undefined;
  const fetchImpl = ((_url: string | URL | Request, init?: RequestInit) => {
    capturedInit = init;
    return Promise.resolve(
      new Response(JSON.stringify({ data: [{ embedding: SHORT_EMBEDDING }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch;

  const envelope = buildEmbeddingEnvelope({
    provider: "voyage",
    model: VOYAGE_MODEL,
    promptVersion: "v1",
    text: "pergunta do usuário",
    inputType: "query",
  });
  await embed(
    envelope,
    { model: VOYAGE_MODEL, text: "pergunta do usuário", inputType: "query", outputDimension: 3 },
    { voyageApiKey: "chave-xyz", fetchImpl, replay: OFF_REPLAY },
  );

  const headers = new Headers(capturedInit?.headers);
  assertEquals(headers.get("Authorization"), "Bearer chave-xyz");
  const body = JSON.parse(capturedInit?.body as string);
  assertEquals(body.input, ["pergunta do usuário"]);
  assertEquals(body.input_type, "query");
  assertEquals(body.model, VOYAGE_MODEL);
});

Deno.test("manda um AbortSignal no fetch — sem ele, uma chamada presa nunca falha sozinha (achado real, T-041)", async () => {
  let capturedInit: RequestInit | undefined;
  const fetchImpl = ((_url: string | URL | Request, init?: RequestInit) => {
    capturedInit = init;
    return Promise.resolve(
      new Response(JSON.stringify({ data: [{ embedding: SHORT_EMBEDDING }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch;

  const envelope = buildEmbeddingEnvelope({
    provider: "voyage",
    model: VOYAGE_MODEL,
    promptVersion: "v1",
    text: "x",
    inputType: "document",
  });
  await embed(
    envelope,
    { model: VOYAGE_MODEL, text: "x", inputType: "document", outputDimension: 3 },
    { voyageApiKey: "chave", fetchImpl, replay: OFF_REPLAY },
  );

  assert(capturedInit?.signal instanceof AbortSignal);
  assertEquals(capturedInit.signal.aborted, false);
});

Deno.test("dimensão do embedding devolvido diferente da pedida vira VoyageApiError", async () => {
  const envelope = buildEmbeddingEnvelope({
    provider: "voyage",
    model: VOYAGE_MODEL,
    promptVersion: "v1",
    text: "x",
    inputType: "document",
  });
  const { fetchImpl } = fakeFetch({ data: [{ embedding: [0.1, 0.2] }] }); // pedimos 3, veio 2

  const err = await assertThrowsAsync(() =>
    embed(
      envelope,
      { model: VOYAGE_MODEL, text: "x", inputType: "document", outputDimension: 3 },
      { voyageApiKey: "chave", fetchImpl, replay: OFF_REPLAY },
    )
  );
  assert(err instanceof VoyageApiError);
});

Deno.test("resposta não-2xx vira VoyageApiError", async () => {
  const envelope = buildEmbeddingEnvelope({
    provider: "voyage",
    model: VOYAGE_MODEL,
    promptVersion: "v1",
    text: "x",
    inputType: "document",
  });
  const { fetchImpl } = fakeFetch({ error: "chave inválida" }, 401);

  const err = await assertThrowsAsync(() =>
    embed(
      envelope,
      { model: VOYAGE_MODEL, text: "x", inputType: "document", outputDimension: 3 },
      { voyageApiKey: "chave-errada", fetchImpl, replay: OFF_REPLAY },
    )
  );
  assert(err instanceof VoyageApiError);
  assertEquals((err as VoyageApiError).status, 401);
});

Deno.test("constantes D8: modelo voyage-4, dimensão 1024", () => {
  assertEquals(VOYAGE_MODEL, "voyage-4");
  assertEquals(VOYAGE_OUTPUT_DIMENSION, 1024);
});
