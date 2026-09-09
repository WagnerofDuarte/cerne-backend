// Teste do módulo `export-repo` (T-051/T-053/T-054/T-055, gap-fill da Fase 5).

import { assert, assertEquals } from "./_test_utils.ts";
import type { DbClient } from "./db.ts";
import {
  countEntriesInPeriod,
  createExportJob,
  fetchEntriesForExport,
  findExportJobById,
  getExportJobForWorker,
  updateExportJob,
} from "./export-repo.ts";

// --- fake "de app" (DbClient, filtros/count/select) -----------------------

interface CountResult {
  count: number | null;
  error: unknown;
}

function fakeCountDb(result: CountResult): { db: DbClient; filters: string[] } {
  const filters: string[] = [];
  const builder = {
    gte: (col: string, v: string) => {
      filters.push(`gte:${col}:${v}`);
      return builder;
    },
    lt: (col: string, v: string) => {
      filters.push(`lt:${col}:${v}`);
      return builder;
    },
    then: (resolve: (r: { count: number | null; error: unknown }) => void) => resolve(result),
  };
  const db = {
    from: () => ({ select: () => builder }),
  } as unknown as DbClient;
  return { db, filters };
}

Deno.test("countEntriesInPeriod: sem período, conta tudo (sem filtros de data)", async () => {
  const { db, filters } = fakeCountDb({ count: 5, error: null });
  const count = await countEntriesInPeriod(db, { periodStart: null, periodEnd: null });
  assertEquals(count, 5);
  assertEquals(filters, []);
});

Deno.test("countEntriesInPeriod: com período, aplica gte/lt", async () => {
  const { db, filters } = fakeCountDb({ count: 2, error: null });
  const count = await countEntriesInPeriod(db, {
    periodStart: "2026-09-01T00:00:00Z",
    periodEnd: "2026-09-10T00:00:00Z",
  });
  assertEquals(count, 2);
  assertEquals(filters, [
    "gte:occurred_at:2026-09-01T00:00:00Z",
    "lt:occurred_at:2026-09-10T00:00:00Z",
  ]);
});

Deno.test("countEntriesInPeriod: count null vira 0 (nunca undefined/NaN)", async () => {
  const { db } = fakeCountDb({ count: null, error: null });
  assertEquals(await countEntriesInPeriod(db, { periodStart: null, periodEnd: null }), 0);
});

// --- createExportJob / findExportJobById -----------------------------------

const BASE_JOB = {
  id: "job-1",
  user_id: "user-1",
  period_start: null,
  period_end: null,
  status: "pending" as const,
  narrative_status: "pending" as const,
  entry_count: 3,
  raw_file_path: null,
  pdf_file_path: null,
  error_code: null,
  narrative_error_code: null,
  created_at: "2026-09-10T00:00:00Z",
  updated_at: "2026-09-10T00:00:00Z",
  completed_at: null,
};

function fakeJobDb(
  opts: {
    selectResult?: { data: unknown; error: unknown };
    insertResult?: { data: unknown; error: unknown };
  },
): { db: DbClient; insertPayload?: Record<string, unknown> } {
  const state: { insertPayload?: Record<string, unknown> } = {};
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve(opts.selectResult) }),
          maybeSingle: () => Promise.resolve(opts.selectResult),
        }),
      }),
      insert: (payload: Record<string, unknown>) => {
        state.insertPayload = payload;
        return { select: () => ({ single: () => Promise.resolve(opts.insertResult) }) };
      },
    }),
  } as unknown as DbClient;
  return { db, insertPayload: state.insertPayload };
}

Deno.test("createExportJob: narrative_status='pending' quando includeNarrative=true", async () => {
  const { db } = fakeJobDb({ insertResult: { data: BASE_JOB, error: null } });
  const job = await createExportJob(db, {
    userId: "user-1",
    periodStart: null,
    periodEnd: null,
    includeNarrative: true,
    entryCount: 3,
  });
  assertEquals(job.id, "job-1");
});

