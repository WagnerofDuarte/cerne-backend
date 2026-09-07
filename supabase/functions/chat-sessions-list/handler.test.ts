// Teste do handler `chat-sessions-list` (T-045).

import { assert, assertEquals } from "../_shared/_test_utils.ts";
import type { AuthContext, GatewayContext } from "../_shared/gateway.ts";
import { handleListChatSessions, type ListChatSessionsQuery } from "./handler.ts";
import { encodeCursor } from "./cursor.ts";

function row(id: string, updatedAt: string) {
  return {
    id,
    user_id: "u1",
    title: "conversa",
    persona_snapshot: "empatico",
    user_message_count: 1,
    last_user_message_at: null,
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}

function fakeDb(rows: ReturnType<typeof row>[]) {
  // deno-lint-ignore no-explicit-any
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    or: () => builder,
    order: () => builder,
    limit: () => Promise.resolve({ data: rows, error: null }),
  };
  // deno-lint-ignore no-explicit-any
  return { from: () => builder } as any;
}

function ctxFor(
  query: ListChatSessionsQuery,
  db: unknown,
): GatewayContext<undefined, ListChatSessionsQuery> {
  return {
    req: new Request("https://example.test/chat-sessions-list"),
    requestId: "req-1",
    now: new Date("2026-09-14T00:00:00Z"),
    params: {},
    body: undefined,
    query,
    auth: { userId: "u1", accessToken: "t", db } as AuthContext,
    fault: null,
  };
}

Deno.test("menos linhas que o limite: nextCursor null", async () => {
  const db = fakeDb([row("s1", "2026-09-14T00:00:00Z")]);
  const result = await handleListChatSessions(ctxFor({ limit: 20 }, db));
  assertEquals(result.envelope.meta?.nextCursor, null);
  assertEquals((result.envelope.data as unknown[]).length, 1);
});

Deno.test("mais linhas que o limite (limit+1 veio): corta e devolve nextCursor da última linha da página", async () => {
  const db = fakeDb([
    row("s1", "2026-09-14T03:00:00Z"),
    row("s2", "2026-09-14T02:00:00Z"),
  ]);
  const result = await handleListChatSessions(ctxFor({ limit: 1 }, db));
  const data = result.envelope.data as Array<{ id: string }>;
  assertEquals(data.length, 1);
  assertEquals(data[0]?.id, "s1");
  assert(result.envelope.meta?.nextCursor, "deveria ter nextCursor");
  assertEquals(
    result.envelope.meta?.nextCursor,
    encodeCursor({ updatedAt: "2026-09-14T03:00:00Z", id: "s1" }),
  );
});

Deno.test("cursor no query é decodificado antes de consultar (não lança se for válido)", async () => {
  const db = fakeDb([]);
  const cursor = encodeCursor({ updatedAt: "2026-09-14T00:00:00Z", id: "s0" });
  const result = await handleListChatSessions(ctxFor({ cursor, limit: 20 }, db));
  assertEquals(result.status, 200);
});
