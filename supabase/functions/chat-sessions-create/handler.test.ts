// Teste do handler `chat-sessions-create` (T-045).

import { assertEquals } from "../_shared/_test_utils.ts";
import type { AuthContext, GatewayContext } from "../_shared/gateway.ts";
import { handleCreateChatSession } from "./handler.ts";

function fakeDb(opts: { persona?: string; insertedTitle?: string }) {
  const calls: { insert?: Record<string, unknown> } = {};
  return {
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({ data: { persona: opts.persona ?? "empatico" }, error: null }),
            }),
          }),
        };
      }
      return {
        insert: (payload: Record<string, unknown>) => {
          calls.insert = payload;
          return {
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: {
                    id: "s1",
                    user_id: "u1",
                    title: payload.title,
                    persona_snapshot: payload.persona_snapshot,
                    user_message_count: 0,
                    last_user_message_at: null,
                    created_at: "2026-09-14T00:00:00Z",
                    updated_at: "2026-09-14T00:00:00Z",
                  },
                  error: null,
                }),
            }),
          };
        },
      };
    },
    __calls: calls,
    // deno-lint-ignore no-explicit-any
  } as any;
}

function ctxFor(
  body: { title?: string },
  db: unknown,
): GatewayContext<{ title?: string }> {
  return {
    req: new Request("https://example.test/chat-sessions-create"),
    requestId: "req-1",
    now: new Date("2026-09-14T00:00:00Z"),
    params: {},
    body,
    query: undefined,
    auth: { userId: "u1", accessToken: "t", db } as AuthContext,
    fault: null,
  };
}

Deno.test("sem title no corpo: sessão criada com title='' e persona do perfil", async () => {
  const db = fakeDb({ persona: "socratico" });
  const result = await handleCreateChatSession(ctxFor({}, db));
  assertEquals(result.status, 200);
  const data = result.envelope.data as Record<string, unknown>;
  assertEquals(data.title, "");
  assertEquals(data.personaSnapshot, "socratico");
  assertEquals(db.__calls.insert, { user_id: "u1", persona_snapshot: "socratico", title: "" });
});

Deno.test("com title no corpo: sessão criada com esse título (não fica vazia)", async () => {
  const db = fakeDb({ persona: "analitico" });
  const result = await handleCreateChatSession(ctxFor({ title: "minha conversa" }, db));
  const data = result.envelope.data as Record<string, unknown>;
  assertEquals(data.title, "minha conversa");
});
