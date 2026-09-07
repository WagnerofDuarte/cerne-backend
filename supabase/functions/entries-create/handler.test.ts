// Teste do handler `entries-create` (T-035/036/037) — a sequência
// obrigatória completa do §8.2, fim a fim, com banco/Anthropic/Voyage
// mockados.

import { assert, assertEquals, assertThrowsAsync } from "../_shared/_test_utils.ts";
import type { AuthContext, GatewayContext } from "../_shared/gateway.ts";
import type { DbClient } from "../_shared/db.ts";
import type { AiEnv } from "../_shared/deps.ts";
import { CerneError } from "../_shared/errors.ts";
import { type CreateEntryBody, handleCreateEntry } from "./handler.ts";

// --- fake de banco (entries + profiles), com estado, para simular o
// fluxo completo (idempotência otimista, gravação, embedding) ------------

interface EntryRowState extends Record<string, unknown> {
  id: string;
  user_id: string;
  chat_message_id: string | null;
}

function makeFakeDb(state: { entries: EntryRowState[]; serverRevision: number }): DbClient {
  let nextId = state.entries.length + 1;
  return {
    from(table: string) {
      if (table === "profiles") {
        return {
          select: (_cols: string) => ({
            eq: (_c: string, _v: string) => ({
              single: () =>
                Promise.resolve({ data: { server_revision: state.serverRevision }, error: null }),
            }),
          }),
        };
      }
      if (table === "entries") {
        return {
          select: (_cols: string) => ({
            eq: (c1: string, v1: unknown) => ({
              eq: (c2: string, v2: unknown) => ({
                maybeSingle: () => {
                  const found = state.entries.find((e) => e[c1] === v1 && e[c2] === v2);
                  return Promise.resolve({
                    data: found ? { ...found, entry_tags: null } : null,
                    error: null,
                  });
                },
              }),
            }),
          }),
          insert: (payload: Record<string, unknown>) => ({
            select: (_cols: string) => ({
              single: () => {
                if (payload.chat_message_id) {
                  const conflict = state.entries.find(
                    (e) =>
                      e.user_id === payload.user_id &&
                      e.chat_message_id === payload.chat_message_id,
                  );
                  if (conflict) {
                    return Promise.resolve({
                      data: null,
                      error: { code: "23505", message: "duplicate key" },
                    });
                  }
                }
                const row: EntryRowState = {
                  id: `entry-${nextId++}`,
                  user_id: payload.user_id as string,
                  content: payload.content,
                  source: payload.source,
                  chat_message_id: (payload.chat_message_id as string | null) ?? null,
                  occurred_at: payload.occurred_at ?? "2026-09-10T00:00:00Z",
                  embedding_status: payload.embedding_status,
                  pii_status: payload.pii_status,
                  pii_spans: payload.pii_spans,
                  media_duration_seconds: payload.media_duration_seconds ?? null,
                  created_at: "2026-09-10T00:00:00Z",
                  updated_at: "2026-09-10T00:00:00Z",
                };
                state.entries.push(row);
                return Promise.resolve({ data: { ...row, entry_tags: null }, error: null });
              },
            }),
          }),
          update: (payload: Record<string, unknown>) => ({
            eq: (_c: string, id: string) => ({
              select: (_cols: string) => ({
                single: () => {
                  const idx = state.entries.findIndex((e) => e.id === id);
                  state.entries[idx] = { ...state.entries[idx]!, ...payload };
                  return Promise.resolve({
                    data: { ...state.entries[idx], entry_tags: null },
                    error: null,
                  });
                },
              }),
            }),
          }),
        };
      }
      throw new Error(`tabela inesperada em teste: ${table}`);
    },
  } as unknown as DbClient;
}

function dispatchFetch(
  opts: { anthropic?: () => Response; voyage?: () => Response },
): typeof fetch {
  const calls = { anthropic: 0, voyage: 0 };
  const impl = ((url: string | URL) => {
    const u = url.toString();
    if (u.includes("api.anthropic.com")) {
      calls.anthropic++;
      if (!opts.anthropic) throw new Error("chamada inesperada à Anthropic");
      return Promise.resolve(opts.anthropic());
    }
    if (u.includes("api.voyageai.com")) {
      calls.voyage++;
      if (!opts.voyage) throw new Error("chamada inesperada à Voyage");
      return Promise.resolve(opts.voyage());
    }
    throw new Error(`fetch inesperado em teste: ${u}`);
  }) as typeof fetch & { calls: typeof calls };
  impl.calls = calls;
  return impl;
}

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function anthropicPiiResponse(spans: unknown[]): Response {
  return jsonRes(200, {
    id: "msg_1",
    model: "claude-haiku-4-5-20251001",
    content: [{ type: "tool_use", id: "toolu_1", name: "report_pii_spans", input: { spans } }],
    stop_reason: "tool_use",
  });
}

