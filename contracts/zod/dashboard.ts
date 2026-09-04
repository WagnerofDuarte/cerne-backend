// T-026 — Contratos de Dashboard (Plano técnico §8.5).

import { z } from "zod";
import { envelope, isoDateTimeSchema } from "./common.ts";

// --- GET /dashboard/aggregate ------------------------------------------

export const dashboardPeriodEnum = z.enum(["7d", "30d", "90d", "all"]);

export const dashboardAggregateQuerySchema = z.object({
  period: dashboardPeriodEnum,
});

// Contagem por origem — as 4 chaves são exatamente o enum `source` (§5),
// nenhuma inventada. Lacuna do documento-fonte quanto à forma exata de
// "sources" dentro de cada bucket e de "totals"; esta é a leitura mais
// direta e conservadora do texto ("buckets: [{ date, count, sources }],
// totals" — Seção 8.5). Revisar com o Wagner se a intenção for outra.
const sourceCountsSchema = z.object({
  manual: z.number().int().nonnegative(),
  audio: z.number().int().nonnegative(),
  photo: z.number().int().nonnegative(),
  chat: z.number().int().nonnegative(),
});

const dashboardBucketSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date no formato YYYY-MM-DD"),
  count: z.number().int().nonnegative(),
  sources: sourceCountsSchema,
});

// Sempre 200, inclusive com zero entradas (buckets: []) — nunca lançar
// NOT_FOUND ou qualquer erro aqui só por falta de dado (§8.5).
export const dashboardAggregateResponseSchema = envelope(
  z.object({
    buckets: z.array(dashboardBucketSchema),
    totals: z.object({ count: z.number().int().nonnegative(), sources: sourceCountsSchema }),
  }),
);

// --- GET /dashboard/narrative --------------------------------------------

export const dashboardNarrativeQuerySchema = z.object({
  period: dashboardPeriodEnum,
});

// Independente do agregado (§8.5) — a falha aqui (AI_GENERATION_TIMEOUT) não
// derruba `GET /dashboard/aggregate`; são dois endpoints distintos, cada um
// com sua própria resposta de sucesso/erro.
export const dashboardNarrativeResponseSchema = envelope(
  z.object({
    text: z.string(),
    generatedAt: isoDateTimeSchema,
  }),
);
