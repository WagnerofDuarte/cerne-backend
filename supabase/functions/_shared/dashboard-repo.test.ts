// Teste do módulo `dashboard-repo` (T-056/T-057, gap-fill da Fase 5).

import { assert, assertEquals } from "./_test_utils.ts";
import type { DbClient } from "./db.ts";
import {
  fetchAggregateCounts,
  fetchEntriesForNarrative,
  periodStartFor,
} from "./dashboard-repo.ts";

Deno.test("periodStartFor: 'all' não tem limite inferior (null)", () => {
  assertEquals(periodStartFor("all", new Date("2026-09-23T09:41:00Z")), null);
});

Deno.test("periodStartFor: '7d' = now - 7 dias, em ISO", () => {
  const now = new Date("2026-09-23T09:41:00Z");
  assertEquals(periodStartFor("7d", now), "2026-09-16T09:41:00.000Z");
});

Deno.test("periodStartFor: '30d' e '90d' calculam corretamente", () => {
  const now = new Date("2026-09-23T00:00:00Z");
  assertEquals(periodStartFor("30d", now), "2026-08-24T00:00:00.000Z");
  assertEquals(periodStartFor("90d", now), "2026-06-25T00:00:00.000Z");
});

Deno.test("periodStartFor: usa `now` recebido (respeita X-Test-Now via clock.ts), nunca o relógio real diretamente", () => {
  const frozen = new Date("2020-01-08T00:00:00Z");
  assertEquals(periodStartFor("7d", frozen), "2020-01-01T00:00:00.000Z");
});

Deno.test("fetchAggregateCounts: repassa p_period_start/p_period_end para a RPC e devolve as linhas", async () => {
  let capturedArgs: unknown;
  const db = {
    rpc: (name: string, args: unknown) => {
      assertEquals(name, "dashboard_aggregate_counts");
      capturedArgs = args;
      return Promise.resolve({
        data: [{ bucket_date: "2026-09-01", source: "manual", entry_count: 2 }],
        error: null,
      });
    },
  } as unknown as DbClient;

  const rows = await fetchAggregateCounts(db, {
    periodStart: "2026-09-01T00:00:00Z",
    periodEnd: null,
  });
  assertEquals(capturedArgs, { p_period_start: "2026-09-01T00:00:00Z", p_period_end: null });
  assertEquals(rows, [{ bucket_date: "2026-09-01", source: "manual", entry_count: 2 }]);
});

Deno.test("fetchAggregateCounts: erro do banco propaga", async () => {
  const db = {
    rpc: () => Promise.resolve({ data: null, error: new Error("boom") }),
  } as unknown as DbClient;
  let threw = false;
  try {
    await fetchAggregateCounts(db, { periodStart: null, periodEnd: null });
  } catch {
    threw = true;
  }
  assert(threw);
});

Deno.test("fetchEntriesForNarrative: aplica filtros de período, ordena occurred_at DESC/id ASC, limita a 100", async () => {
  const calls: string[] = [];
  const builder = {
    gte: (col: string, v: unknown) => {
      calls.push(`gte:${col}:${v}`);
      return builder;
    },
    lt: (col: string, v: unknown) => {
      calls.push(`lt:${col}:${v}`);
      return builder;
    },
    order: (col: string, opts: { ascending: boolean }) => {
      calls.push(`order:${col}:${opts.ascending}`);
      return builder;
    },
    limit: (n: number) => {
      calls.push(`limit:${n}`);
      return builder;
    },
    then: (resolve: (r: { data: unknown; error: null }) => void) =>
      resolve({
        data: [{ id: "e1", content: "x", occurred_at: "2026-09-01T00:00:00Z" }],
        error: null,
      }),
  };
  const db = { from: () => ({ select: () => builder }) } as unknown as DbClient;

  const rows = await fetchEntriesForNarrative(db, {
    periodStart: "2026-09-01T00:00:00Z",
    periodEnd: "2026-09-10T00:00:00Z",
  });
  assertEquals(rows, [{ id: "e1", content: "x" }]);
  assert(calls.includes("gte:occurred_at:2026-09-01T00:00:00Z"));
  assert(calls.includes("lt:occurred_at:2026-09-10T00:00:00Z"));
  assert(calls.includes("order:occurred_at:false"));
  assert(calls.includes("order:id:true"));
  assert(calls.includes("limit:100"));
});
