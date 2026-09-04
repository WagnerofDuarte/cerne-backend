// Teste do handler `entries-list` (T-038) — foco no que o handler faz por
// cima de `listEntries` (já testado isoladamente em entries-repo.test.ts):
// corte de página / nextCursor, injeção de serverRevision por item,
// header X-Data-Version.

import { assertEquals } from "../_shared/_test_utils.ts";
import type { DbClient } from "../_shared/db.ts";
import type { AuthContext, GatewayContext } from "../_shared/gateway.ts";
import { handleListEntries, type ListEntriesQuery } from "./handler.ts";
import { encodeCursor } from "./cursor.ts";

interface FakeRow extends Record<string, unknown> {
  id: string;
  occurred_at: string;
}

/** `db` mínimo: só o suficiente para `listEntries` + `fetchServerRevision` — não reexercita a lógica de filtro/ordenação, isso já está coberto em entries-repo.test.ts. */
function makeDb(rows: FakeRow[], serverRevision: number): DbClient {
  return {
    from(table: string) {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({ data: { server_revision: serverRevision }, error: null }),
            }),
          }),
        };
      }
      // "entries": devolve exatamente `rows` (já no formato limit+1 que o
      // teste decide), ignorando filtros — o objetivo aqui é só o handler.
      const builder = {
        select: () => builder,
        eq: () => builder,
        gte: () => builder,
        lte: () => builder,
        or: () => builder,
        order: () => builder,
        limit: () => builder,
        then: (resolve: (r: { data: unknown; error: null; count: number }) => void) =>
          resolve({
            data: rows.map((r) => ({ ...r, entry_tags: null })),
            error: null,
            count: rows.length,
          }),
      };
      return builder;
    },
  } as unknown as DbClient;
}

function ctxFor(
  query: ListEntriesQuery,
  auth: AuthContext,
): GatewayContext<undefined, ListEntriesQuery> {
  return {
    req: new Request("https://example.test/entries"),
    requestId: "req-1",
    now: new Date("2026-09-10T00:00:00Z"),
    params: {},
    body: undefined,
    query,
    auth,
    fault: null,
  };
}

Deno.test("sem próxima página: nextCursor null, todas as linhas devolvidas, serverRevision em cada item", async () => {
  const rows: FakeRow[] = [
    { id: "a", occurred_at: "2026-09-10T00:00:00Z" },
    { id: "b", occurred_at: "2026-09-09T00:00:00Z" },
  ];
  const db = makeDb(rows, 7);
  const result = await handleListEntries(
    ctxFor({ limit: 20 }, { userId: "u1", accessToken: "t", db }),
  );
  assertEquals(result.status, 200);
  const data = result.envelope.data as Array<Record<string, unknown>>;
  assertEquals(data.length, 2);
  assertEquals(data.every((e) => e.serverRevision === 7), true);
  assertEquals(result.envelope.meta, { nextCursor: null, total: 2 });
  assertEquals(new Headers(result.headers).get("X-Data-Version"), "7");
});

Deno.test("com próxima página (limit+1 veio): corta em `limit`, nextCursor aponta pro último item mantido", async () => {
  // limit=2, mas listEntries busca limit+1=3 — o fake devolve as 3 direto.
  const rows: FakeRow[] = [
    { id: "a", occurred_at: "2026-09-10T00:00:00Z" },
    { id: "b", occurred_at: "2026-09-09T00:00:00Z" },
    { id: "c", occurred_at: "2026-09-08T00:00:00Z" }, // a "+1" — só sinaliza que há mais
  ];
  const db = makeDb(rows, 1);
  const result = await handleListEntries(
    ctxFor({ limit: 2 }, { userId: "u1", accessToken: "t", db }),
  );
  const data = result.envelope.data as Array<Record<string, unknown>>;
  assertEquals(data.map((e) => e.id), ["a", "b"]); // 'c' cortado — era só o sinalizador
  const meta = result.envelope.meta as { nextCursor: string; total: number };
  assertEquals(meta.nextCursor, encodeCursor({ occurredAt: "2026-09-09T00:00:00Z", id: "b" }));
});

Deno.test("limit ausente usa o default (20)", async () => {
  const db = makeDb([{ id: "a", occurred_at: "2026-09-10T00:00:00Z" }], 1);
  const result = await handleListEntries(ctxFor({}, { userId: "u1", accessToken: "t", db }));
  assertEquals(result.status, 200);
  assertEquals((result.envelope.data as unknown[]).length, 1);
});

Deno.test("lista vazia: data=[], nextCursor null, total 0", async () => {
  const db = makeDb([], 0);
  const result = await handleListEntries(ctxFor({}, { userId: "u1", accessToken: "t", db }));
  assertEquals(result.envelope.data, []);
  assertEquals(result.envelope.meta, { nextCursor: null, total: 0 });
});