Deno.test("createExportJob: narrative_status='skipped' quando includeNarrative=false — nunca tentada", async () => {
  let capturedPatch: Record<string, unknown> | undefined;
  const db = {
    from: () => ({
      insert: (payload: Record<string, unknown>) => {
        capturedPatch = payload;
        return {
          select: () => ({
            single: () => Promise.resolve({ data: { ...BASE_JOB, ...payload }, error: null }),
          }),
        };
      },
    }),
  } as unknown as DbClient;
  await createExportJob(db, {
    userId: "user-1",
    periodStart: null,
    periodEnd: null,
    includeNarrative: false,
    entryCount: 1,
  });
  assertEquals(capturedPatch?.narrative_status, "skipped");
  assertEquals(capturedPatch?.status, "pending");
});

Deno.test("findExportJobById: linha encontrada", async () => {
  const { db } = fakeJobDb({ selectResult: { data: BASE_JOB, error: null } });
  const job = await findExportJobById(db, "user-1", "job-1");
  assertEquals(job?.id, "job-1");
});

Deno.test("findExportJobById: não encontrado (ou de outro dono, RLS) → null, não erro (D7)", async () => {
  const { db } = fakeJobDb({ selectResult: { data: null, error: null } });
  const job = await findExportJobById(db, "user-1", "job-alheio");
  assertEquals(job, null);
});

Deno.test("getExportJobForWorker: sem filtro de dono (worker não tem sessão de usuário)", async () => {
  const { db } = fakeJobDb({ selectResult: { data: BASE_JOB, error: null } });
  // deno-lint-ignore no-explicit-any
  const job = await getExportJobForWorker(db as any, "job-1");
  assertEquals(job?.user_id, "user-1");
});

// --- updateExportJob --------------------------------------------------------

Deno.test("updateExportJob: repassa o patch para .update(), filtra por id", async () => {
  let capturedPatch: unknown;
  let capturedId: unknown;
  const db = {
    from: () => ({
      update: (patch: unknown) => {
        capturedPatch = patch;
        return {
          eq: (_c: string, v: unknown) => {
            capturedId = v;
            return Promise.resolve({ error: null });
          },
        };
      },
    }),
  } as unknown as DbClient;
  // deno-lint-ignore no-explicit-any
  await updateExportJob(db as any, "job-1", { status: "done", pdf_file_path: "x/y.pdf" });
  assertEquals(capturedPatch, { status: "done", pdf_file_path: "x/y.pdf" });
  assertEquals(capturedId, "job-1");
});

Deno.test("updateExportJob: erro do banco propaga (worker decide o que fazer)", async () => {
  const db = {
    from: () => ({
      update: () => ({ eq: () => Promise.resolve({ error: new Error("boom") }) }),
    }),
  } as unknown as DbClient;
  let threw = false;
  try {
    // deno-lint-ignore no-explicit-any
    await updateExportJob(db as any, "job-1", { status: "error" });
  } catch {
    threw = true;
  }
  assert(threw, "erro do banco deveria propagar");
});

// --- fetchEntriesForExport (worker, service_role — sempre filtra user_id) --

Deno.test("fetchEntriesForExport: filtra por user_id explicitamente e ordena occurred_at ASC, id ASC", async () => {
  const calls: string[] = [];
  const rows = [
    { id: "e2", occurred_at: "2026-09-02T00:00:00Z", source: "manual", content: "b" },
    { id: "e1", occurred_at: "2026-09-01T00:00:00Z", source: "audio", content: "a" },
  ];
  const builder = {
    eq: (col: string, v: unknown) => {
      calls.push(`eq:${col}:${v}`);
      return builder;
    },
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
    then: (resolve: (r: { data: unknown; error: null }) => void) =>
      resolve({ data: rows, error: null }),
  };
  const db = { from: () => ({ select: () => builder }) } as unknown as DbClient;

  // deno-lint-ignore no-explicit-any
  const result = await fetchEntriesForExport(db as any, {
    userId: "user-1",
    periodStart: "2026-09-01T00:00:00Z",
    periodEnd: null,
  });
  assertEquals(result, rows);
  assert(
    calls.includes("eq:user_id:user-1"),
    "deveria filtrar explicitamente por user_id (service_role ignora RLS)",
  );
  assert(calls.includes("gte:occurred_at:2026-09-01T00:00:00Z"));
  assert(calls.includes("order:occurred_at:true"));
  assert(calls.includes("order:id:true"));
});
