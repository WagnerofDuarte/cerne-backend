// T-026 — Contratos de Exportação (Plano técnico §8.4).
//
// `EXPORT_EMPTY_PERIOD` (zero entradas no período) é resposta de *erro*
// (400, envelope de errorResponseSchema em common.ts) — não aparece aqui
// como variante de sucesso.

import { z } from "zod";
import { envelope, isoDateTimeSchema, uuidSchema } from "./common.ts";

export const exportJobStatusEnum = z.enum([
  "pending",
  "processing",
  "data_ready",
  "done",
  "error",
]);
export const exportNarrativeStatusEnum = z.enum([
  "pending",
  "processing",
  "done",
  "failed",
  "skipped",
]);

// --- POST /export/summary ---------------------------------------------

export const createExportRequestSchema = z.object({
  periodStart: isoDateTimeSchema.nullable(),
  periodEnd: isoDateTimeSchema.nullable(),
  includeNarrative: z.boolean().default(true),
});

// 202 Accepted — job aceito e enfileirado (nunca 200; ver §3.4).
export const createExportResponseSchema = envelope(
  z.object({
    jobId: uuidSchema,
    status: z.literal("pending"),
  }),
);

// --- GET /export/:jobId/status --------------------------------------------

// `errorCode`/`narrativeErrorCode`: código interno do worker de exportação,
// não necessariamente um dos 13 códigos da taxonomia de endpoint (o worker
// roda fora do ciclo requisição/resposta — Seção 8.4, "Worker da fila").
// Lacuna do documento-fonte quanto à forma exata; mantido como string livre
// em vez de forçar em `errorCodeEnum`, para não inventar um vínculo que o
// plano técnico não estabelece.
export const exportJobStatusResponseSchema = envelope(
  z.object({
    jobId: uuidSchema,
    status: exportJobStatusEnum,
    narrativeStatus: exportNarrativeStatusEnum,
    entryCount: z.number().int().nonnegative().nullable(),
    errorCode: z.string().nullable(),
    narrativeErrorCode: z.string().nullable(),
    downloadAvailable: z.boolean(),
  }),
);

// --- GET /export/:jobId/download --------------------------------------

export const downloadExportQuerySchema = z.object({
  format: z.enum(["pdf", "raw"]).default("pdf"),
});

// Sem corpo de resposta JSON — sucesso é 302 para uma URL assinada do
// Storage (§3.4, §8.4). O registro do contrato (`registry.ts`) marca este
// endpoint com `redirect: true` em vez de um `responseBody`.
