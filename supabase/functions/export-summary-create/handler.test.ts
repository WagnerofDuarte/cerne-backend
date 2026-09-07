// Teste do handler `export-summary-create` (T-053).

import { assert, assertEquals } from "../_shared/_test_utils.ts";
import type { DbClient } from "../_shared/db.ts";
import { CerneError } from "../_shared/errors.ts";
import type { AuthContext, GatewayContext } from "../_shared/gateway.ts";
import { type CreateExportBody, handleCreateExport } from "./handler.ts";

function ctxFor(
  body: CreateExportBody,
  auth: AuthContext,
  fault: GatewayContext["fault"] = null,
): GatewayContext<CreateExportBody, undefined> {
  return {
    req: new Request("https://example.test/export/summary", { method: "POST" }),
    requestId: "req-1",
    now: new Date("2026-09-10T00:00:00Z"),
    params: {},
    body,
    query: undefined,
    auth,
    fault,
  };
}

function fakeDb(
  opts: { entryCount: number | null; rpcError?: unknown },
): { db: DbClient; insertPayload?: Record<string, unknown>; rpcCalls: unknown[] } {
  const state: { insertPayload?: Record<string, unknown> } = {};
  const rpcCalls: unknown[] = [];
  const db = {
    from: (table: string) => {
      if (table === "entries") {
        return {
          select: () => ({
            then: (resolve: (r: { count: number | null; error: null }) => void) =>
              resolve({ count: opts.entryCount, error: null }),
          }),
        };
      }
      // export_jobs
      return {
        insert: (payload: Record<string, unknown>) => {
          state.insertPayload = payload;
          return {
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: { id: "job-1", status: "pending", ...payload },
                  error: null,
                }),
            }),
          };
        },
      };
    },
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({ error: opts.rpcError ?? null });
    },
  } as unknown as DbClient;
  return { db, insertPayload: state.insertPayload, rpcCalls };
}

Deno.test("zero entradas: EXPORT_EMPTY_PERIOD, nunca cria job nem enfileira", async () => {
  const { db, rpcCalls } = fakeDb({ entryCount: 0 });
  let threw: unknown;
  try {
    await handleCreateExport(
      ctxFor(
        { periodStart: null, periodEnd: null, includeNarrative: true },
        { userId: "user-1", accessToken: "t", db },
      ),
    );
  } catch (err) {
    threw = err;
  }
  assert(threw instanceof CerneError);
  assertEquals((threw as CerneError).code, "EXPORT_EMPTY_PERIOD");
  assertEquals(rpcCalls.length, 0, "export_enqueue nunca deveria ser chamado sem job");
});

Deno.test("com entradas: cria o job com entry_count resolvido e enfileira via export_enqueue", async () => {
  const { db, rpcCalls } = fakeDb({ entryCount: 34 });
  const result = await handleCreateExport(
    ctxFor(
      { periodStart: null, periodEnd: null, includeNarrative: true },
      { userId: "user-1", accessToken: "t", db },
    ),
  );
  assertEquals(result.status, 202);
  assertEquals(result.envelope.data, { jobId: "job-1", status: "pending" });
  assertEquals(rpcCalls, [{ name: "export_enqueue", args: { p_job_id: "job-1" } }]);
});

Deno.test("fault ai_timeout: grava export_mark_fault junto do job (migração 0018, repasse pro worker)", async () => {
  const { db, rpcCalls } = fakeDb({ entryCount: 5 });
  await handleCreateExport(
    ctxFor(
      { periodStart: null, periodEnd: null, includeNarrative: true },
      { userId: "user-1", accessToken: "t", db },
      { type: "ai_timeout" },
    ),
  );
  assertEquals(rpcCalls, [
    { name: "export_enqueue", args: { p_job_id: "job-1" } },
    { name: "export_mark_fault", args: { p_job_id: "job-1", p_fault_type: "ai_timeout" } },
  ]);
});

Deno.test("sem fault: nunca chama export_mark_fault", async () => {
  const { rpcCalls, db } = fakeDb({ entryCount: 5 });
  await handleCreateExport(
    ctxFor(
      { periodStart: null, periodEnd: null, includeNarrative: true },
      { userId: "user-1", accessToken: "t", db },
    ),
  );
  assert(!rpcCalls.some((c) => (c as { name: string }).name === "export_mark_fault"));
});

Deno.test("erro ao enfileirar propaga (o gateway trata como 500 genérico, fora da taxonomia)", async () => {
  const { db } = fakeDb({ entryCount: 1, rpcError: new Error("fila indisponível") });
  let threw = false;
  try {
    await handleCreateExport(
      ctxFor(
        { periodStart: null, periodEnd: null, includeNarrative: true },
        { userId: "user-1", accessToken: "t", db },
      ),
    );
  } catch {
    threw = true;
  }
  assert(threw);
});
