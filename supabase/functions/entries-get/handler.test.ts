// Teste do handler `entries-get` (T-039).
// Critério de conclusão do checklist: "recurso de outro usuário retorna
// 404 NOT_FOUND" — nunca 403 (D7).

import { assert, assertEquals, assertThrowsAsync } from "../_shared/_test_utils.ts";
import type { DbClient } from "../_shared/db.ts";
import { CerneError } from "../_shared/errors.ts";
import type { AuthContext, GatewayContext } from "../_shared/gateway.ts";
import { handleGetEntry } from "./handler.ts";

const VALID_ID = "11111111-1111-1111-1111-111111111111";

function makeDb(
  found: Record<string, unknown> | null,
  serverRevision = 1,
): DbClient {
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
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: found, error: null }) }),
          }),
        }),
      };
    },
  } as unknown as DbClient;
}

function ctxFor(id: string, auth: AuthContext): GatewayContext {
  return {
    req: new Request(`https://example.test/entries/${id}`),
    requestId: "req-1",
    now: new Date("2026-09-10T00:00:00Z"),
    params: { id },
    body: undefined,
    query: undefined,
    auth,
    fault: null,
  };
}

Deno.test("entrada encontrada: 200 com o objeto Entry (+ serverRevision, + tags)", async () => {
  const db = makeDb({
    id: VALID_ID,
    user_id: "user-1",
    content: "texto",
    source: "manual",
    chat_message_id: null,
    occurred_at: "2026-09-10T00:00:00Z",
    embedding_status: "ready",
    pii_status: "clean",
    pii_spans: [],
    media_duration_seconds: null,
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
    entry_tags: [{ tags: { id: "t1", name: "trabalho" } }],
  }, 5);
  const result = await handleGetEntry(ctxFor(VALID_ID, { userId: "user-1", accessToken: "t", db }));
  assertEquals(result.status, 200);
  const data = result.envelope.data as Record<string, unknown>;
  assertEquals(data.id, VALID_ID);
  assertEquals(data.serverRevision, 5);
  assertEquals(data.tags, [{ id: "t1", name: "trabalho" }]);
});

Deno.test("entrada inexistente (ou de outro usuário — mesma consulta filtra por user_id) → 404 NOT_FOUND, nunca 403", async () => {
  const db = makeDb(null);
  const err = await assertThrowsAsync(() =>
    handleGetEntry(ctxFor(VALID_ID, { userId: "user-1", accessToken: "t", db }))
  );
  assert(err instanceof CerneError);
  assertEquals((err as CerneError).code, "NOT_FOUND");
  assertEquals((err as CerneError).http, 404);
});

Deno.test("id que não é um uuid válido → 404 NOT_FOUND (nunca erro de sintaxe do banco)", async () => {
  const db = makeDb(null);
  const err = await assertThrowsAsync(() =>
    handleGetEntry(ctxFor("nao-e-um-uuid", { userId: "user-1", accessToken: "t", db }))
  );
  assert(err instanceof CerneError);
  assertEquals((err as CerneError).code, "NOT_FOUND");
});
