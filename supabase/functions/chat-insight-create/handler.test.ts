// Teste do handler `chat-insight-create` (T-050, RF08).
// Critérios de conclusão: "insight_unico.hurl e insight_falha.hurl verdes"
// — verificados aqui a nível de unidade (dois POSTs com o mesmo
// triggerKey -> mesmo id; com ai_timeout -> HTTP 200, status='failed').

import { assert, assertEquals, assertThrowsAsync } from "../_shared/_test_utils.ts";
import type { AiEnv } from "../_shared/deps.ts";
import { CerneError } from "../_shared/errors.ts";
import type { AuthContext, GatewayContext } from "../_shared/gateway.ts";
import { handleCreateInsight } from "./handler.ts";

const SESSION_ID = "00000000-0000-0000-0000-000000000001";

interface DbState {
  session: Record<string, unknown> | null;
  history: Array<{ id: string; role: "user" | "assistant"; content: string; seq: number }>;
  existingInsight: Record<string, unknown> | null;
  inserted: Record<string, unknown>[];
  updates: Record<string, unknown>[];
  replayHit: { response: unknown; hit_count: number } | null;
}

function makeState(overrides: Partial<DbState> = {}): DbState {
  return {
    session: {
      id: SESSION_ID,
      user_id: "u1",
      title: "conversa",
      persona_snapshot: "empatico",
      user_message_count: 5,
      last_user_message_at: null,
      created_at: "2026-09-14T00:00:00Z",
      updated_at: "2026-09-14T00:00:00Z",
    },
    history: [{ id: "m1", role: "user", content: "oi", seq: 1 }],
    existingInsight: null,
    inserted: [],
    updates: [],
    replayHit: null,
    ...overrides,
  };
}

function fakeDb(state: DbState) {
  const db = {
    from(table: string) {
      if (table === "chat_sessions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: state.session, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "chat_messages") {
        return {
          select: () => ({
            eq: () => ({ order: () => Promise.resolve({ data: state.history, error: null }) }),
          }),
        };
      }
      if (table === "insights") {
        return {
          insert: (payload: Record<string, unknown>) => ({
            select: () => ({
              single: () => {
                if (state.existingInsight) {
                  return Promise.resolve({ data: null, error: { code: "23505" } });
                }
                const row = {
                  id: "insight-1",
                  session_id: payload.session_id,
                  user_id: payload.user_id,
                  trigger_type: payload.trigger_type,
                  trigger_key: payload.trigger_key,
                  status: "generating",
                  content: null,
                  error_code: null,
                  dismissed_at: null,
                  created_at: "2026-09-14T00:00:00Z",
                };
                state.inserted.push(row);
                return Promise.resolve({ data: row, error: null });
              },
            }),
          }),
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  single: () => Promise.resolve({ data: state.existingInsight, error: null }),
                }),
              }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            state.updates.push(payload);
            return {
              eq: () => ({
                select: () => ({
                  single: () =>
                    Promise.resolve({
                      data: { ...(state.inserted[0] ?? {}), ...payload },
                      error: null,
                    }),
                }),
              }),
            };
          },
        };
      }
      throw new Error(`tabela não esperada no teste: ${table}`);
    },
    rpc(name: string, _args: Record<string, unknown>) {
      if (name === "experiment_replay_cache_lookup") {
        return Promise.resolve({ data: state.replayHit ? [state.replayHit] : [], error: null });
      }
      if (name === "experiment_replay_cache_store") {
        return Promise.resolve({ data: null, error: null });
      }
      throw new Error(`rpc não esperada no teste: ${name}`);
    },
    // deno-lint-ignore no-explicit-any
  } as any;
  return db;
}

