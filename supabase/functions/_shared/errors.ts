// T-025 — Módulo `errors` (Plano técnico §7, §8.7).
//
// Fonte única dos 13 códigos de erro da taxonomia. Nenhum outro módulo pode
// mapear código → HTTP/retryable por conta própria — sempre importar daqui.
//
// Duas armadilhas da Seção 3.4/8.7 que este módulo existe para evitar:
//   - nunca 403 (recurso de outro usuário é sempre NOT_FOUND/404 — D7)
//   - nunca 409 (idempotência do RF10 é sempre 200, tratada fora da
//     taxonomia de erro — não existe código de "conflito" aqui)

/** Os 13 códigos de erro da API (Plano técnico §8.7). Lista fechada. */
export const ERROR_CODES = [
  "AUTH_EXPIRED",
  "AUTH_INVALID",
  "NETWORK_TIMEOUT",
  "NETWORK_OFFLINE",
  "VALIDATION_ERROR",
  "PII_CHECK_FAILED",
  "EMBEDDING_FAILED",
  "AI_GENERATION_TIMEOUT",
  "NOT_FOUND",
  "RATE_LIMITED",
  "EXPORT_EMPTY_PERIOD",
  "PAYLOAD_TOO_LARGE",
  "OCR_NO_TEXT",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

interface ErrorSpec {
  /**
   * Status HTTP correspondente. `null` só para `NETWORK_OFFLINE`, que nunca
   * vira uma resposta HTTP de verdade — a injeção de falha desse tipo
   * encerra a conexão sem responder (Seção 10.2), então não existe status
   * a devolver.
   */
  readonly http: number | null;
  readonly retryable: boolean;
}

// Tabela literal da Seção 8.7 — não derivar isso de outro lugar.
const TAXONOMY: Record<ErrorCode, ErrorSpec> = {
  AUTH_EXPIRED: { http: 401, retryable: false },
  AUTH_INVALID: { http: 401, retryable: false },
  NETWORK_TIMEOUT: { http: 504, retryable: true },
  NETWORK_OFFLINE: { http: null, retryable: true },
  VALIDATION_ERROR: { http: 400, retryable: false },
  PII_CHECK_FAILED: { http: 502, retryable: true },
  EMBEDDING_FAILED: { http: 502, retryable: true },
  AI_GENERATION_TIMEOUT: { http: 504, retryable: true },
  NOT_FOUND: { http: 404, retryable: false },
  RATE_LIMITED: { http: 429, retryable: true },
  EXPORT_EMPTY_PERIOD: { http: 400, retryable: false },
  PAYLOAD_TOO_LARGE: { http: 413, retryable: false },
  OCR_NO_TEXT: { http: 400, retryable: false },
};

/** Erro de domínio da API. Carrega tudo que `serialize` precisa para montar o envelope de erro. */
export class CerneError extends Error {
  readonly code: ErrorCode;
  readonly http: number | null;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message?: string, options?: { cause?: unknown }) {
    super(message ?? code, options);
    this.name = "CerneError";
    this.code = code;
    this.http = TAXONOMY[code].http;
    this.retryable = TAXONOMY[code].retryable;
  }
}

/**
 * Função única de lançamento de erro (Plano técnico §7: "Função única de
 * lançamento de erro"). Handlers nunca fazem `throw new CerneError(...)`
 * diretamente — sempre `throwError(...)`, para manter um só ponto de
 * conversão código → exceção.
 */
export function throwError(
  code: ErrorCode,
  message?: string,
  options?: { cause?: unknown },
): never {
  throw new CerneError(code, message, options);
}

export function isCerneError(err: unknown): err is CerneError {
  return err instanceof CerneError;
}

export function httpStatusFor(code: ErrorCode): number | null {
  return TAXONOMY[code].http;
}

export function isRetryable(code: ErrorCode): boolean {
  return TAXONOMY[code].retryable;
}
