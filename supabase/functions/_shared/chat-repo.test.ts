// Teste do módulo `chat-repo` (gap-fill da Fase 4).

import { assert, assertEquals } from "./_test_utils.ts";
import type { DbClient } from "./db.ts";
import {
  createChatSession,
  findChatSessionById,
  findMessageById,
  findMessageBySeq,
  insertInsightIfNotExists,
  insertMessage,
  listChatMessages,
  listChatSessions,
  nextSeq,
  setSessionTitleIfEmpty,
  touchSessionUpdatedAt,
  updateInsightResult,
  updateMessage,
} from "./chat-repo.ts";

// --- fake genérico de DbClient (builder encadeável + thenable) ------------

type Call = readonly [string, unknown];

function makeBuilder(result: { data: unknown; error: unknown }, calls: Call[]) {
  // deno-lint-ignore no-explicit-any
  const builder: any = {
    select: (...args: unknown[]) => (calls.push(["select", args]), builder),
    eq: (...args: unknown[]) => (calls.push(["eq", args]), builder),
    or: (...args: unknown[]) => (calls.push(["or", args]), builder),
    order: (...args: unknown[]) => (calls.push(["order", args]), builder),
    limit: (...args: unknown[]) => (calls.push(["limit", args]), builder),
    insert: (payload: unknown) => (calls.push(["insert", payload]), builder),
    update: (payload: unknown) => (calls.push(["update", payload]), builder),
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (r: unknown) => void, reject: (e: unknown) => void) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

function fakeDb(
  result: { data: unknown; error: unknown },
): { db: DbClient; calls: Call[] } {
  const calls: Call[] = [];
  const db = { from: (_table: string) => makeBuilder(result, calls) } as unknown as DbClient;
  return { db, calls };
}

const SESSION_ROW = {
  id: "s1",
  user_id: "u1",
  title: "",
  persona_snapshot: "empatico" as const,
  user_message_count: 0,
  last_user_message_at: null,
  created_at: "2026-09-14T00:00:00Z",
  updated_at: "2026-09-14T00:00:00Z",
};

const MESSAGE_ROW = {
  id: "m1",
  session_id: "s1",
  user_id: "u1",
  role: "user" as const,
  content: "oi",
  seq: 1,
  status: "complete" as const,
  retry_count: 0,
  created_at: "2026-09-14T00:00:00Z",
};

// --- Sessões ---------------------------------------------------------------

Deno.test("createChatSession: insere com persona_snapshot e title default ''", async () => {
  const { db, calls } = fakeDb({ data: SESSION_ROW, error: null });
  const session = await createChatSession(db, { userId: "u1", personaSnapshot: "empatico" });
  assertEquals(session, SESSION_ROW);
  const insertCall = calls.find((c) => c[0] === "insert");
  assertEquals(insertCall?.[1], { user_id: "u1", persona_snapshot: "empatico", title: "" });
});

Deno.test("findChatSessionById: devolve null quando não encontra (sessão de outro usuário ou inexistente)", async () => {
  const { db } = fakeDb({ data: null, error: null });
  const session = await findChatSessionById(db, { userId: "u1", sessionId: "s-inexistente" });
  assertEquals(session, null);
});

Deno.test("findChatSessionById: devolve a linha quando encontra", async () => {
  const { db } = fakeDb({ data: SESSION_ROW, error: null });
  const session = await findChatSessionById(db, { userId: "u1", sessionId: "s1" });
  assertEquals(session, SESSION_ROW);
});

Deno.test("listChatSessions: sem cursor, não chama .or(); ordena updated_at DESC, id ASC; busca limit+1", async () => {
  const { db, calls } = fakeDb({ data: [SESSION_ROW], error: null });
  const rows = await listChatSessions(db, { userId: "u1", limit: 20, cursor: null });
  assertEquals(rows, [SESSION_ROW]);
  assert(!calls.some((c) => c[0] === "or"), "sem cursor não deveria chamar .or()");
  const orderCalls = calls.filter((c) => c[0] === "order");
  assertEquals(orderCalls, [
    ["order", ["updated_at", { ascending: false }]],
    ["order", ["id", { ascending: true }]],
  ]);
  const limitCall = calls.find((c) => c[0] === "limit");
  assertEquals(limitCall?.[1], [21]);
});

Deno.test("listChatSessions: com cursor, monta o filtro .or() de keyset", async () => {
  const { db, calls } = fakeDb({ data: [], error: null });
  await listChatSessions(db, {
    userId: "u1",
    limit: 20,
    cursor: { updatedAt: "2026-09-14T00:00:00Z", id: "s1" },
  });
  const orCall = calls.find((c) => c[0] === "or");
  assertEquals(
    orCall?.[1],
    ["updated_at.lt.2026-09-14T00:00:00Z,and(updated_at.eq.2026-09-14T00:00:00Z,id.gt.s1)"],
  );
});

Deno.test("setSessionTitleIfEmpty: update filtrado por title='' (nunca sobrescreve título já definido)", async () => {
  const { db, calls } = fakeDb({ data: null, error: null });
  await setSessionTitleIfEmpty(db, { sessionId: "s1", title: "novo título" });
  const updateCall = calls.find((c) => c[0] === "update");
  assertEquals(updateCall?.[1], { title: "novo título" });
  const eqCalls = calls.filter((c) => c[0] === "eq");
  assertEquals(eqCalls, [["eq", ["id", "s1"]], ["eq", ["title", ""]]]);
});

Deno.test("touchSessionUpdatedAt: update de updated_at pelo id", async () => {
  const { db, calls } = fakeDb({ data: null, error: null });
  await touchSessionUpdatedAt(db, { sessionId: "s1", updatedAt: "2026-09-14T01:00:00Z" });
  const updateCall = calls.find((c) => c[0] === "update");
  assertEquals(updateCall?.[1], { updated_at: "2026-09-14T01:00:00Z" });
});

// --- Mensagens ---------------------------------------------------------------

Deno.test("listChatMessages: ordena por seq ASC", async () => {
  const { db, calls } = fakeDb({ data: [MESSAGE_ROW], error: null });
  const rows = await listChatMessages(db, { sessionId: "s1" });
  assertEquals(rows, [MESSAGE_ROW]);
  const orderCall = calls.find((c) => c[0] === "order");
  assertEquals(orderCall?.[1], ["seq", { ascending: true }]);
});

Deno.test("nextSeq: sessão vazia -> 1", async () => {
  const { db } = fakeDb({ data: null, error: null });
  assertEquals(await nextSeq(db, "s1"), 1);
});

Deno.test("nextSeq: já existem mensagens -> maior seq + 1", async () => {
  const { db } = fakeDb({ data: { seq: 4 }, error: null });
  assertEquals(await nextSeq(db, "s1"), 5);
});

Deno.test("insertMessage: insere com os campos certos", async () => {
  const { db, calls } = fakeDb({ data: MESSAGE_ROW, error: null });
  const row = await insertMessage(db, {
    sessionId: "s1",
    userId: "u1",
    role: "user",
    content: "oi",
    seq: 1,
    status: "complete",
  });
  assertEquals(row, MESSAGE_ROW);
  const insertCall = calls.find((c) => c[0] === "insert");
  assertEquals(insertCall?.[1], {
    session_id: "s1",
    user_id: "u1",
    role: "user",
    content: "oi",
    seq: 1,
    status: "complete",
  });
});

Deno.test("updateMessage: só inclui no patch os campos passados", async () => {
  const { db, calls } = fakeDb({ data: MESSAGE_ROW, error: null });
  await updateMessage(db, { messageId: "m1", status: "failed" });
  const updateCall = calls.find((c) => c[0] === "update");
  assertEquals(updateCall?.[1], { status: "failed" });
});

Deno.test("updateMessage: content + status + retryCount juntos", async () => {
  const { db, calls } = fakeDb({ data: MESSAGE_ROW, error: null });
  await updateMessage(db, {
    messageId: "m1",
    content: "resposta parcial",
    status: "failed",
    retryCount: 1,
  });
  const updateCall = calls.find((c) => c[0] === "update");
  assertEquals(updateCall?.[1], { content: "resposta parcial", status: "failed", retry_count: 1 });
});

Deno.test("findMessageBySeq: devolve null quando não encontra", async () => {
  const { db } = fakeDb({ data: null, error: null });
  assertEquals(await findMessageBySeq(db, { sessionId: "s1", seq: 99 }), null);
});

Deno.test("findMessageById: devolve a linha quando encontra", async () => {
  const { db } = fakeDb({ data: MESSAGE_ROW, error: null });
  assertEquals(await findMessageById(db, { sessionId: "s1", messageId: "m1" }), MESSAGE_ROW);
});

// --- Insights (T-050) --------------------------------------------------

const INSIGHT_ROW = {
  id: "i1",
  session_id: "s1",
  user_id: "u1",
  trigger_type: "message_count" as const,
  trigger_key: "1",
  status: "generating" as const,
  content: null,
  error_code: null,
  dismissed_at: null,
  created_at: "2026-09-14T00:00:00Z",
};

/** Mock dedicado (não o `makeBuilder` genérico) — a checagem de UNIQUE
 * precisa de resultados DIFERENTES para o insert e para o select de
 * refetch, o que o builder de resultado único não permite. */
function fakeInsightDb(
  opts: {
    insertResult: { data: unknown; error: unknown };
    selectResult?: { data: unknown; error: unknown };
  },
): DbClient {
  return {
    from: (_table: string) => ({
      insert: (_payload: unknown) => ({
        select: (_cols: string) => ({ single: () => Promise.resolve(opts.insertResult) }),
      }),
      select: (_cols: string) => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({ single: () => Promise.resolve(opts.selectResult!) }),
          }),
        }),
      }),
      update: (payload: Record<string, unknown>) => ({
        eq: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: { ...INSIGHT_ROW, ...payload }, error: null }),
          }),
        }),
      }),
    }),
  } as unknown as DbClient;
}

