// Teste do módulo `entries-repo` (Fase 3, gap-fill).

import { assert, assertEquals } from "./_test_utils.ts";
import type { DbClient } from "./db.ts";
import {
  findEntryByChatMessageId,
  findEntryById,
  insertEntry,
  listEntries,
  markEmbeddingFailed,
  markEmbeddingReady,
  shapeEntryForApi,
} from "./entries-repo.ts";

const BASE_ROW = {
  id: "entry-1",
  user_id: "user-1",
  content: "conteúdo",
  source: "manual" as const,
  chat_message_id: null,
  occurred_at: "2026-09-10T00:00:00Z",
  embedding_status: "pending" as const,
  pii_status: "clean" as const,
  pii_spans: [],
  media_duration_seconds: null,
  created_at: "2026-09-10T00:00:00Z",
  updated_at: "2026-09-10T00:00:00Z",
};

Deno.test("shapeEntryForApi: achata entry_tags(tags(...)) em tags[], filtra null", () => {
  const shaped = shapeEntryForApi({
    ...BASE_ROW,
    entry_tags: [{ tags: { id: "t1", name: "trabalho" } }, { tags: null }],
  });
  assertEquals(shaped.tags, [{ id: "t1", name: "trabalho" }]);
  assert(!("entry_tags" in shaped), "entry_tags não deveria sobreviver na forma de API");
});

Deno.test("shapeEntryForApi: entry_tags null (sem embed) vira tags: []", () => {
  const shaped = shapeEntryForApi({ ...BASE_ROW, entry_tags: null });
  assertEquals(shaped.tags, []);
});

// --- fake de DbClient (chains do supabase-js usadas por este módulo) -----

interface FakeResult {
  data: unknown;
  error: unknown;
}

