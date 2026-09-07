// Teste do handler `chat-messages-list` (T-045).

import { assertEquals, assertThrowsAsync } from "../_shared/_test_utils.ts";
import { CerneError } from "../_shared/errors.ts";
import type { AuthContext, GatewayContext } from "../_shared/gateway.ts";
import { handleListChatMessages } from "./handler.ts";

const SESSION_ID = "00000000-0000-0000-0000-000000000001";

function fakeDb(opts: { session: unknown; messages?: unknown[] }) {
  return {
    from: (table: string) => {
      if (table === "chat_sessions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: opts.session, error: null }),
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: opts.messages ?? [], error: null }),
          }),
        }),
      };
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}

function ctxFor(id: string, db: unknown): GatewayContext {
  return {
    req: new Request("https://example.test/chat-messages-list"),
    requestId: "req-1",
    now: new Date("2026-09-14T00:00:00Z"),
    params: { id },
    body: undefined,
    query: undefined,
    auth: { userId: "u1", accessToken: "t", db } as AuthContext,
    fault: null,
  };
}

Deno.test("sessão inexistente -> NOT_FOUND", async () => {
  const db = fakeDb({ session: null });
  const err = await assertThrowsAsync(() => handleListChatMessages(ctxFor(SESSION_ID, db)));
  assertEquals((err as CerneError).code, "NOT_FOUND");
});

Deno.test("id que não é um uuid -> NOT_FOUND sem consultar o banco", async () => {
  const db = fakeDb({ session: null });
  const err = await assertThrowsAsync(() => handleListChatMessages(ctxFor("nao-e-um-uuid", db)));
  assertEquals((err as CerneError).code, "NOT_FOUND");
});

Deno.test("sessão da própria conta: devolve as mensagens", async () => {
  const db = fakeDb({
    session: { id: SESSION_ID, user_id: "u1" },
    messages: [{ id: "m1", seq: 1 }, { id: "m2", seq: 2 }],
  });
  const result = await handleListChatMessages(ctxFor(SESSION_ID, db));
  assertEquals(result.status, 200);
  assertEquals((result.envelope.data as unknown[]).length, 2);
});
