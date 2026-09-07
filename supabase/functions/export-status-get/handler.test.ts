// Teste do handler `export-status-get` (T-055).

import { assert, assertEquals } from "../_shared/_test_utils.ts";
import type { DbClient } from "../_shared/db.ts";
import { CerneError } from "../_shared/errors.ts";
import type { AuthContext, GatewayContext } from "../_shared/gateway.ts";
import { handleGetExportStatus } from "./handler.ts";

function ctxFor(jobId: string, auth: AuthContext): GatewayContext<undefined, undefined> {
  return {
    req: new Request(`https://example.test/export-status-get/${jobId}`),
    requestId: "req-1",
    now: new Date("2026-09-10T00:00:00Z"),
    params: { jobId },
    body: undefined,
    query: undefined,
    auth,
    fault: null,
  };
}

function fakeDb(row: Record<string, unknown> | null): DbClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: row, error: null }) }),
        }),
      }),
    }),
  } as unknown as DbClient;
}

Deno.test("job de outro usuário ou inexistente → NOT_FOUND (D7, nunca 403)", async () => {
  const db = fakeDb(null);
  let threw: unknown;
  try {
    await handleGetExportStatus(
      ctxFor("22222222-2222-2222-2222-222222222222", { userId: "user-1", accessToken: "t", db }),
    );
  } catch (err) {
    threw = err;
  }
  assert(threw instanceof CerneError);
  assertEquals((threw as CerneError).code, "NOT_FOUND");
});

Deno.test("status='processing' → downloadAvailable=false", async () => {
  const db = fakeDb({
    id: "11111111-1111-1111-1111-111111111111",
    status: "processing",
    narrative_status: "processing",
    entry_count: 3,
    error_code: null,
    narrative_error_code: null,
  });
  const result = await handleGetExportStatus(
    ctxFor("11111111-1111-1111-1111-111111111111", { userId: "user-1", accessToken: "t", db }),
  );
  assertEquals((result.envelope.data as Record<string, unknown>).downloadAvailable, false);
});

Deno.test("status='data_ready' com narrative_status='failed' → downloadAvailable=true (bruto ainda disponível)", async () => {
  const db = fakeDb({
    id: "11111111-1111-1111-1111-111111111111",
    status: "data_ready",
    narrative_status: "failed",
    entry_count: 3,
    error_code: null,
    narrative_error_code: "AI_GENERATION_TIMEOUT",
  });
  const result = await handleGetExportStatus(
    ctxFor("11111111-1111-1111-1111-111111111111", { userId: "user-1", accessToken: "t", db }),
  );
  const data = result.envelope.data as Record<string, unknown>;
  assertEquals(data.downloadAvailable, true);
  assertEquals(data.narrativeErrorCode, "AI_GENERATION_TIMEOUT");
});

Deno.test("status='done' → downloadAvailable=true", async () => {
  const db = fakeDb({
    id: "11111111-1111-1111-1111-111111111111",
    status: "done",
    narrative_status: "done",
    entry_count: 3,
    error_code: null,
    narrative_error_code: null,
  });
  const result = await handleGetExportStatus(
    ctxFor("11111111-1111-1111-1111-111111111111", { userId: "user-1", accessToken: "t", db }),
  );
  assertEquals((result.envelope.data as Record<string, unknown>).downloadAvailable, true);
});
