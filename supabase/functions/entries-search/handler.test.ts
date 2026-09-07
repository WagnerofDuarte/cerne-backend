// Teste do handler `entries-search` (T-040) — seleção de modo
// (filter_only vs. semantic), similarity = 1 - distância, serverRevision
// por item; a lógica de filtro/RPC em si já está coberta em
// entries-repo.test.ts.

import { assert, assertEquals, assertThrowsAsync } from "../_shared/_test_utils.ts";
import type { AiEnv } from "../_shared/deps.ts";
import type { DbClient } from "../_shared/db.ts";
import { CerneError } from "../_shared/errors.ts";
import type { AuthContext, GatewayContext } from "../_shared/gateway.ts";
import { handleSearchEntries, type SearchEntriesQuery } from "./handler.ts";

interface FakeEntryRow extends Record<string, unknown> {
  id: string;
  occurred_at: string;
}

function makeDb(
  opts: {
    entriesRows?: FakeEntryRow[];
    rpcRows?: Array<Record<string, unknown>>;
    serverRevision?: number;
  },
): { db: DbClient; calls: { rpc: number } } {
  const calls = { rpc: 0 };
  const db = {
    from(table: string) {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({
                  data: { server_revision: opts.serverRevision ?? 1 },
                  error: null,
                }),
            }),
          }),
        };
      }
      const builder = {
        select: () => builder,
        eq: () => builder,
        gte: () => builder,
        lte: () => builder,
        order: () => builder,
        limit: () => builder,
        then: (resolve: (r: { data: unknown; error: null }) => void) =>
          resolve({
            data: (opts.entriesRows ?? []).map((r) => ({ ...r, entry_tags: null })),
            error: null,
          }),
      };
      return builder;
    },
    rpc: (_name: string, _args: Record<string, unknown>) => {
      calls.rpc++;
      return Promise.resolve({ data: opts.rpcRows ?? [], error: null });
    },
  } as unknown as DbClient;
  return { db, calls };
}

function fakeVoyageFetch(status: number, body: unknown): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    )) as typeof fetch;
}

const baseEnv: Omit<AiEnv, "fetchImpl"> = {
  supabaseUrl: "https://example.test",
  supabaseAnonKey: "anon-key",
  testFaultKey: undefined,
  anthropicApiKey: "anthropic-key",
  voyageApiKey: "voyage-key",
  promptVersion: "v1",
  replayMode: "off",
};

function ctxFor(
  query: SearchEntriesQuery,
  auth: AuthContext,
): GatewayContext<undefined, SearchEntriesQuery> {
  return {
    req: new Request("https://example.test/entries/search"),
    requestId: "req-1",
    now: new Date("2026-09-10T00:00:00Z"),
    params: {},
    body: undefined,
    query,
    auth,
    fault: null,
  };
}

Deno.test("q ausente: modo filter_only, nunca chama Voyage nem a RPC semântica", async () => {
  const { db, calls } = makeDb({
    entriesRows: [{ id: "a", occurred_at: "2026-09-10T00:00:00Z" }],
    serverRevision: 3,
  });
  const fetchImpl = fakeVoyageFetch(500, {}); // se for chamado, o teste falha por erro inesperado
  const result = await handleSearchEntries(
    ctxFor({}, { userId: "u1", accessToken: "t", db }),
    { ...baseEnv, fetchImpl },
  );
  assertEquals(result.status, 200);
  assertEquals(result.envelope.meta, { mode: "filter_only" });
  const data = result.envelope.data as Array<Record<string, unknown>>;
  assertEquals(data[0]?.serverRevision, 3);
  assert(!("similarity" in (data[0] ?? {})), "filter_only não deveria ter `similarity`");
  assertEquals(calls.rpc, 0);
});

Deno.test("q vazio (string vazia) conta como ausente: filter_only", async () => {
  const { db, calls } = makeDb({ entriesRows: [] });
  const result = await handleSearchEntries(
    ctxFor({ q: "" }, { userId: "u1", accessToken: "t", db }),
    baseEnv,
  );
  assertEquals(result.envelope.meta, { mode: "filter_only" });
  assertEquals(calls.rpc, 0);
});

Deno.test("q presente: modo semantic, similarity = 1 - distance, serverRevision por item", async () => {
  const { db, calls } = makeDb({
    rpcRows: [
      { id: "a", content: "x", distance: 0.2, tags: [] },
      { id: "b", content: "y", distance: 0.5, tags: [{ id: "t1", name: "trabalho" }] },
    ],
    serverRevision: 9,
  });
  const fetchImpl = fakeVoyageFetch(200, { data: [{ embedding: Array(1024).fill(0.01) }] });
  const result = await handleSearchEntries(
    ctxFor({ q: "ansiedade" }, { userId: "u1", accessToken: "t", db }),
    { ...baseEnv, fetchImpl },
  );
  assertEquals(result.status, 200);
  assertEquals(result.envelope.meta, { mode: "semantic" });
  const data = result.envelope.data as Array<Record<string, unknown>>;
  assertEquals(data[0]?.similarity, 0.8);
  assertEquals(data[1]?.similarity, 0.5);
  assertEquals(data.every((e) => e.serverRevision === 9), true);
  assertEquals(
    data.every((e) => !("distance" in e)),
    true,
    "distance é detalhe interno, não vai na API",
  );
  assertEquals(calls.rpc, 1);
});

Deno.test("Voyage indisponível no modo semantic → EMBEDDING_FAILED (502)", async () => {
  const { db } = makeDb({});
  const fetchImpl = fakeVoyageFetch(503, { error: "unavailable" });
  const err = await assertThrowsAsync(() =>
    handleSearchEntries(
      ctxFor({ q: "ansiedade" }, { userId: "u1", accessToken: "t", db }),
      { ...baseEnv, fetchImpl },
    )
  );
  assert(err instanceof CerneError);
  assertEquals((err as CerneError).code, "EMBEDDING_FAILED");
  assertEquals((err as CerneError).http, 502);
});
