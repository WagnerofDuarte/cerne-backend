// Teste do módulo `replay` (T-030).
// Critério de conclusão do checklist: "mesmo input produz sempre a mesma
// cache_key".

import { assert, assertEquals, assertNotEquals, assertThrowsAsync } from "./_test_utils.ts";
import {
  buildChatEnvelope,
  buildDashboardEnvelope,
  buildEmbeddingEnvelope,
  buildOcrEnvelope,
  buildPiiEnvelope,
  type CanonicalEnvelope,
  canonicalJsonStringify,
  computeCacheKey,
  computeEntryIdsHash,
  computeHistoryHash,
  type ReplayDeps,
  ReplayMissError,
  withReplay,
} from "./replay.ts";

// --- canonicalJsonStringify / computeCacheKey -------------------------

Deno.test("canonicalJsonStringify ordena chaves independente da ordem de inserção", () => {
  const a = { b: 1, a: 2, c: { z: 1, y: 2 } };
  const b = { a: 2, c: { y: 2, z: 1 }, b: 1 };
  assertEquals(canonicalJsonStringify(a), canonicalJsonStringify(b));
  assertEquals(canonicalJsonStringify(a), '{"a":2,"b":1,"c":{"y":2,"z":1}}');
});

Deno.test("canonicalJsonStringify ordena chaves dentro de objetos aninhados em arrays", () => {
  const value = { items: [{ b: 1, a: 2 }, { d: 3, c: 4 }] };
  assertEquals(canonicalJsonStringify(value), '{"items":[{"a":2,"b":1},{"c":4,"d":3}]}');
});

Deno.test("mesmo input produz sempre a mesma cache_key (critério de conclusão do T-030)", async () => {
  const envelopeA: CanonicalEnvelope = {
    operation: "pii",
    provider: "anthropic",
    model: "haiku-4.5",
    promptVersion: "v1",
    personaSnapshot: null,
    input: { text: "conteúdo de teste" },
  };
  // mesmo conteúdo lógico, chaves em ordem diferente na montagem do objeto
  const envelopeB: CanonicalEnvelope = {
    personaSnapshot: null,
    promptVersion: "v1",
    input: { text: "conteúdo de teste" },
    operation: "pii",
    model: "haiku-4.5",
    provider: "anthropic",
  };
  const keyA = await computeCacheKey(envelopeA);
  const keyB = await computeCacheKey(envelopeB);
  assertEquals(keyA, keyB);
  assertEquals(keyA.length, 64); // sha256 em hex
});

Deno.test("cache_key muda se qualquer campo do envelope mudar", async () => {
  const base: CanonicalEnvelope = {
    operation: "pii",
    provider: "anthropic",
    model: "haiku-4.5",
    promptVersion: "v1",
    personaSnapshot: null,
    input: { text: "a" },
  };
  const changedText = { ...base, input: { text: "b" } };
  const changedPromptVersion = { ...base, promptVersion: "v2" };
  const keyBase = await computeCacheKey(base);
  assertNotEquals(await computeCacheKey(changedText), keyBase);
  assertNotEquals(await computeCacheKey(changedPromptVersion), keyBase);
});

// --- hashes auxiliares --------------------------------------------------

Deno.test("computeHistoryHash é determinístico e sensível à ordem das mensagens", async () => {
  const h1 = await computeHistoryHash([
    { role: "user", content: "oi" },
    { role: "assistant", content: "olá" },
  ]);
  const h2 = await computeHistoryHash([
    { role: "user", content: "oi" },
    { role: "assistant", content: "olá" },
  ]);
  const h3 = await computeHistoryHash([
    { role: "assistant", content: "olá" },
    { role: "user", content: "oi" },
  ]);
  assertEquals(h1, h2);
  assertNotEquals(h1, h3);
});

Deno.test("computeEntryIdsHash independe da ordem de entrada (é ordenado antes de hashear)", async () => {
  const h1 = await computeEntryIdsHash(["c", "a", "b"]);
  const h2 = await computeEntryIdsHash(["a", "b", "c"]);
  assertEquals(h1, h2);
});

