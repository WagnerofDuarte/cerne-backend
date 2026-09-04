// T-026 — Módulo `contracts`, primitivos compartilhados (Plano técnico §7, §8).
//
// Fonte única dos schemas Zod de request/response dos 23 endpoints — nada
// aqui é reimplementado ad hoc em nenhuma função (regra da camada
// compartilhada, Seção 7). O OpenAPI (`contracts/openapi.yaml`, T-033) é
// GERADO a partir do que está definido em `contracts/zod/`, nunca escrito
// à mão.
//
// Convenção de nomenclatura (Seção 3.1): campos JSON sempre em
// `camelCase`, mesmo quando a coluna do banco é `snake_case` — a conversão
// é feita pelo módulo `serialize` (T-027), não aqui.

import { z } from "zod";
import { ERROR_CODES } from "../../supabase/functions/_shared/errors.ts";

// --- Primitivos ------------------------------------------------------------

export const uuidSchema = z.string().uuid();

// ISO 8601 com offset — usado tanto em request (occurredAt, periodStart/End)
// quanto em response (createdAt, updatedAt, ...).
export const isoDateTimeSchema = z.string().datetime({ offset: true });

// Os três enums fechados que aparecem em mais de um endpoint (Seção 5).
export const personaEnum = z.enum(["analitico", "empatico", "socratico"]);
export const sourceEnum = z.enum(["manual", "audio", "photo", "chat"]);
export const embeddingStatusEnum = z.enum(["pending", "ready", "failed"]);
export const piiStatusEnum = z.enum(["pending", "clean", "flagged", "failed"]);

// Reaproveita a taxonomia de errors.ts em vez de redigitar os 13 códigos
// aqui — uma segunda cópia divergiria silenciosamente se a taxonomia mudasse.
export const errorCodeEnum = z.enum(ERROR_CODES);

// --- Envelope de resposta (Seção 3.2) --------------------------------------

/** Sucesso sem `meta` além do que o chamador passar explicitamente. */
export function envelope<D extends z.ZodTypeAny>(data: D) {
  return z.object({ data, meta: z.record(z.unknown()).optional() });
}

/** Sucesso com um schema de `meta` específico (paginação, modo de busca, etc.). */
export function envelopeWithMeta<D extends z.ZodTypeAny, M extends z.ZodTypeAny>(
  data: D,
  meta: M,
) {
  return z.object({ data, meta });
}

/** Formato único de erro em toda a API (Seção 3.2) — mesmo schema para os 23 endpoints. */
export const errorResponseSchema = z.object({
  code: errorCodeEnum,
  message: z.string(),
  retryable: z.boolean(),
  requestId: z.string(),
});

/** Paginação por cursor (Seção 8: `GET /entries`, `GET /chat/sessions`, ...). */
export const cursorPaginationMetaSchema = z.object({
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative().optional(),
});

export const cursorPaginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20).optional(),
});

// --- Tag embutida (Seção 8.2: "GET /entries com tags embutidas") -----------
//
// Lacuna do documento-fonte: a Seção 8 não detalha o formato exato do item
// de `tags[]` dentro de `Entry`. `tags` (T-015) tem `id` e `name` — a forma
// mínima e não inventiva é expor os dois, já que o app precisa do `id` para
// qualquer interação futura (filtrar por tag, por exemplo) e do `name` para
// exibir. Revisar com o Wagner se a intenção for só uma lista de nomes.
export const tagSchema = z.object({
  id: uuidSchema,
  name: z.string(),
});

// --- Spans de PII (D3: "posição 15–22 é nome de pessoa") -------------------
//
// Mesma natureza de lacuna: `entries.pii_spans` é `jsonb` sem forma
// especificada no plano técnico. `start`/`end` (índice de caractere no
// `content` original) + `type` (o que foi identificado) é a leitura mais
// direta do exemplo da D3. Revisar se a Fase 3 (detecção de PII via Haiku,
// T-036) exigir uma forma diferente.
export const piiSpanSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  type: z.string(),
});