function voyageResponse(dim = 1024): Response {
  return jsonRes(200, { data: [{ embedding: Array(dim).fill(0.01) }] });
}

const baseEnv: Omit<AiEnv, "fetchImpl"> = {
  supabaseUrl: "https://example.test",
  supabaseAnonKey: "anon-key",
  testFaultKey: undefined,
  anthropicApiKey: "anthropic-key",
  voyageApiKey: "voyage-key",
  promptVersion: "v1",
  replayMode: "off",
};

function ctxFor(body: CreateEntryBody, auth: AuthContext): GatewayContext<CreateEntryBody> {
  return {
    req: new Request("https://example.test/entries", { method: "POST" }),
    requestId: "req-1",
    now: new Date("2026-09-10T00:00:00Z"),
    params: {},
    body,
    query: undefined,
    auth,
    fault: null,
  };
}

Deno.test("caminho feliz: PII limpo + embedding pronto → 200, embeddingStatus ready, sem idempotentReplay", async () => {
  const state = { entries: [] as EntryRowState[], serverRevision: 5 };
  const db = makeFakeDb(state);
  const fetchImpl = dispatchFetch({
    anthropic: () => anthropicPiiResponse([]),
    voyage: () => voyageResponse(),
  });
  const result = await handleCreateEntry(
    ctxFor(
      { content: "hoje foi um dia tranquilo", source: "manual" },
      { userId: "user-1", accessToken: "token", db },
    ),
    { ...baseEnv, fetchImpl },
  );
  assertEquals(result.status, 200);
  const data = result.envelope.data as Record<string, unknown>;
  assertEquals(data.piiStatus, "clean");
  assertEquals(data.embeddingStatus, "ready");
  assertEquals(data.serverRevision, 5);
  assertEquals(result.envelope.meta, {});
  assertEquals(state.entries.length, 1);
});

Deno.test("PII flagged: entrada gravada com pii_status='flagged', content intacto", async () => {
  const state = { entries: [] as EntryRowState[], serverRevision: 1 };
  const db = makeFakeDb(state);
  const fetchImpl = dispatchFetch({
    anthropic: () => anthropicPiiResponse([{ start: 20, end: 27, type: "nome" }]),
    voyage: () => voyageResponse(),
  });
  const result = await handleCreateEntry(
    ctxFor(
      { content: "conversei muito com a Ana hoje", source: "manual" },
      { userId: "user-1", accessToken: "token", db },
    ),
    { ...baseEnv, fetchImpl },
  );
  const data = result.envelope.data as Record<string, unknown>;
  assertEquals(data.piiStatus, "flagged");
  assertEquals(data.content, "conversei muito com a Ana hoje"); // D3: nunca censurado
  assertEquals(data.piiSpans, [{ start: 20, end: 27, type: "nome" }]);
});

Deno.test("PII_CHECK_FAILED: nada é gravado", async () => {
  const state = { entries: [] as EntryRowState[], serverRevision: 1 };
  const db = makeFakeDb(state);
  const fetchImpl = dispatchFetch({ anthropic: () => jsonRes(500, { error: "internal" }) });
  const err = await assertThrowsAsync(() =>
    handleCreateEntry(
      ctxFor({ content: "texto qualquer", source: "manual" }, {
        userId: "user-1",
        accessToken: "t",
        db,
      }),
      { ...baseEnv, fetchImpl },
    )
  );
  assert(err instanceof CerneError);
  assertEquals((err as CerneError).code, "PII_CHECK_FAILED");
  assertEquals(state.entries.length, 0, "nada deveria ter sido gravado");
});

Deno.test("EMBEDDING_FAILED (Voyage indisponível): 200, embeddingStatus='failed', entrada permanece", async () => {
  const state = { entries: [] as EntryRowState[], serverRevision: 2 };
  const db = makeFakeDb(state);
  const fetchImpl = dispatchFetch({
    anthropic: () => anthropicPiiResponse([]),
    voyage: () => jsonRes(503, { error: "service unavailable" }),
  });
  const result = await handleCreateEntry(
    ctxFor({ content: "texto qualquer", source: "manual" }, {
      userId: "user-1",
      accessToken: "t",
      db,
    }),
    { ...baseEnv, fetchImpl },
  );
  assertEquals(result.status, 200);
  const data = result.envelope.data as Record<string, unknown>;
  assertEquals(data.embeddingStatus, "failed");
  assertEquals(state.entries.length, 1, "a entrada não pode ser perdida por falha de embedding");
});