// --- normalização de input por operação (§9.2) -----------------------

Deno.test("buildChatEnvelope ordena retrievedEntryIds antes de entrar no envelope", async () => {
  const envelope = await buildChatEnvelope({
    provider: "anthropic",
    model: "sonnet-5",
    promptVersion: "v1",
    personaSnapshot: "empatico",
    historyMessages: [{ seq: 1, role: "user", content: "oi" }],
    userMessage: "tudo bem?",
    retrievedEntryIds: ["c", "a", "b"],
  });
  assertEquals(envelope.input.retrievedEntryIds, ["a", "b", "c"]);
  assertEquals(envelope.input.historySeqs, [1]);
  assertEquals(envelope.personaSnapshot, "empatico");
  assertEquals(envelope.operation, "chat");
});

Deno.test("duas ordens de retrievedEntryIds produzem a mesma cache_key", async () => {
  const common = {
    provider: "anthropic",
    model: "sonnet-5",
    promptVersion: "v1",
    personaSnapshot: "empatico" as const,
    historyMessages: [{ seq: 1, role: "user" as const, content: "oi" }],
    userMessage: "tudo bem?",
  };
  const keyA = await computeCacheKey(
    await buildChatEnvelope({ ...common, retrievedEntryIds: ["id2", "id1"] }),
  );
  const keyB = await computeCacheKey(
    await buildChatEnvelope({ ...common, retrievedEntryIds: ["id1", "id2"] }),
  );
  assertEquals(keyA, keyB);
});

Deno.test("buildPiiEnvelope/buildOcrEnvelope/buildEmbeddingEnvelope não têm persona", () => {
  const pii = buildPiiEnvelope({
    provider: "anthropic",
    model: "haiku-4.5",
    promptVersion: "v1",
    text: "x",
  });
  const ocr = buildOcrEnvelope({
    provider: "anthropic",
    model: "haiku-4.5",
    promptVersion: "v1",
    imageSha256: "abc",
    mimeType: "image/png",
  });
  const emb = buildEmbeddingEnvelope({
    provider: "voyage",
    model: "voyage-4",
    promptVersion: "v1",
    text: "x",
    inputType: "document",
  });
  assertEquals(pii.personaSnapshot, null);
  assertEquals(ocr.personaSnapshot, null);
  assertEquals(emb.personaSnapshot, null);
  assertEquals(pii.input, { text: "x" });
  assertEquals(ocr.input, { imageSha256: "abc", mimeType: "image/png" });
  assertEquals(emb.input, { text: "x", inputType: "document" });
});

Deno.test("buildDashboardEnvelope: entryIdsHash independe da ordem das entradas do período", async () => {
  const e1 = await buildDashboardEnvelope({
    provider: "anthropic",
    model: "haiku-4.5",
    promptVersion: "v1",
    period: "30d",
    entryIds: ["c", "a", "b"],
  });
  const e2 = await buildDashboardEnvelope({
    provider: "anthropic",
    model: "haiku-4.5",
    promptVersion: "v1",
    period: "30d",
    entryIds: ["a", "b", "c"],
  });
  assertEquals(await computeCacheKey(e1), await computeCacheKey(e2));
});

// --- withReplay / os 4 modos (§9.3) -----------------------------------

function makeEnvelope(text: string): CanonicalEnvelope {
  return {
    operation: "pii",
    provider: "anthropic",
    model: "haiku-4.5",
    promptVersion: "v1",
    personaSnapshot: null,
    input: { text },
  };
}

