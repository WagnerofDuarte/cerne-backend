// Teste do handler `chat-messages-retry` (T-048, D15).
// Critério de conclusão: "retry_chat.hurl verde — X-Replay-Status: hit e
// retry_count=1" (verificado aqui a nível de unidade: mesmo
// histórico/pergunta/RAG produz o mesmo envelope, então um cache já
// populado da 1ª tentativa é servido como hit).

import { assert, assertEquals, assertThrowsAsync } from "../_shared/_test_utils.ts";
import type { AiEnv } from "../_shared/deps.ts";
import { CerneError } from "../_shared/errors.ts";
import type { AuthContext, GatewayContext } from "../_shared/gateway.ts";
import { handleRetryChatMessage } from "./handler.ts";

const SESSION_ID = "00000000-0000-0000-0000-000000000001";

function msgId(n: number): string {
  return `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
}

interface FakeMessage {
  id: string;
  session_id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  seq: number;
  status: "streaming" | "complete" | "failed";
  retry_count: number;
  created_at: string;
}

function msg(
  n: number,
  role: "user" | "assistant",
  overrides: Partial<FakeMessage> = {},
): FakeMessage {
  return {
    id: msgId(n),
    session_id: SESSION_ID,
    user_id: "u1",
    role,
    content: role === "user" ? `pergunta ${n}` : `resposta ${n}`,
    seq: n,
    status: "complete",
    retry_count: 0,
    created_at: "2026-09-14T00:00:00Z",
    ...overrides,
  };
}

interface DbState {
  session: Record<string, unknown> | null;
  messages: FakeMessage[];
  ragRows: Array<Record<string, unknown>>;
  replayHit: { response: unknown; hit_count: number } | null;
  updates: Record<string, unknown>[];
  replayStores: unknown[];
}

function makeState(overrides: Partial<DbState> = {}): DbState {
  return {
    session: {
      id: SESSION_ID,
      user_id: "u1",
      title: "conversa",
      persona_snapshot: "empatico",
      user_message_count: 2,
      last_user_message_at: null,
      created_at: "2026-09-14T00:00:00Z",
      updated_at: "2026-09-14T00:00:00Z",
    },
    messages: [],
    ragRows: [],
    replayHit: null,
    updates: [],
    replayStores: [],
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
            eq: () => ({ order: () => Promise.resolve({ data: state.messages, error: null }) }),
          }),
          update: (payload: Record<string, unknown>) => {
            state.updates.push(payload);
            return {
              eq: () => ({
                select: () => ({
                  single: () =>
                    Promise.resolve({ data: { id: msgId(999), ...payload }, error: null }),
                }),
              }),
            };
          },
        };
      }
      throw new Error(`tabela não esperada no teste: ${table}`);
    },
    rpc(name: string, args: Record<string, unknown>) {
      if (name === "entries_search_by_embedding") {
        return Promise.resolve({ data: state.ragRows, error: null });
      }
      if (name === "experiment_replay_cache_lookup") {
        return Promise.resolve({ data: state.replayHit ? [state.replayHit] : [], error: null });
      }
      if (name === "experiment_replay_cache_store") {
        state.replayStores.push(args);
        return Promise.resolve({ data: null, error: null });
      }
      throw new Error(`rpc não esperada no teste: ${name}`);
    },
    // deno-lint-ignore no-explicit-any
  } as any;
  return db;
}

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function fakeFetch(opts: { anthropicDeltas?: string[] } = {}): typeof fetch {
  const frames = [
    ...(opts.anthropicDeltas ?? ["ok"]).map((d) =>
      sseFrame("content_block_delta", { delta: { text: d } })
    ),
    sseFrame("message_delta", { delta: { stop_reason: "end_turn" } }),
  ].join("");
  const encoder = new TextEncoder();
  return ((url: string | URL | Request) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (href.includes("voyageai.com")) {
      return Promise.resolve(
        new Response(JSON.stringify({ data: [{ embedding: Array(1024).fill(0.01) }] }), {
          status: 200,
        }),
      );
    }
    if (href.includes("anthropic.com")) {
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode(frames));
              controller.close();
            },
          }),
          { status: 200 },
        ),
      );
    }
    throw new Error(`URL inesperada: ${href}`);
  }) as unknown as typeof fetch;
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
  db: unknown,
  params: { id: string; userMessageId: string },
): GatewayContext<Record<string, never>> {
  return {
    req: new Request("https://example.test/chat-messages-retry"),
    requestId: "req-1",
    now: new Date("2026-09-14T00:00:00Z"),
    params,
    body: {},
    query: undefined,
    auth: { userId: "u1", accessToken: "t", db } as AuthContext,
    fault: null,
  };
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  return text;
}

// --- Caminho feliz -----------------------------------------------------

Deno.test("caminho feliz: reabre a mesma linha do assistente, incrementa retry_count, reemite via cache (hit)", async () => {
  const state = makeState({
    messages: [
      msg(1, "user"),
      msg(2, "assistant"),
      msg(3, "user", { content: "pergunta atual" }),
      msg(4, "assistant", { status: "failed", retry_count: 0 }),
    ],
    replayHit: { response: { text: "resposta do cache", finishReason: "end_turn" }, hit_count: 1 },
  });
  const db = fakeDb(state);
  const env = { ...baseEnv, fetchImpl: fakeFetch() };

  const result = await handleRetryChatMessage(
    ctxFor(db, { id: SESSION_ID, userMessageId: msgId(3) }),
    env,
  );
  assertEquals(result.headers, { "X-Replay-Status": "hit" });

  const text = await drain(result.stream);
  assert(text.includes("event: message_created"));
  assert(text.includes("event: context"));
  assert(text.includes("event: done"));
  assert(!text.includes("event: error"));

  // 1º update: reabre a linha (content='', streaming, retry_count=1)
  assertEquals(state.updates[0], { content: "", status: "streaming", retry_count: 1 });
  // 2º update: finaliza com o texto do cache
  assertEquals(state.updates[1], { content: "resposta do cache", status: "complete" });
});

Deno.test("userMessageId não é a última mensagem do usuário -> VALIDATION_ERROR", async () => {
  const state = makeState({
    messages: [
      msg(1, "user"),
      msg(2, "assistant"),
      msg(3, "user"), // mais nova — a msg(1) não é mais a última do usuário
      msg(4, "assistant"),
    ],
  });
  const db = fakeDb(state);
  const env = { ...baseEnv, fetchImpl: fakeFetch() };
  const err = await assertThrowsAsync(() =>
    handleRetryChatMessage(ctxFor(db, { id: SESSION_ID, userMessageId: msgId(1) }), env)
  );
  assertEquals((err as CerneError).code, "VALIDATION_ERROR");
});

Deno.test("userMessageId inexistente na sessão -> VALIDATION_ERROR", async () => {
  const state = makeState({ messages: [msg(1, "user"), msg(2, "assistant")] });
  const db = fakeDb(state);
  const env = { ...baseEnv, fetchImpl: fakeFetch() };
  const err = await assertThrowsAsync(() =>
    handleRetryChatMessage(ctxFor(db, { id: SESSION_ID, userMessageId: msgId(999) }), env)
  );
  assertEquals((err as CerneError).code, "VALIDATION_ERROR");
});

Deno.test("sessão inexistente -> NOT_FOUND", async () => {
  const state = makeState({ session: null });
  const db = fakeDb(state);
  const env = { ...baseEnv, fetchImpl: fakeFetch() };
  const err = await assertThrowsAsync(() =>
    handleRetryChatMessage(ctxFor(db, { id: SESSION_ID, userMessageId: msgId(1) }), env)
  );
  assertEquals((err as CerneError).code, "NOT_FOUND");
});

Deno.test("miss (cache vazio): gera de verdade, retry_count some no update de reabertura", async () => {
  const state = makeState({
    messages: [msg(1, "user"), msg(2, "assistant", { status: "failed", retry_count: 2 })],
    replayHit: null,
  });
  const db = fakeDb(state);
  const env = { ...baseEnv, fetchImpl: fakeFetch({ anthropicDeltas: ["nova", " resposta"] }) };

  const result = await handleRetryChatMessage(
    ctxFor(db, { id: SESSION_ID, userMessageId: msgId(1) }),
    env,
  );
  assertEquals(result.headers, { "X-Replay-Status": "miss" });
  await drain(result.stream);

  assertEquals(state.updates[0], { content: "", status: "streaming", retry_count: 3 });
  assertEquals(state.updates[1], { content: "nova resposta", status: "complete" });
});