Deno.test("insertInsightIfNotExists: sem conflito -> insere e devolve alreadyExisted=false", async () => {
  const db = fakeInsightDb({ insertResult: { data: INSIGHT_ROW, error: null } });
  const result = await insertInsightIfNotExists(db, {
    sessionId: "s1",
    userId: "u1",
    triggerType: "message_count",
    triggerKey: "1",
  });
  assertEquals(result.alreadyExisted, false);
  assertEquals(result.insight, INSIGHT_ROW);
});

Deno.test("insertInsightIfNotExists: conflito na UNIQUE -> refaz select e devolve alreadyExisted=true", async () => {
  const existing = { ...INSIGHT_ROW, status: "ready" as const, content: "já gerado antes" };
  const db = fakeInsightDb({
    insertResult: { data: null, error: { code: "23505" } },
    selectResult: { data: existing, error: null },
  });
  const result = await insertInsightIfNotExists(db, {
    sessionId: "s1",
    userId: "u1",
    triggerType: "message_count",
    triggerKey: "1",
  });
  assertEquals(result.alreadyExisted, true);
  assertEquals(result.insight, existing);
});

Deno.test("insertInsightIfNotExists: erro que não é UNIQUE propaga", async () => {
  const db = fakeInsightDb({ insertResult: { data: null, error: { code: "42501" } } });
  let threw = false;
  try {
    await insertInsightIfNotExists(db, {
      sessionId: "s1",
      userId: "u1",
      triggerType: "inactivity",
      triggerKey: "m1",
    });
  } catch {
    threw = true;
  }
  assert(threw, "erro que não é 23505 deveria propagar");
});

Deno.test("updateInsightResult: status='ready' com content", async () => {
  const db = fakeInsightDb({ insertResult: { data: null, error: null } });
  const updated = await updateInsightResult(db, {
    insightId: "i1",
    status: "ready",
    content: "texto",
  });
  assertEquals(updated.status, "ready");
  assertEquals(updated.content, "texto");
});

Deno.test("updateInsightResult: status='failed' com errorCode", async () => {
  const db = fakeInsightDb({ insertResult: { data: null, error: null } });
  const updated = await updateInsightResult(db, {
    insightId: "i1",
    status: "failed",
    errorCode: "AI_GENERATION_TIMEOUT",
  });
  assertEquals(updated.status, "failed");
  assertEquals(updated.error_code, "AI_GENERATION_TIMEOUT");
});
