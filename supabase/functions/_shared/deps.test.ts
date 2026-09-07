// Teste do módulo `deps` (Fase 3, gap-fill) — só a parte com lógica de
// verdade (`buildReplayDeps`/`parseReplayMode` via `readAiEnv`); a fiação
// pura (`buildGatewayDeps`, `readAppEnv`) já é exercitada indiretamente
// pelos testes de `gateway.test.ts` e de cada `handler.test.ts`.

import { assertEquals } from "./_test_utils.ts";
import type { DbClient } from "./db.ts";
import { buildReplayDeps } from "./deps.ts";

function fakeDbForReplay(opts: {
  lookupRows: unknown[];
  storeCalls: unknown[];
}): DbClient {
  return {
    rpc(name: string, args: Record<string, unknown>) {
      if (name === "experiment_replay_cache_lookup") {
        return Promise.resolve({ data: opts.lookupRows, error: null });
      }
      if (name === "experiment_replay_cache_store") {
        opts.storeCalls.push(args);
        return Promise.resolve({ data: null, error: null });
      }
      throw new Error(`RPC inesperada em teste: ${name}`);
    },
  } as unknown as DbClient;
}

Deno.test("buildReplayDeps: lookup sem linhas vira null (miss)", async () => {
  const db = fakeDbForReplay({ lookupRows: [], storeCalls: [] });
  const deps = buildReplayDeps(db, "replay");
  const hit = await deps.lookup("cache-key-1");
  assertEquals(hit, null);
});

Deno.test("buildReplayDeps: lookup com linha vira { response, hitCount }", async () => {
  const db = fakeDbForReplay({
    lookupRows: [{ response: { text: "olá" }, hit_count: 3 }],
    storeCalls: [],
  });
  const deps = buildReplayDeps(db, "replay");
  const hit = await deps.lookup("cache-key-1");
  assertEquals(hit, { response: { text: "olá" }, hitCount: 3 });
});

Deno.test("buildReplayDeps: store repassa os campos certos para a RPC (p_ prefixado)", async () => {
  const storeCalls: unknown[] = [];
  const db = fakeDbForReplay({ lookupRows: [], storeCalls });
  const deps = buildReplayDeps(db, "record");
  await deps.store({
    cacheKey: "ck1",
    operation: "pii",
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    promptVersion: "v1",
    requestEnvelope: {
      operation: "pii",
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      promptVersion: "v1",
      personaSnapshot: null,
      input: { text: "x" },
    },
    response: { spans: [] },
  });
  assertEquals(storeCalls, [{
    p_cache_key: "ck1",
    p_operation: "pii",
    p_provider: "anthropic",
    p_model: "claude-haiku-4-5-20251001",
    p_prompt_version: "v1",
    p_request_envelope: {
      operation: "pii",
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      promptVersion: "v1",
      personaSnapshot: null,
      input: { text: "x" },
    },
    p_response: { spans: [] },
  }]);
});