function fakeAnthropicFetch(status: number, body: unknown): typeof fetch {
  return (() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as typeof fetch;
}

const baseEnv: AiEnv = {
  supabaseUrl: "https://example.test",
  supabaseAnonKey: "anon-key",
  testFaultKey: undefined,
  anthropicApiKey: "anthropic-key",
  voyageApiKey: "voyage-key",
  promptVersion: "v1",
  replayMode: "replay",
};

function ctxFor(
  body: { triggerType: "message_count" | "inactivity"; triggerKey: string },
  db: unknown,
  fault: { type: string } | null = null,
): GatewayContext<{ triggerType: "message_count" | "inactivity"; triggerKey: string }> {
  return {
    req: new Request("https://example.test/chat-insight-create"),
    requestId: "req-1",
    now: new Date("2026-09-14T00:00:00Z"),
    params: { id: SESSION_ID },
    body,
    query: undefined,
    auth: { userId: "u1", accessToken: "t", db } as AuthContext,
    // deno-lint-ignore no-explicit-any
    fault: fault as any,
  };
}

Deno.test("sessão inexistente -> NOT_FOUND", async () => {
  const db = fakeDb(makeState({ session: null }));
  const env = { ...baseEnv, fetchImpl: fakeAnthropicFetch(200, {}) };
  const err = await assertThrowsAsync(() =>
    handleCreateInsight(ctxFor({ triggerType: "message_count", triggerKey: "1" }, db), env)
  );
  assertEquals((err as CerneError).code, "NOT_FOUND");
});

Deno.test("conflito na UNIQUE: devolve o insight existente, sem gerar de novo (mesmo id)", async () => {
  const existing = {
    id: "insight-existente",
    session_id: SESSION_ID,
    user_id: "u1",
    trigger_type: "message_count",
    trigger_key: "1",
    status: "ready",
    content: "já gerado antes",
    error_code: null,
    dismissed_at: null,
    created_at: "2026-09-14T00:00:00Z",
  };
  const state = makeState({ existingInsight: existing });
  const db = fakeDb(state);
  const fetchImpl = (() => {
    throw new Error("não deveria chamar a Anthropic quando já existe");
  }) as unknown as typeof fetch;
  const env = { ...baseEnv, fetchImpl };

  const result = await handleCreateInsight(
    ctxFor({ triggerType: "message_count", triggerKey: "1" }, db),
    env,
  );
  assertEquals(result.status, 200);
  assertEquals((result.envelope.data as Record<string, unknown>).id, "insight-existente");
  assertEquals(state.updates.length, 0);
});

Deno.test("caminho feliz: gera via Haiku, grava status='ready' com o conteúdo", async () => {
  const state = makeState();
  const db = fakeDb(state);
  const env = {
    ...baseEnv,
    fetchImpl: fakeAnthropicFetch(200, {
      id: "msg_1",
      content: [{ type: "text", text: "Você parece mais tranquilo hoje." }],
      stop_reason: "end_turn",
    }),
  };

  const result = await handleCreateInsight(
    ctxFor({ triggerType: "message_count", triggerKey: "1" }, db),
    env,
  );
  assertEquals(result.status, 200);
  const data = result.envelope.data as Record<string, unknown>;
  assertEquals(data.status, "ready");
  assertEquals(data.content, "Você parece mais tranquilo hoje.");
  assertEquals(state.updates[0], { status: "ready", content: "Você parece mais tranquilo hoje." });
});

Deno.test("fault ai_timeout: HTTP 200, status='failed', errorCode preenchido — nunca erro HTTP (critério de conclusão)", async () => {
  const state = makeState();
  const db = fakeDb(state);
  const fetchImpl = (() => {
    throw new Error("ai_timeout não deveria chamar a Anthropic de verdade");
  }) as unknown as typeof fetch;
  const env = { ...baseEnv, fetchImpl };

  const result = await handleCreateInsight(
    ctxFor({ triggerType: "inactivity", triggerKey: "m5" }, db, { type: "ai_timeout" }),
    env,
  );
  assertEquals(result.status, 200);
  const data = result.envelope.data as Record<string, unknown>;
  assertEquals(data.status, "failed");
  assertEquals(data.errorCode, "AI_GENERATION_TIMEOUT");
});

Deno.test("Anthropic indisponível de verdade: também HTTP 200, status='failed'", async () => {
  const state = makeState();
  const db = fakeDb(state);
  const env = {
    ...baseEnv,
    fetchImpl: fakeAnthropicFetch(529, { error: { message: "sobrecarregado" } }),
  };

  const result = await handleCreateInsight(
    ctxFor({ triggerType: "message_count", triggerKey: "2" }, db),
    env,
  );
  assertEquals(result.status, 200);
  const data = result.envelope.data as Record<string, unknown>;
  assertEquals(data.status, "failed");
  assert(data.errorCode);
});
