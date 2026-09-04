// T-027 — Módulo `serialize` (Plano técnico §3.1, §3.2, §7).
//
// Único lugar do repositório que converte entre `snake_case` (banco) e
// `camelCase` (API), e que monta o envelope de resposta. "A conversão...
// acontece na camada de serialização compartilhada, nunca ad hoc por
// endpoint" (§3.1) — nenhum handler futuro deve fazer isso na mão.

import { type CerneError, httpStatusFor } from "./errors.ts";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

// snake_case -> camelCase: "chat_message_id" -> "chatMessageId".
function snakeKeyToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_match, c: string) => c.toUpperCase());
}

// camelCase -> snake_case: "chatMessageId" -> "chat_message_id".
//
// Uma letra maiúscula por vez, não por transição lowercase->UPPERCASE: a
// primeira versão usava `/([a-z0-9])([A-Z])/`, que colapsa sequências como
// "aBC" (de "a_b_c") em "a_bc" em vez de "a_b_c" — perde a volta. Trocando
// para "cada maiúscula vira `_` + minúscula" a conversão fica bijetiva com
// `snakeKeyToCamel` para o alfabeto de nomes deste projeto (snake_case só
// com letras minúsculas e `_`, nunca dígito colado no `_` — Seção 3.1).
function camelKeyToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (upper) => `_${upper.toLowerCase()}`);
}

// Percorre objetos/arrays recursivamente, convertendo cada chave. `Date`
// (é o que o driver do Postgres devolve para `timestamptz`) é tratada como
// valor-folha e vira string ISO — a API nunca expõe um objeto Date, sempre
// o formato ISO 8601 da Seção 3 dos contratos.
function mapKeysDeep(value: unknown, mapKey: (key: string) => string): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => mapKeysDeep(item, mapKey));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[mapKey(key)] = mapKeysDeep(val, mapKey);
    }
    return out;
  }
  return value;
}

/** Linha(s) do banco (`snake_case`) → forma da API (`camelCase`). */
export function snakeToCamel<T = unknown>(value: unknown): T {
  return mapKeysDeep(value, snakeKeyToCamel) as T;
}

/** Corpo de request da API (`camelCase`) → forma para gravar no banco (`snake_case`). */
export function camelToSnake<T = unknown>(value: unknown): T {
  return mapKeysDeep(value, camelKeyToSnake) as T;
}

// --- Envelope de resposta (Seção 3.2) --------------------------------------

export interface DataEnvelope<T = unknown> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface ErrorEnvelope {
  code: string;
  message: string;
  retryable: boolean;
  requestId: string;
}

/**
 * Monta `{ data, meta }` a partir de uma linha (ou linhas) já em
 * `snake_case` vindas do banco — converte para `camelCase` como parte da
 * montagem, para nenhum handler ter que lembrar de chamar `snakeToCamel`
 * separadamente.
 */
export function buildDataEnvelope<T = unknown>(
  rawData: unknown,
  meta?: Record<string, unknown>,
): DataEnvelope<T> {
  const envelope: DataEnvelope<T> = { data: snakeToCamel<T>(rawData) };
  if (meta !== undefined) envelope.meta = meta;
  return envelope;
}

/** Monta o envelope de erro único da API (§3.2) a partir de um `CerneError`. */
export function buildErrorEnvelope(error: CerneError, requestId: string): ErrorEnvelope {
  return {
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    requestId,
  };
}

/**
 * `Response` HTTP pronta para um `CerneError`. `NETWORK_OFFLINE` não tem
 * status HTTP (a conexão é cortada por `faults`/`gateway` antes de chegar
 * aqui) — chamar isto para esse código é erro de uso do próprio gateway,
 * por isso lança em vez de inventar um status.
 */
export function errorToResponse(
  error: CerneError,
  requestId: string,
  extraHeaders?: HeadersInit,
): Response {
  const status = httpStatusFor(error.code);
  if (status === null) {
    throw new Error(
      `errorToResponse: ${error.code} não tem status HTTP — deveria ter sido tratado como offline antes de serializar`,
    );
  }
  return jsonResponse(buildErrorEnvelope(error, requestId), status, extraHeaders);
}

/** `Response` HTTP de sucesso a partir de um envelope já montado. */
export function dataResponse<T>(
  envelope: DataEnvelope<T>,
  status = 200,
  extraHeaders?: HeadersInit,
): Response {
  return jsonResponse(envelope, status, extraHeaders);
}

function jsonResponse(body: unknown, status: number, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { status, headers });
}