Deno.test("idempotência (checagem otimista): chatMessageId já existe → 200 com a entrada existente, sem chamar Anthropic/Voyage", async () => {
  const state = {
    entries: [{
      id: "entry-existente",
      user_id: "user-1",
      chat_message_id: "msg-1",
      content: "mensagem original",
      source: "chat",
      occurred_at: "2026-09-09T00:00:00Z",
      embedding_status: "ready",
      pii_status: "clean",
      pii_spans: [],
      media_duration_seconds: null,
      created_at: "2026-09-09T00:00:00Z",
      updated_at: "2026-09-09T00:00:00Z",
    }] as EntryRowState[],
    serverRevision: 9,
  };
  const db = makeFakeDb(state);
  const fetchImpl = dispatchFetch({}); // nenhuma chamada de IA deveria acontecer
  const result = await handleCreateEntry(
    ctxFor(
      { content: "mensagem original", source: "chat", chatMessageId: "msg-1" },
      { userId: "user-1", accessToken: "t", db },
    ),
    { ...baseEnv, fetchImpl },
  );
  assertEquals(result.status, 200);
  const data = result.envelope.data as Record<string, unknown>;
  assertEquals(data.id, "entry-existente");
  assertEquals(result.envelope.meta, { idempotentReplay: true });
  assertEquals(state.entries.length, 1, "não deveria ter criado uma segunda linha");
  assertEquals(
    (fetchImpl as typeof fetchImpl & { calls: { anthropic: number; voyage: number } }).calls,
    {
      anthropic: 0,
      voyage: 0,
    },
  );
});

Deno.test("corrida real (unique_violation na gravação): devolve a linha vencedora com idempotentReplay=true, mesmo sem embedding", async () => {
  // Simula: a checagem otimista (passo 2) roda e não vê nada (a linha
  // concorrente ainda não existia nesse instante), mas por quando o
  // insert (passo 5) roda, a outra requisição já venceu — só o índice
  // único é quem pega isso de verdade. Um fake dedicado, sequencial: a
  // 1ª leitura de `entries` (checagem otimista) devolve null; a 2ª (o
  // fallback dentro de `insertEntry` após o 23505) devolve a vencedora.
  const winner = {
    id: "entry-vencedora",
    user_id: "user-1",
    chat_message_id: "msg-2",
    content: "mensagem original",
    source: "chat",
    occurred_at: "2026-09-09T00:00:00Z",
    embedding_status: "ready",
    pii_status: "clean",
    pii_spans: [],
    media_duration_seconds: null,
    created_at: "2026-09-09T00:00:00Z",
    updated_at: "2026-09-09T00:00:00Z",
    entry_tags: null,
  };
  let selectCalls = 0;
  const db: DbClient = {
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { server_revision: 3 }, error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => {
                selectCalls++;
                // 1ª chamada (checagem otimista): ainda não viu a corrida.
                // 2ª chamada (fallback do insertEntry): já vê a vencedora.
                return Promise.resolve({ data: selectCalls === 1 ? null : winner, error: null });
              },
            }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: () =>
              Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } }),
          }),
        }),
      };
    },
  } as unknown as DbClient;

  // PII roda antes de sabermos da corrida (o handler só descobre no
  // insert) — mas nunca deveria chegar a chamar Voyage depois.
  const fetchImpl = dispatchFetch({ anthropic: () => anthropicPiiResponse([]) });

  const result = await handleCreateEntry(
    ctxFor(
      { content: "mensagem original", source: "chat", chatMessageId: "msg-2" },
      { userId: "user-1", accessToken: "t", db },
    ),
    { ...baseEnv, fetchImpl },
  );

  assertEquals(result.status, 200);
  const data = result.envelope.data as Record<string, unknown>;
  assertEquals(data.id, "entry-vencedora");
  assertEquals(result.envelope.meta, { idempotentReplay: true });
  assertEquals(
    (fetchImpl as typeof fetchImpl & { calls: { voyage: number } }).calls.voyage,
    0,
    "não deveria ter chamado Voyage — a corrida foi detectada antes do passo de embedding",
  );
});
