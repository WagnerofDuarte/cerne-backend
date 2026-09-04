// Gate compartilhado por `clock` (T-028) e `faults` (T-029).
//
// Seção 10.1: "Só age quando X-Test-Key coincide com TEST_FAULT_KEY. Sem
// coincidência, os cabeçalhos X-Test-Fault e X-Test-Now são ignorados em
// silêncio — nunca rejeitados com erro." Seção 3.3 confirma que
// `X-Test-Key` é "o segredo que habilita os dois anteriores" (Fault e
// Now). Um único módulo evita duplicar essa checagem em clock.ts e
// faults.ts, que teria risco real de os dois divergirem com o tempo.

/**
 * Verdadeiro só quando `X-Test-Key` está presente e bate byte a byte com
 * `testFaultKey` (comparação em tempo constante — este cabeçalho liga
 * comportamento sensível: adulterar o relógio e injetar falhas).
 */
export function isTestModeActive(req: Request, testFaultKey: string | undefined): boolean {
  if (!testFaultKey) return false; // TEST_FAULT_KEY não configurado: modo de teste nunca liga
  const provided = req.headers.get("X-Test-Key");
  if (provided === null) return false;
  return timingSafeEqual(provided, testFaultKey);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