function fakeStore(): {
  deps: Omit<ReplayDeps, "mode">;
  calls: { lookups: string[]; stores: unknown[] };
  cache: Map<string, { response: unknown; hitCount: number }>;
} {
  const cache = new Map<string, { response: unknown; hitCount: number }>();
  const calls = { lookups: [] as string[], stores: [] as unknown[] };
  return {
    cache,
    calls,
    deps: {
      lookup: (cacheKey: string) => {
        calls.lookups.push(cacheKey);
        const entry = cache.get(cacheKey);
        if (!entry) return Promise.resolve(null);
        entry.hitCount += 1;
        return Promise.resolve({ ...entry });
      },
      store: (args) => {
        calls.stores.push(args);
        if (!cache.has(args.cacheKey)) {
          cache.set(args.cacheKey, { response: args.response, hitCount: 0 });
        }
        return Promise.resolve();
      },
    },
  };
}

Deno.test("mode 'off': sempre chama o provedor, nunca consulta nem grava o cache", async () => {
  const { deps, calls } = fakeStore();
  let providerCalls = 0;
  const result = await withReplay(makeEnvelope("x"), () => {
    providerCalls++;
    return Promise.resolve({ text: "resposta" });
  }, { mode: "off", ...deps });

  assertEquals(result.status, "off");
  assertEquals(providerCalls, 1);
  assertEquals(calls.lookups.length, 0);
  assertEquals(calls.stores.length, 0);
});

for (const mode of ["record", "replay"] as const) {
  Deno.test(`mode '${mode}': miss chama o provedor e grava; hit seguinte serve do cache sem chamar de novo`, async () => {
    const { deps, calls } = fakeStore();
    let providerCalls = 0;
    const provider = () => {
      providerCalls++;
      return Promise.resolve({ text: `resposta ${providerCalls}` });
    };

    const first = await withReplay(makeEnvelope("x"), provider, { mode, ...deps });
    assertEquals(first.status, "miss");
    assertEquals(providerCalls, 1);
    assertEquals(calls.stores.length, 1);

    const second = await withReplay(makeEnvelope("x"), provider, { mode, ...deps });
    assertEquals(second.status, "hit");
    assertEquals(providerCalls, 1, "provedor não deveria ser chamado de novo em hit");
    assertEquals(second.response, first.response);
  });
}

Deno.test("mode 'replay_strict': hit serve do cache normalmente", async () => {
  const { deps } = fakeStore();
  await withReplay(makeEnvelope("x"), () => Promise.resolve({ text: "gravado em record" }), {
    mode: "record",
    ...deps,
  });

  let providerCalls = 0;
  const result = await withReplay(makeEnvelope("x"), () => {
    providerCalls++;
    return Promise.resolve({ text: "não deveria ser chamado" });
  }, { mode: "replay_strict", ...deps });

  assertEquals(result.status, "hit");
  assertEquals(providerCalls, 0);
});

Deno.test("mode 'replay_strict': miss lança ReplayMissError, nunca chama o provedor", async () => {
  const { deps, calls } = fakeStore();
  let providerCalls = 0;
  const err = await assertThrowsAsync(() =>
    withReplay(makeEnvelope("nunca-gravado"), () => {
      providerCalls++;
      return Promise.resolve({ text: "x" });
    }, { mode: "replay_strict", ...deps })
  );
  assert(err instanceof ReplayMissError);
  assertEquals(providerCalls, 0);
  assertEquals(calls.stores.length, 0);
});

Deno.test("store recebe operation/provider/model/promptVersion/requestEnvelope corretos", async () => {
  const { deps, calls } = fakeStore();
  const envelope = makeEnvelope("conteúdo");
  await withReplay(envelope, () => Promise.resolve({ text: "r" }), { mode: "record", ...deps });

  assertEquals(calls.stores.length, 1);
  const stored = calls.stores[0] as {
    operation: string;
    provider: string;
    model: string;
    promptVersion: string;
    requestEnvelope: unknown;
    response: unknown;
  };
  assertEquals(stored.operation, "pii");
  assertEquals(stored.provider, "anthropic");
  assertEquals(stored.model, "haiku-4.5");
  assertEquals(stored.promptVersion, "v1");
  assertEquals(stored.requestEnvelope, envelope);
  assertEquals(stored.response, { text: "r" });
});
