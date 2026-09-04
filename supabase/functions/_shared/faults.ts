// T-029 — Módulo `faults` (Plano técnico §7, §10).
//
// Responsabilidade deste módulo: interpretar `X-Test-Fault` e registrar a
// injeção em `experiment.fault_injection_log` (via a RPC de `db.ts` —
// nunca acesso direto à tabela, ela é trancada para `authenticated`; ver
// migração 0010). *Executar* o efeito de cada tipo (esperar 35s, cortar a
// conexão, atrasar, devolver corpo malformado) é responsabilidade do
// `gateway` (T-031) — este módulo só decide "qual falha, se alguma" e
// devolve uma instrução tipada para o gateway agir.

import { isTestModeActive } from "./test-mode.ts";

// Os 6 tipos da Seção 10.2.
export type FaultType =
  | "timeout"
  | "malformed"
  | "offline"
  | "ai_timeout"
  | "slow"
  | "rate_limited";

export interface ParsedFault {
  readonly type: FaultType;
  /** Só presente para `slow:<ms>` — o valor decodificado do cabeçalho. */
  readonly delayMs?: number;
}

export interface FaultsDeps {
  /** `TEST_FAULT_KEY` do ambiente — mesmo segredo que habilita X-Test-Now. */
  testFaultKey: string | undefined;
  /** Grava a linha em `fault_injection_log`, via RPC (db.ts). Injetado para testabilidade. */
  logFaultInjection: (
    args: { requestId: string; endpoint: string; faultType: string },
  ) => Promise<void>;
}

const SIMPLE_TYPES: ReadonlySet<string> = new Set([
  "timeout",
  "malformed",
  "offline",
  "ai_timeout",
  "rate_limited",
]);

const SLOW_PATTERN = /^slow:(\d+)$/;

/**
 * Interpreta `X-Test-Fault`. Devolve `null` sempre que o cabeçalho deveria
 * ser "ignorado em silêncio" (§10.1): modo de teste inativo (chave errada
 * ou ausente), cabeçalho ausente, ou valor que não bate com nenhum dos 6
 * tipos — nunca lança erro por um cabeçalho de teste malformado.
 */
export function parseFault(
  req: Request,
  deps: Pick<FaultsDeps, "testFaultKey">,
): ParsedFault | null {
  if (!isTestModeActive(req, deps.testFaultKey)) return null;

  const raw = req.headers.get("X-Test-Fault");
  if (raw === null) return null;

  if (SIMPLE_TYPES.has(raw)) return { type: raw as FaultType };

  const slowMatch = SLOW_PATTERN.exec(raw);
  if (slowMatch) return { type: "slow", delayMs: Number(slowMatch[1]) };

  return null;
}

function faultTypeToLogValue(fault: ParsedFault): string {
  return fault.type === "slow" ? `slow:${fault.delayMs}` : fault.type;
}

/**
 * Interpreta e, quando reconhece um tipo válido, registra a linha em
 * `fault_injection_log` ("Toda injeção grava linha", §10.2) — um
 * cabeçalho ignorado em silêncio não produz log nenhum.
 */
export async function applyFault(
  req: Request,
  requestId: string,
  endpoint: string,
  deps: FaultsDeps,
): Promise<ParsedFault | null> {
  const fault = parseFault(req, deps);
  if (fault === null) return null;

  await deps.logFaultInjection({
    requestId,
    endpoint,
    faultType: faultTypeToLogValue(fault),
  });

  return fault;
}