function fakeDb(opts: {
  select?: FakeResult;
  insert?: (payload: Record<string, unknown>) => FakeResult;
  update?: (payload: Record<string, unknown>) => FakeResult;
}): {
  db: DbClient;
  calls: { insert?: Record<string, unknown>; update?: Record<string, unknown> };
} {
  const calls: { insert?: Record<string, unknown>; update?: Record<string, unknown> } = {};
  const db = {
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_c: string, _v: unknown) {
              return {
                eq(_c2: string, _v2: unknown) {
                  return { maybeSingle: () => Promise.resolve(opts.select) };
                },
              };
            },
          };
        },
        insert(payload: Record<string, unknown>) {
          calls.insert = payload;
          return {
            select(_cols: string) {
              return { single: () => Promise.resolve(opts.insert!(payload)) };
            },
          };
        },
        update(payload: Record<string, unknown>) {
          calls.update = payload;
          return {
            eq(_c: string, _v: unknown) {
              return {
                select(_cols: string) {
                  return { single: () => Promise.resolve(opts.update!(payload)) };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as DbClient;
  return { db, calls };
}

Deno.test("findEntryByChatMessageId: linha encontrada vem com tags achatadas", async () => {
  const { db } = fakeDb({
    select: { data: { ...BASE_ROW, entry_tags: [{ tags: { id: "t1", name: "x" } }] }, error: null },
  });
  const result = await findEntryByChatMessageId(db, "user-1", "msg-1");
  assertEquals(result?.id, "entry-1");
  assertEquals(result?.tags, [{ id: "t1", name: "x" }]);
});

Deno.test("findEntryByChatMessageId: nenhuma linha → null", async () => {
  const { db } = fakeDb({ select: { data: null, error: null } });
  const result = await findEntryByChatMessageId(db, "user-1", "msg-inexistente");
  assertEquals(result, null);
});

Deno.test("findEntryById: mesma forma de findEntryByChatMessageId", async () => {
  const { db } = fakeDb({ select: { data: { ...BASE_ROW, entry_tags: null }, error: null } });
  const result = await findEntryById(db, "user-1", "entry-1");
  assertEquals(result?.id, "entry-1");
  assertEquals(result?.tags, []);
});

Deno.test("insertEntry: sucesso — devolve a entrada, idempotentReplay=false", async () => {
  const { db, calls } = fakeDb({
    insert: () => ({ data: { ...BASE_ROW, entry_tags: null }, error: null }),
  });
  const result = await insertEntry(db, {
    userId: "user-1",
    content: "novo texto",
    source: "manual",
    chatMessageId: null,
    occurredAt: undefined,
    mediaDurationSeconds: null,
    piiStatus: "clean",
    piiSpans: [],
  });
  assertEquals(result.idempotentReplay, false);
  assertEquals(result.entry.id, "entry-1");
  assertEquals(calls.insert?.embedding_status, "pending");
  assert(
    !("occurred_at" in (calls.insert ?? {})),
    "occurredAt ausente não deveria virar chave — deixa o DEFAULT now() do banco agir",
  );
});

Deno.test("insertEntry: colisão no índice único (corrida) → busca e devolve a linha vencedora, idempotentReplay=true", async () => {
  let selectCalls = 0;
  const db = {
    from(_table: string) {
      return {
        insert(_payload: Record<string, unknown>) {
          return {
            select(_cols: string) {
              return {
                single: () =>
                  Promise.resolve({
                    data: null,
                    error: {
                      code: "23505",
                      message: "duplicate key value violates unique constraint",
                    },
                  }),
              };
            },
          };
        },
        select(_cols: string) {
          selectCalls++;
          return {
            eq(_c: string, _v: unknown) {
              return {
                eq(_c2: string, _v2: unknown) {
                  return {
                    maybeSingle: () =>
                      Promise.resolve({ data: { ...BASE_ROW, entry_tags: null }, error: null }),
                  };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as DbClient;

  const result = await insertEntry(db, {
    userId: "user-1",
    content: "tentativa duplicada",
    source: "chat",
    chatMessageId: "msg-1",
    occurredAt: undefined,
    mediaDurationSeconds: null,
    piiStatus: "clean",
    piiSpans: [],
  });
  assertEquals(result.idempotentReplay, true);
  assertEquals(result.entry.id, "entry-1");
  assertEquals(selectCalls, 1);
});

Deno.test("insertEntry: erro que não é 23505 propaga (não é tratado como idempotência)", async () => {
  const { db } = fakeDb({
    insert: () => ({ data: null, error: { code: "23514", message: "check constraint violation" } }),
  });
  let threw = false;
  try {
    await insertEntry(db, {
      userId: "user-1",
      content: "x",
      source: "manual",
      chatMessageId: null,
      occurredAt: undefined,
      mediaDurationSeconds: null,
      piiStatus: "clean",
      piiSpans: [],
    });
  } catch {
    threw = true;
  }
  assert(threw, "erro que não é violação de UNIQUE deveria propagar");
});

Deno.test("markEmbeddingReady: grava os 4 campos de embedding + status ready", async () => {
  const { db, calls } = fakeDb({
    update: () => ({
      data: { ...BASE_ROW, embedding_status: "ready", entry_tags: null },
      error: null,
    }),
  });
  const result = await markEmbeddingReady(db, "entry-1", {
    embedding: [0.1, 0.2],
    model: "voyage-4",
    dimension: 1024,
    inputType: "document",
  });
  assertEquals(result.embedding_status, "ready");
  assertEquals(calls.update?.embedding_model, "voyage-4");
  assertEquals(calls.update?.embedding_status, "ready");
});

Deno.test("markEmbeddingFailed: só muda embedding_status para failed", async () => {
  const { db, calls } = fakeDb({
    update: () => ({
      data: { ...BASE_ROW, embedding_status: "failed", entry_tags: null },
      error: null,
    }),
  });
  const result = await markEmbeddingFailed(db, "entry-1");
  assertEquals(result.embedding_status, "failed");
  assertEquals(calls.update, { embedding_status: "failed" });
});

// --- listEntries (T-038) --------------------------------------------------
//
// Fake de query builder "de verdade" (filtra/ordena/limita um array em
// memória) em vez de canned responses — necessário porque `listEntries`
// monta a query de forma condicional (§8.2: filtros são opcionais) e o
// que se quer testar é exatamente esse comportamento composto.

interface QueryFakeRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  source: string;
  occurred_at: string;
}

function makeQueryFakeDb(allRows: QueryFakeRow[]): DbClient {
  return {
    from(_table: string) {
      let filtered = allRows;
      const orderKeys: Array<{ col: string; asc: boolean }> = [];
      let limitN: number | undefined;

      // deno-lint-ignore no-explicit-any
      const builder: any = {
        select: (_cols: string, _opts?: { count?: string }) => builder,
        eq: (col: string, val: unknown) => {
          filtered = filtered.filter((r) => r[col] === val);
          return builder;
        },
        gte: (col: string, val: string) => {
          filtered = filtered.filter((r) => (r[col] as string) >= val);
          return builder;
        },
        lte: (col: string, val: string) => {
          filtered = filtered.filter((r) => (r[col] as string) <= val);
          return builder;
        },
        or: (expr: string) => {
          // Só entende a forma exata que `listEntries` gera — acoplamento
          // deliberado de teste, ver comentário lá.
          const match = /^occurred_at\.lt\.([^,]+),and\(occurred_at\.eq\.\1,id\.gt\.(.+)\)$/.exec(
            expr,
          );
          if (!match) throw new Error(`fake não entende esta expressão .or(): ${expr}`);
          const [, ts, id] = match;
          filtered = filtered.filter((r) =>
            (r.occurred_at as string) < ts! ||
            (r.occurred_at === ts && (r.id as string) > id!)
          );
          return builder;
        },
        order: (col: string, opts: { ascending: boolean }) => {
          orderKeys.push({ col, asc: opts.ascending });
          return builder;
        },
        limit: (n: number) => {
          limitN = n;
          return builder;
        },
        then: (resolve: (result: { data: unknown; error: unknown; count: number }) => void) => {
          const sorted = [...filtered].sort((a, b) => {
            for (const { col, asc } of orderKeys) {
              const av = a[col] as string;
              const bv = b[col] as string;
              if (av < bv) return asc ? -1 : 1;
              if (av > bv) return asc ? 1 : -1;
            }
            return 0;
          });
          const limited = limitN !== undefined ? sorted.slice(0, limitN) : sorted;
          resolve({
            data: limited.map((r) => ({ ...r, entry_tags: null })),
            error: null,
            count: filtered.length,
          });
        },
      };
      return builder;
    },
  } as unknown as DbClient;
}

function row(id: string, occurredAt: string, source = "manual"): QueryFakeRow {
  return { id, user_id: "user-1", source, occurred_at: occurredAt };
}

Deno.test("listEntries: ordena occurred_at DESC, id ASC (desempate)", async () => {
  const db = makeQueryFakeDb([
    row("b", "2026-09-10T00:00:00Z"),
    row("a", "2026-09-10T00:00:00Z"), // empate de occurred_at com 'b' — 'a' vem antes (id ASC)
    row("c", "2026-09-09T00:00:00Z"),
  ]);
  const { rows, total } = await listEntries(db, { userId: "user-1", limit: 20, cursor: null });
  assertEquals(rows.map((r) => r.id), ["a", "b", "c"]);
  assertEquals(total, 3);
});

Deno.test("listEntries: filtro source combina com os demais (AND)", async () => {
  const db = makeQueryFakeDb([
    row("a", "2026-09-10T00:00:00Z", "manual"),
    row("b", "2026-09-10T00:00:00Z", "audio"),
  ]);
  const { rows, total } = await listEntries(db, {
    userId: "user-1",
    limit: 20,
    cursor: null,
    source: "audio",
  });
  assertEquals(rows.map((r) => r.id), ["b"]);
  assertEquals(total, 1);
});

Deno.test("listEntries: dateFrom/dateTo filtram por occurred_at", async () => {
  const db = makeQueryFakeDb([
    row("a", "2026-09-01T00:00:00Z"),
    row("b", "2026-09-10T00:00:00Z"),
    row("c", "2026-09-20T00:00:00Z"),
  ]);
  const { rows } = await listEntries(db, {
    userId: "user-1",
    limit: 20,
    cursor: null,
    dateFrom: "2026-09-05T00:00:00Z",
    dateTo: "2026-09-15T00:00:00Z",
  });
  assertEquals(rows.map((r) => r.id), ["b"]);
});

Deno.test("listEntries: busca limit+1 (para o handler detectar 'tem próxima página')", async () => {
  const db = makeQueryFakeDb([
    row("a", "2026-09-03T00:00:00Z"),
    row("b", "2026-09-02T00:00:00Z"),
    row("c", "2026-09-01T00:00:00Z"),
  ]);
  const { rows, total } = await listEntries(db, { userId: "user-1", limit: 2, cursor: null });
  assertEquals(rows.length, 3, "deveria trazer limit+1 = 3 linhas");
  assertEquals(total, 3);
});

Deno.test("listEntries: cursor (keyset) pega só o que vem depois, na mesma ordenação", async () => {
  const db = makeQueryFakeDb([
    row("a", "2026-09-10T00:00:00Z"),
    row("b", "2026-09-09T00:00:00Z"),
    row("c", "2026-09-09T00:00:00Z"), // empate com 'b'; 'c' > 'b' (id ASC)
    row("d", "2026-09-08T00:00:00Z"),
  ]);
  // Cursor = posição de 'b' (a última linha da página anterior).
  const { rows } = await listEntries(db, {
    userId: "user-1",
    limit: 20,
    cursor: { occurredAt: "2026-09-09T00:00:00Z", id: "b" },
  });
  assertEquals(rows.map((r) => r.id), ["c", "d"]);
});
