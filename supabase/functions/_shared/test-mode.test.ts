// Teste do gate compartilhado `test-mode` (usado por clock.ts e faults.ts).

import { assert } from "./_test_utils.ts";
import { isTestModeActive } from "./test-mode.ts";

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/entries", { headers });
}

Deno.test("ativo quando X-Test-Key bate exatamente com TEST_FAULT_KEY", () => {
  assert(isTestModeActive(req({ "X-Test-Key": "segredo" }), "segredo"));
});

Deno.test("inativo sem o cabeçalho X-Test-Key", () => {
  assert(!isTestModeActive(req(), "segredo"));
});

Deno.test("inativo com chave errada (mesmo comprimento)", () => {
  assert(!isTestModeActive(req({ "X-Test-Key": "segrede" }), "segredo"));
});

Deno.test("inativo com chave de comprimento diferente", () => {
  assert(!isTestModeActive(req({ "X-Test-Key": "seg" }), "segredo"));
});

Deno.test("inativo quando TEST_FAULT_KEY não está configurado no ambiente", () => {
  assert(!isTestModeActive(req({ "X-Test-Key": "qualquer" }), undefined));
  assert(!isTestModeActive(req({ "X-Test-Key": "" }), ""));
});
