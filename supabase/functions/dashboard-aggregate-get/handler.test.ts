// Teste do handler `dashboard-aggregate-get` (T-056).

import { assertEquals } from "../_shared/_test_utils.ts";
import type { DbClient } from "../_shared/db.ts";
import type { AuthContext, GatewayContext } from "../_shared/gateway.ts";
import { type DashboardAggregateQuery, handleGetDashboardAggregate } from "./handler.ts";

function ctxFor(
  query: DashboardAggregateQuery,
  auth: AuthContext,
): GatewayContext<undefined, DashboardAggregateQuery> {
  return {
    req: new Request("https://example.test/dashboard-aggregate-get"),
    requestId: "req-1",
    now: new Date("2026-09-10T00:00:00Z"),
    params: {},
    body: undefined,
    query,
    auth,
    fault: null,
  };
}

function fakeDb(rpcRows: Array<Record<string, unknown>>, serverRevision = 7): DbClient {
  return {
    rpc: () => Promise.resolve({ data: rpcRows, error: null }),
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: { server_revision: serverRevision }, error: null }),
        }),
      }),
    }),
  } as unknown as DbClient;
}

Deno.test("zero entradas: 200 com buckets: [] e totals zerado (nunca erro — §8.5)", async () => {
  const db = fakeDb([]);
  const result = await handleGetDashboardAggregate(
    ctxFor({ period: "30d" }, { userId: "u1", accessToken: "t", db }),
  );
  assertEquals(result.status, 200);
  const data = result.envelope.data as Record<string, unknown>;
  assertEquals(data.buckets, []);
  assertEquals(data.totals, { count: 0, sources: { manual: 0, audio: 0, photo: 0, chat: 0 } });
});

Deno.test("agrupa por data, preenche as 4 fontes (0 para as que não aparecem), soma count/totals", async () => {
  const db = fakeDb([
    { bucket_date: "2026-09-01", source: "manual", entry_count: 2 },
    { bucket_date: "2026-09-01", source: "audio", entry_count: 1 },
    { bucket_date: "2026-09-03", source: "photo", entry_count: 4 },
  ]);
  const result = await handleGetDashboardAggregate(
    ctxFor({ period: "all" }, { userId: "u1", accessToken: "t", db }),
  );
  const data = result.envelope.data as {
    buckets: Array<{ date: string; count: number; sources: Record<string, number> }>;
    totals: { count: number; sources: Record<string, number> };
  };
  assertEquals(data.buckets.length, 2);
  assertEquals(data.buckets[0], {
    date: "2026-09-01",
    count: 3,
    sources: { manual: 2, audio: 1, photo: 0, chat: 0 },
  });
  assertEquals(data.buckets[1], {
    date: "2026-09-03",
    count: 4,
    sources: { manual: 0, audio: 0, photo: 4, chat: 0 },
  });
  assertEquals(data.totals, { count: 7, sources: { manual: 2, audio: 1, photo: 4, chat: 0 } });
});

Deno.test("header X-Data-Version vem de profiles.server_revision", async () => {
  const db = fakeDb([], 42);
  const result = await handleGetDashboardAggregate(
    ctxFor({ period: "7d" }, { userId: "u1", accessToken: "t", db }),
  );
  assertEquals((result.headers as Record<string, string>)["X-Data-Version"], "42");
});
