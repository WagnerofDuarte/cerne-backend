// Utilitário mínimo de asserção para os testes deste diretório.
//
// Deliberadamente sem dependência externa (nem "jsr:@std/assert", nem
// "npm:..."): jsr.io está bloqueado pela política de rede do sandbox onde
// isto foi escrito (mesmo tipo de bloqueio que impediu `supabase start` na
// Fase 1 — ver nota de ambiente em big-plan.md). Um util local garante que
// `deno test` roda igual aqui e na máquina do Wagner, sem depender de rede.

export function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

export function assertEquals<T>(actual: T, expected: T, message?: string): void {
  const ok = deepEqual(actual, expected);
  if (!ok) {
    throw new Error(
      message ??
        `valores diferentes:\n  esperado: ${Deno.inspect(expected)}\n  obtido:   ${
          Deno.inspect(actual)
        }`,
    );
  }
}

export function assertNotEquals<T>(actual: T, expected: T, message?: string): void {
  if (deepEqual(actual, expected)) {
    throw new Error(message ?? `valores deveriam ser diferentes: ${Deno.inspect(actual)}`);
  }
}

export async function assertThrowsAsync(
  fn: () => Promise<unknown>,
  message?: string,
): Promise<unknown> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error(message ?? "esperava que a função lançasse, mas não lançou");
}

export function assertThrowsSync(fn: () => unknown, message?: string): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error(message ?? "esperava que a função lançasse, mas não lançou");
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
    );
  }
  return false;
}
