// Teste do módulo `contracts` (T-026).
// Critério de conclusão do checklist: "todos os schemas compilam" — este
// teste vai além disso: cada schema mais arriscado (refine, strict, enum)
// também precisa aceitar um exemplo válido e rejeitar o inválido óbvio.

import { z } from "zod";
import { assert, assertEquals } from "../../supabase/functions/_shared/_test_utils.ts";
import { ERROR_CODES } from "../../supabase/functions/_shared/errors.ts";
import * as account from "./account.ts";
import * as chat from "./chat.ts";
import { errorResponseSchema } from "./common.ts";
import * as dashboard from "./dashboard.ts";
import * as entries from "./entries.ts";
import { ENDPOINTS } from "./registry.ts";

// --- Formato do registro ----------------------------------------------

Deno.test("o registro tem exatamente os 23 endpoints do plano técnico §8", () => {
  assertEquals(ENDPOINTS.length, 23);
});

Deno.test("cada (método, caminho) aparece uma única vez", () => {
  const seen = new Set<string>();
  for (const e of ENDPOINTS) {
    const key = `${e.method} ${e.path}`;
    assert(!seen.has(key), `rota duplicada no registro: ${key}`);
    seen.add(key);
  }
});

Deno.test("todo `id` do registro é único", () => {
  const ids = ENDPOINTS.map((e) => e.id);
  assertEquals(new Set(ids).size, ids.length);
});

Deno.test("todos os schemas do registro compilam (são ZodType de verdade)", () => {
  for (const e of ENDPOINTS) {
    if (e.requestBody) assert(e.requestBody instanceof z.ZodType, `${e.id}: requestBody`);
    if (e.requestQuery) assert(e.requestQuery instanceof z.ZodType, `${e.id}: requestQuery`);
    if (e.response.kind === "json") {
      assert(e.response.schema instanceof z.ZodType, `${e.id}: response`);
    }
  }
});

Deno.test("os 6 endpoints SSE/redirect não carregam um schema de resposta JSON", () => {
  const nonJson = ENDPOINTS.filter((e) => e.response.kind !== "json");
  // 2 SSE (mensagem + retry) + 1 redirect (download) = 3, por construção do §8.
  assertEquals(nonJson.length, 3);
});

// --- Exemplos representativos (o parse de verdade, não só "existe") --------

Deno.test("createEntryRequestSchema: refinamento source='chat' <=> chatMessageId", () => {
  const chatMessageId = "11111111-1111-1111-1111-111111111111";

  assert(
    entries.createEntryRequestSchema.safeParse({
      content: "oi",
      source: "manual",
    }).success,
  );

  assert(
    entries.createEntryRequestSchema.safeParse({
      content: "oi",
      source: "chat",
      chatMessageId,
    }).success,
  );

  assert(
    !entries.createEntryRequestSchema.safeParse({ content: "oi", source: "chat" }).success,
    "source='chat' sem chatMessageId deveria falhar",
  );

  assert(
    !entries.createEntryRequestSchema.safeParse({
      content: "oi",
      source: "manual",
      chatMessageId,
    }).success,
    "chatMessageId presente com source != 'chat' deveria falhar",
  );
});

Deno.test("entrySchema aceita um objeto Entry completo e válido", () => {
  const result = entries.entrySchema.safeParse({
    id: "11111111-1111-1111-1111-111111111111",
    content: "conteúdo de teste",
    source: "photo",
    chatMessageId: null,
    occurredAt: "2026-09-04T09:41:00Z",
    tags: [{ id: "22222222-2222-2222-2222-222222222222", name: "trabalho" }],
    piiStatus: "clean",
    piiSpans: [],
    embeddingStatus: "ready",
    mediaDurationSeconds: null,
    serverRevision: 3,
    createdAt: "2026-09-04T09:41:00Z",
    updatedAt: "2026-09-04T09:41:00Z",
  });
  assert(result.success, result.success ? "" : JSON.stringify(result.error.issues));
});

Deno.test("updateAccountSettingsRequestSchema rejeita `email` (strict)", () => {
  assert(account.updateAccountSettingsRequestSchema.safeParse({ displayName: "Wagner" }).success);
  assert(
    !account.updateAccountSettingsRequestSchema.safeParse({ email: "novo@cerne.test" }).success,
    "campo email deveria ser rejeitado pelo strict()",
  );
});

Deno.test("deleteAccountRequestSchema só aceita o literal 'DELETE'", () => {
  assert(account.deleteAccountRequestSchema.safeParse({ confirmation: "DELETE" }).success);
  assert(!account.deleteAccountRequestSchema.safeParse({ confirmation: "delete" }).success);
  assert(!account.deleteAccountRequestSchema.safeParse({ confirmation: "yes" }).success);
});

Deno.test("errorResponseSchema aceita qualquer um dos 13 códigos e rejeita um inventado", () => {
  for (const code of ERROR_CODES) {
    const result = errorResponseSchema.safeParse({
      code,
      message: "mensagem legível",
      retryable: false,
      requestId: "req-123",
    });
    assert(result.success, `código válido ${code} deveria passar`);
  }
  assert(
    !errorResponseSchema.safeParse({
      code: "CODIGO_INVENTADO",
      message: "x",
      retryable: false,
      requestId: "req-123",
    }).success,
  );
});

Deno.test("sequência de eventos SSE do chat é exatamente a da D12, nesta ordem", () => {
  assertEquals(Object.keys(chat.chatStreamEventSchemas), [
    "message_created",
    "context",
    "token",
    "done",
    "error",
  ]);

  assert(
    chat.sseMessageCreatedEventSchema.safeParse({
      userMessageId: "11111111-1111-1111-1111-111111111111",
      assistantMessageId: "22222222-2222-2222-2222-222222222222",
      seq: 1,
    }).success,
  );
  assert(chat.sseTokenEventSchema.safeParse({ text: "olá" }).success);
  assert(
    chat.sseErrorEventSchema.safeParse({
      code: "AI_GENERATION_TIMEOUT",
      message: "timeout",
      retryable: true,
    }).success,
  );
  assert(
    !chat.sseErrorEventSchema.safeParse({
      code: "CODIGO_QUE_NAO_EXISTE",
      message: "timeout",
      retryable: true,
    }).success,
  );
});

Deno.test("retryChatMessageRequestSchema é vazio e estrito (D15 — corpo vazio)", () => {
  assert(chat.retryChatMessageRequestSchema.safeParse({}).success);
  assert(!chat.retryChatMessageRequestSchema.safeParse({ content: "algo" }).success);
});

Deno.test("dashboardAggregateResponseSchema aceita zero entradas (buckets: [])", () => {
  const zeroSources = { manual: 0, audio: 0, photo: 0, chat: 0 };
  const result = dashboard.dashboardAggregateResponseSchema.safeParse({
    data: { buckets: [], totals: { count: 0, sources: zeroSources } },
  });
  assert(result.success, result.success ? "" : JSON.stringify(result.error.issues));
});

Deno.test("createInsightRequestSchema só aceita os dois tipos de gatilho do RF08", () => {
  assert(
    chat.createInsightRequestSchema.safeParse({ triggerType: "message_count", triggerKey: "1" })
      .success,
  );
  assert(
    chat.createInsightRequestSchema.safeParse({ triggerType: "inactivity", triggerKey: "abc" })
      .success,
  );
  assert(
    !chat.createInsightRequestSchema.safeParse({ triggerType: "outro", triggerKey: "1" }).success,
  );
});
