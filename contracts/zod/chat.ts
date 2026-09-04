// T-026 — Contratos de Chat (Plano técnico §8.3, D12).

import { z } from "zod";
import {
  cursorPaginationMetaSchema,
  cursorPaginationQuerySchema,
  envelope,
  envelopeWithMeta,
  errorCodeEnum,
  isoDateTimeSchema,
  personaEnum,
  uuidSchema,
} from "./common.ts";

export const chatSessionSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  personaSnapshot: personaEnum,
  userMessageCount: z.number().int().nonnegative(),
  lastUserMessageAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const chatMessageSchema = z.object({
  id: uuidSchema,
  sessionId: uuidSchema,
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  seq: z.number().int().nonnegative(),
  status: z.enum(["streaming", "complete", "failed"]),
  retryCount: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
});

// --- POST /chat/sessions -------------------------------------------------

export const createChatSessionRequestSchema = z.object({
  title: z.string().min(1).optional(),
});

export const createChatSessionResponseSchema = envelope(chatSessionSchema);

// --- GET /chat/sessions ----------------------------------------------------

export const listChatSessionsQuerySchema = cursorPaginationQuerySchema;

export const listChatSessionsResponseSchema = envelopeWithMeta(
  z.array(chatSessionSchema),
  cursorPaginationMetaSchema,
);

// --- GET /chat/sessions/:id/messages ----------------------------------------

export const listChatMessagesResponseSchema = envelope(z.array(chatMessageSchema));

// --- POST /chat/sessions/:id/messages (SSE) e .../retry (SSE) --------------
//
// Corpo de request: só o envio de mensagem tem corpo; o retry (D15) é vazio
// — mesmo histórico e pergunta da tentativa original, por construção.

export const sendChatMessageRequestSchema = z.object({
  content: z.string().min(1).max(8000),
});

export const retryChatMessageRequestSchema = z.object({}).strict();

// Formato fixo dos eventos SSE (D12, tabela da Seção 8.3) — usado pelo
// módulo `sse` (T-044, Fase 4) para validar o que está prestes a emitir, e
// aqui como fonte de verdade do contrato.
export const sseMessageCreatedEventSchema = z.object({
  userMessageId: uuidSchema,
  assistantMessageId: uuidSchema,
  seq: z.number().int().nonnegative(),
});

export const sseContextEventSchema = z.object({
  retrievedEntryIds: z.array(uuidSchema),
});

export const sseTokenEventSchema = z.object({
  text: z.string(),
});

export const sseDoneEventSchema = z.object({
  assistantMessageId: uuidSchema,
  finishReason: z.string(),
});

export const sseErrorEventSchema = z.object({
  code: errorCodeEnum,
  message: z.string(),
  retryable: z.boolean(),
});

// A sequência inteira, nesta ordem, é o contrato de streaming validado por
// `sse_ordem.hurl` (T-044): message_created → context → token* → done|error.
export const chatStreamEventSchemas = {
  message_created: sseMessageCreatedEventSchema,
  context: sseContextEventSchema,
  token: sseTokenEventSchema,
  done: sseDoneEventSchema,
  error: sseErrorEventSchema,
} as const;

// --- POST /chat/sessions/:id/insight ----------------------------------

export const createInsightRequestSchema = z.object({
  triggerType: z.enum(["message_count", "inactivity"]),
  triggerKey: z.string().min(1),
});

// Nunca é erro HTTP (RF08) — falha de geração vira HTTP 200 com
// status='failed' e errorCode preenchido. Por isso errorCode/content são
// mutuamente ligados ao status, não campos sempre presentes.
export const insightSchema = z.object({
  id: uuidSchema,
  sessionId: uuidSchema,
  triggerType: z.enum(["message_count", "inactivity"]),
  triggerKey: z.string(),
  status: z.enum(["generating", "ready", "failed", "dismissed"]),
  content: z.string().nullable(),
  errorCode: errorCodeEnum.nullable(),
  dismissedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});

export const createInsightResponseSchema = envelope(insightSchema);
