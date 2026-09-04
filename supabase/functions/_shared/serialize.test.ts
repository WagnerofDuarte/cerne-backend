// Teste do módulo `serialize` (T-027).
// Critério de conclusão do checklist: "teste de ida e volta passa".

import { assert, assertEquals } from "./_test_utils.ts";
import { errorResponseSchema } from "../../../contracts/zod/common.ts";
import { CerneError } from "./errors.ts";
import {
  buildDataEnvelope,
  buildErrorEnvelope,
  camelToSnake,
  dataResponse,
  errorToResponse,
  snakeToCamel,
} from "./serialize.ts";

const dbRow = {
  id: "11111111-1111-1111-1111-111111111111",
  user_id: "22222222-2222-2222-2222-222222222222",
  chat_message_id: null,
  embedding_status: "ready",
  pii_spans: [{ start: 1, end: 5, type: "nome" }],
  media_duration_seconds: 42,
  server_revision: 3,
  a_b_c: "chave com múltiplos underscores",
};

Deno.test("snakeToCamel converte chaves de nível raiz e aninhadas em array", () => {
  const api = snakeToCamel<Record<string, unknown>>(dbRow);
  assertEquals(api.userId, dbRow.user_id);
  assertEquals(api.chatMessageId, null);
  assertEquals(api.embeddingStatus, "ready");
  assertEquals(api.mediaDurationSeconds, 42);
  assertEquals(api.serverRevision, 3);
  assertEquals(api.aBC, dbRow.a_b_c);
  const [firstSpan] = api.piiSpans as Array<Record<string, unknown>>;
  assertEquals(firstSpan?.start, 1);
});

Deno.test("camelToSnake(snakeToCamel(x)) === x — ida e volta sem perda", () => {
  const api = snakeToCamel(dbRow);
  const back = camelToSnake(api);
  assertEquals(back, dbRow);
});

Deno.test("snakeToCamel(camelToSnake(x)) === x, no sentido inverso", () => {
  const apiShape = {
    chatMessageId: "abc",
    piiSpans: [{ start: 0, end: 3, type: "email" }],
    tags: [{ id: "t1", name: "trabalho" }],
    nested: { deepField: { evenDeeper: 1 } },
  };
  const dbShape = camelToSnake(apiShape);
  const back = snakeToCamel(dbShape);
  assertEquals(back, apiShape);
});

Deno.test("Date vira string ISO (o driver do Postgres devolve Date, a API nunca expõe Date)", () => {
  const row = { created_at: new Date("2026-09-04T09:41:00.000Z") };
  const api = snakeToCamel<{ createdAt: string }>(row);
  assertEquals(api.createdAt, "2026-09-04T09:41:00.000Z");
});

Deno.test("valores primitivos (string/number/boolean/null) não são tratados como objeto", () => {
  assertEquals(snakeToCamel("texto_com_underscore"), "texto_com_underscore");
  assertEquals(snakeToCamel(42), 42);
  assertEquals(snakeToCamel(true), true);
  assertEquals(snakeToCamel(null), null);
});

Deno.test("buildDataEnvelope monta {data, meta} já convertido para camelCase", () => {
  const envelope = buildDataEnvelope(dbRow, { nextCursor: null, total: 1 });
  assertEquals((envelope.data as Record<string, unknown>).userId, dbRow.user_id);
  assertEquals(envelope.meta, { nextCursor: null, total: 1 });
});

Deno.test("buildDataEnvelope sem meta não inclui a chave `meta`", () => {
  const envelope = buildDataEnvelope({ ok: true });
  assert(!("meta" in envelope));
});

Deno.test("buildErrorEnvelope produz exatamente o formato validado por errorResponseSchema", () => {
  const err = new CerneError("NOT_FOUND", "entrada não encontrada");
  const envelope = buildErrorEnvelope(err, "req-abc-123");
  assertEquals(envelope, {
    code: "NOT_FOUND",
    message: "entrada não encontrada",
    retryable: false,
    requestId: "req-abc-123",
  });
  const parsed = errorResponseSchema.safeParse(envelope);
  assert(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues));
});

Deno.test("errorToResponse monta Response com o status HTTP correto e Content-Type json", async () => {
  const res = errorToResponse(new CerneError("VALIDATION_ERROR", "campo inválido"), "req-1");
  assertEquals(res.status, 400);
  assertEquals(res.headers.get("Content-Type"), "application/json");
  const body = await res.json();
  assertEquals(body.code, "VALIDATION_ERROR");
});

Deno.test("errorToResponse lança para NETWORK_OFFLINE (sem status HTTP)", () => {
  let threw = false;
  try {
    errorToResponse(new CerneError("NETWORK_OFFLINE"), "req-1");
  } catch {
    threw = true;
  }
  assert(threw, "deveria lançar em vez de inventar um status para NETWORK_OFFLINE");
});

Deno.test("dataResponse aceita status/headers extras (ex: 202, X-Data-Version)", async () => {
  const res = dataResponse(buildDataEnvelope({ job_id: "j1", status: "pending" }), 202, {
    "X-Data-Version": "7",
  });
  assertEquals(res.status, 202);
  assertEquals(res.headers.get("X-Data-Version"), "7");
  const body = await res.json();
  assertEquals(body.data.jobId, "j1");
});
