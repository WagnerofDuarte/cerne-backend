// T-028 — Módulo `clock` (Plano técnico §3.5, §3.6, §10.1).
//
// "Toda referência a 'agora' passa pela função compartilhada now() que
// respeita X-Test-Now" (§3.5). Nenhum handler ou módulo futuro pode chamar
// `new Date()` diretamente para saber a hora atual — é isso que permite ao
// roteiro de validação (T-060+) e ao teste de determinismo (T-062) fixar o
// relógio e obter o mesmo resultado em execuções diferentes, e ao seed
// (T-022) gerar datas relativas a uma âncora fixa em vez de "hoje".

import { isTestModeActive } from "./test-mode.ts";

export interface ClockDeps {
  /** `TEST_FAULT_KEY` do ambiente — mesmo segredo que habilita X-Test-Fault. */
  testFaultKey: string | undefined;
}

/**
 * "Agora". Em modo de teste (X-Test-Key correto) com `X-Test-Now`
 * presente e um ISO 8601 válido, devolve esse instante congelado. Em
 * qualquer outro caso — sem o segredo, sem o cabeçalho, ou com um valor
 * que não parseia — devolve o relógio real. Um `X-Test-Now` malformado
 * nunca deve conseguir quebrar uma requisição que um app real também
 * poderia fazer sem esse cabeçalho.
 */
export function now(req: Request, deps: ClockDeps): Date {
  if (isTestModeActive(req, deps.testFaultKey)) {
    const testNow = req.headers.get("X-Test-Now");
    if (testNow !== null) {
      const parsed = new Date(testNow);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  return new Date();
}

/** Atalho comum: `now(...)` já em ISO 8601, pronto para gravar em coluna `timestamptz`. */
export function nowIso(req: Request, deps: ClockDeps): string {
  return now(req, deps).toISOString();
}
