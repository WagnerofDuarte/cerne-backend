// Teste do módulo `clock` (T-028).
// Critério de conclusão do checklist: "teste com relógio congelado passa".

import { assert, assertEquals } from "./_test_utils.ts";
import { now, nowIso } from "./clock.ts";

const TEST_FAULT_KEY = "segredo-de-teste-123";
const DEPS = { testFaultKey: TEST_FAULT_KEY };

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/entries", { headers });
}

Deno.test("com X-Test-Key correto e X-Test-Now válido, now() devolve o instante exato congelado", () => {
  const frozen = now(
    req({ "X-Test-Key": TEST_FAULT_KEY, "X-Test-Now": "2026-09-23T09:41:00.000Z" }),
    DEPS,
  );
  assertEquals(frozen.toISOString(), "2026-09-23T09:41:00.000Z");
});

Deno.test("mesmo input produz sempre o mesmo resultado (determinismo, §3.5)", () => {
  const headers = { "X-Test-Key": TEST_FAULT_KEY, "X-Test-Now": "2026-01-01T00:00:00.000Z" };
  const a = now(req(headers), DEPS);
  const b = now(req(headers), DEPS);
  assertEquals(a.getTime(), b.getTime());
});

Deno.test("sem X-Test-Key, X-Test-Now é ignorado em silêncio — usa o relógio real", () => {
  const frozen = now(req({ "X-Test-Now": "2020-01-01T00:00:00.000Z" }), DEPS);
  const realNow = Date.now();
  assert(
    Math.abs(frozen.getTime() - realNow) < 5000,
    "sem a chave certa, now() deveria ser o relógio real (tolerância de 5s neste teste)",
  );
});

Deno.test("com X-Test-Key errado, X-Test-Now também é ignorado", () => {
  const frozen = now(
    req({ "X-Test-Key": "chave-errada", "X-Test-Now": "2020-01-01T00:00:00.000Z" }),
    DEPS,
  );
  const realNow = Date.now();
  assert(Math.abs(frozen.getTime() - realNow) < 5000);
});

Deno.test("TEST_FAULT_KEY não configurado no ambiente: modo de teste nunca liga", () => {
  const frozen = now(
    req({ "X-Test-Key": "qualquer-coisa", "X-Test-Now": "2020-01-01T00:00:00.000Z" }),
    { testFaultKey: undefined },
  );
  const realNow = Date.now();
  assert(Math.abs(frozen.getTime() - realNow) < 5000);
});

Deno.test("X-Test-Now malformado cai para o relógio real, não quebra a requisição", () => {
  const frozen = now(
    req({ "X-Test-Key": TEST_FAULT_KEY, "X-Test-Now": "isso não é uma data" }),
    DEPS,
  );
  const realNow = Date.now();
  assert(Math.abs(frozen.getTime() - realNow) < 5000);
});

Deno.test("nowIso devolve string ISO 8601 do mesmo instante que now()", () => {
  const headers = { "X-Test-Key": TEST_FAULT_KEY, "X-Test-Now": "2026-09-23T09:41:00.000Z" };
  assertEquals(nowIso(req(headers), DEPS), now(req(headers), DEPS).toISOString());
});
