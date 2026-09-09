// Teste do handler `dashboard-narrative-get` (T-057).

import { assert, assertEquals } from "../_shared/_test_utils.ts";
import type { AiEnv } from "../_shared/deps.ts";
import type { DbClient } from "../_shared/db.ts";
import { CerneError } from "../_shared/errors.ts";
import type { AuthContext, GatewayContext } from "../_shared/gateway.ts";
import { type DashboardNarrativeQuery, handleGetDashboardNarrative } from "./handler.ts";

function ctxFor(
  query: DashboardNarrativeQuery,
  auth: AuthContext,
  fault: GatewayContext["fault"] = null,
): GatewayContext<undefined, DashboardNarrativeQuery> {
  return {
    req: new Request("https://example.test/dashboard-narrative-get"),
    requestId: "req-1",
    now: new Date("2026-09-10T00:00:00Z"),
    params: {},
    body: undefined,
    query,
    auth,
    fault,
  };
}

function fakeDb(entries: Array<Record<string, unknown>>): DbClient {
  const builder = {
    gte: () => builder,
    lt: () => builder,
    order: () => builder,
    limit: () => builder,
    then: (resolve: (r: { data: unknown; error: null }) => void) =>
      resolve({ data: entries, error: null }),
  };
  return {
    from: () => ({ select: () => builder }),
    rpc: (name: string) =>
      name === "experiment_replay_cache_lookup"
        ? Promise.resolve({ data: [], error: null })
        : Promise.resolve({ error: null }),
  } as unknown as DbClient;
}

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    )) as typeof fetch;
}

const baseEnv: AiEnv = {
  supabaseUrl: "https://example.test",
  supabaseAnonKey: "anon-key",
  testFaultKey: undefined,
  anthropicApiKey: "k",
  voyageApiKey: "v",
  promptVersion: "v1",
  replayMode: "off",
};

Deno.test("caminho feliz: devolve text + generatedAt = ctx.now", async () => {
  const db = fakeDb([{ id: "e1", content: "fui ao parque" }]);
  const fetchImpl = fakeFetch(200, {
    id: "m1",
    model: "claude-haiku-4-5-20251001",
    content: [{ type: "text", text: "Você teve uma semana de calma." }],
  });
  const result = await handleGetDashboardNarrative(
    ctxFor({ period: "30d" }, { userId: "u1", accessToken: "t", db }),
    { ...baseEnv, fetchImpl },
  );
  assertEquals(result.status, 200);
  const data = result.envelope.data as Record<string, unknown>;
  assertEquals(data.text, "Você teve uma semana de calma.");
  assertEquals(data.generatedAt, "2026-09-10T00:00:00.000Z");
});

Deno.test("fault ai_timeout: nunca chama a Anthropic, vira AI_GENERATION_TIMEOUT (independente do aggregate — §10.2)", async () => {
  let fetchCalled = false;
  const spyFetch: typeof fetch = (...args) => {
    fetchCalled = true;
    return fakeFetch(200, {})(...args);
  };
  const db = fakeDb([]);
  let threw: unknown;
  try {
    await handleGetDashboardNarrative(
      ctxFor({ period: "7d" }, { userId: "u1", accessToken: "t", db }, { type: "ai_timeout" }),
      { ...baseEnv, fetchImpl: spyFetch },
    );
  } catch (err) {
    threw = err;
  }
  assert(!fetchCalled);
  assert(threw instanceof CerneError);
  assertEquals((threw as CerneError).code, "AI_GENERATION_TIMEOUT");
});

Deno.test("Anthropic indisponível → AI_GENERATION_TIMEOUT (502/504 upstream não vaza)", async () => {
  const db = fakeDb([]);
  const fetchImpl = fakeFetch(503, { error: "unavailable" });
  let threw: unknown;
  try {
    await handleGetDashboardNarrative(
      ctxFor({ period: "all" }, { userId: "u1", accessToken: "t", db }),
      { ...baseEnv, fetchImpl },
    );
  } catch (err) {
    threw = err;
  }
  assert(threw instanceof CerneError);
  assertEquals((threw as CerneError).code, "AI_GENERATION_TIMEOUT");
});

Deno.test("resposta sem bloco de texto → AI_GENERATION_TIMEOUT", async () => {
  const db = fakeDb([]);
  const fetchImpl = fakeFetch(200, { id: "m1", model: "x", content: [] });
  let threw: unknown;
  try {
    await handleGetDashboardNarrative(
      ctxFor({ period: "90d" }, { userId: "u1", accessToken: "t", db }),
      { ...baseEnv, fetchImpl },
    );
  } catch (err) {
    threw = err;
  }
  assert(threw instanceof CerneError);
  assertEquals((threw as CerneError).code, "AI_GENERATION_TIMEOUT");
});
