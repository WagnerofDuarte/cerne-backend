// T-026 — Contratos de Entradas (Plano técnico §8.2).

import { z } from "zod";
import {
  cursorPaginationMetaSchema,
  cursorPaginationQuerySchema,
  embeddingStatusEnum,
  envelope,
  envelopeWithMeta,
  isoDateTimeSchema,
  piiSpanSchema,
  piiStatusEnum,
  sourceEnum,
  tagSchema,
  uuidSchema,
} from "./common.ts";

// Objeto `Entry` — resposta de POST /entries, GET /entries (item da lista) e
// GET /entries/:id. Campos exatamente os listados em §8.2.
export const entrySchema = z.object({
  id: uuidSchema,
  content: z.string().min(1).max(20000),
  source: sourceEnum,
  chatMessageId: uuidSchema.nullable(),
  occurredAt: isoDateTimeSchema,
  tags: z.array(tagSchema),
  piiStatus: piiStatusEnum,
  piiSpans: z.array(piiSpanSchema),
  embeddingStatus: embeddingStatusEnum,
  mediaDurationSeconds: z.number().int().nonnegative().nullable(),
  serverRevision: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

// --- POST /entries -----------------------------------------------------

export const createEntryRequestSchema = z
  .object({
    content: z.string().min(1).max(20000),
    source: sourceEnum,
    chatMessageId: uuidSchema.optional(),
    occurredAt: isoDateTimeSchema.optional(),
    mediaDurationSeconds: z.number().int().nonnegative().optional(),
  })
  // Refinamento Zod da Seção 8.2: source === 'chat' ⟺ chatMessageId presente.
  .refine((body) => (body.source === "chat") === (body.chatMessageId !== undefined), {
    message: "source='chat' exige chatMessageId, e vice-versa",
    path: ["chatMessageId"],
  });

// `meta.idempotentReplay` só aparece quando o índice único de idempotência
// (RF10/D4) barrou uma segunda tentativa e a entrada existente foi
// devolvida — por isso é opcional no schema.
export const createEntryResponseSchema = envelopeWithMeta(
  entrySchema,
  z.object({ idempotentReplay: z.boolean().optional() }),
);

// --- GET /entries --------------------------------------------------------

export const listEntriesQuerySchema = cursorPaginationQuerySchema.extend({
  source: sourceEnum.optional(),
  dateFrom: isoDateTimeSchema.optional(),
  dateTo: isoDateTimeSchema.optional(),
});

export const listEntriesResponseSchema = envelopeWithMeta(
  z.array(entrySchema),
  cursorPaginationMetaSchema,
);

// --- GET /entries/:id ------------------------------------------------------

export const getEntryResponseSchema = envelope(entrySchema);

// --- GET /entries/search ---------------------------------------------------

export const searchEntriesQuerySchema = z.object({
  q: z.string().optional(),
  source: sourceEnum.optional(),
  dateFrom: isoDateTimeSchema.optional(),
  dateTo: isoDateTimeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20).optional(),
});

// Item de busca = Entry + `similarity` (ausente no modo filter_only).
const searchResultSchema = entrySchema.extend({ similarity: z.number().min(0).max(1).optional() });

export const searchEntriesResponseSchema = envelopeWithMeta(
  z.array(searchResultSchema),
  z.object({ mode: z.enum(["filter_only", "semantic"]) }),
);

// --- POST /media/ocr ---------------------------------------------------

export const ocrRequestSchema = z.object({
  image: z.string().min(1), // base64
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});

export const ocrResponseSchema = envelope(
  z.object({
    text: z.string(),
    confidence: z.enum(["high", "low"]),
  }),
);
