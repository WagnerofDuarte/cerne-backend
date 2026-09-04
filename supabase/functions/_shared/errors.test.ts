// Teste unitário do módulo `errors` (T-025).
// Critério de conclusão do checklist: "teste unitário do mapeamento passa".

import { assert, assertEquals, assertThrowsSync } from "./_test_utils.ts";
import {
  CerneError,
  ERROR_CODES,
  httpStatusFor,
  isCerneError,
  isRetryable,
  throwError,
} from "./errors.ts";

// Tabela literal da Seção 8.7 do plano técnico — o teste re-digita a tabela
// de propósito (não importa TAXONOMY do módulo) para detectar uma edição
// acidental do mapeamento em errors.ts.
const EXPECTED: Record<string, { http: number | null; retryable: boolean }> = {
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

Deno.test("a taxonomia tem exatamente 13 códigos (§8.7)", () => {
  assertEquals(ERROR_CODES.length, 13);
  assertEquals(new Set(ERROR_CODES).size, 13, "nenhum código duplicado");
});

Deno.test("cada código mapeia para o HTTP/retryable exatos da Seção 8.7", () => {
  for (const code of ERROR_CODES) {
    const expected = EXPECTED[code];
    assert(expected, `código ${code} não está na tabela esperada do teste`);
    assertEquals(httpStatusFor(code), expected.http, `HTTP de ${code}`);
    assertEquals(isRetryable(code), expected.retryable, `retryable de ${code}`);
  }
  // e nenhum código a mais na tabela esperada do que na taxonomia real
  assertEquals(Object.keys(EXPECTED).length, ERROR_CODES.length);
});

Deno.test("throwError lança CerneError com code/http/retryable corretos", () => {
  const err = assertThrowsSync(() => throwError("NOT_FOUND", "entrada não encontrada"));
  assert(err instanceof CerneError);
  assertEquals(err.code, "NOT_FOUND");
  assertEquals(err.http, 404);
  assertEquals(err.retryable, false);
  assertEquals(err.message, "entrada não encontrada");
});

Deno.test("throwError sem mensagem usa o próprio código como mensagem", () => {
  const err = assertThrowsSync(() => throwError("VALIDATION_ERROR"));
  assert(err instanceof CerneError);
  assertEquals(err.message, "VALIDATION_ERROR");
});

Deno.test("isCerneError distingue CerneError de erro comum", () => {
  assert(isCerneError(new CerneError("AUTH_INVALID")));
  assert(!isCerneError(new Error("erro qualquer")));
  assert(!isCerneError("string não é erro"));
});

Deno.test("NETWORK_OFFLINE não tem status HTTP (conexão é cortada, não respondida)", () => {
  assertEquals(httpStatusFor("NETWORK_OFFLINE"), null);
});

Deno.test("RATE_LIMITED é retryable (documentado como só emitido por injeção de falha)", () => {
  assert(isRetryable("RATE_LIMITED"));
});
