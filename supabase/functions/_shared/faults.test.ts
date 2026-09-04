// Teste do módulo `faults` (T-029).
// Critério de conclusão do checklist: "os 6 tipos disparam e registram".

import { assert, assertEquals } from "./_test_utils.ts";
import { applyFault, type FaultType, parseFault } from "./faults.ts";

const TEST_FAULT_KEY = "segredo-de-teste-123";

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/entries", { headers });
}

function activeHeaders(faultValue: string): Record<string, string> {
  return { "X-Test-Key": TEST_FAULT_KEY, "X-Test-Fault": faultValue };
}

const SIMPLE_TYPES: FaultType[] = ["timeout", "malformed", "offline", "ai_timeout", "rate_limited"];

Deno.test("os 5 tipos simples são reconhecidos quando o modo de teste está ativo", () => {
  for (const type of SIMPLE_TYPES) {
    const parsed = parseFault(req(activeHeaders(type)), { testFaultKey: TEST_FAULT_KEY });
    assertEquals(parsed, { type });
  }
});

Deno.test("o 6º tipo, slow:<ms>, decodifica o atraso em milissegundos", () => {
  const parsed = parseFault(req(activeHeaders("slow:1500")), { testFaultKey: TEST_FAULT_KEY });
  assertEquals(parsed, { type: "slow", delayMs: 1500 });
});

Deno.test("slow malformado (sem número) é ignorado em silêncio, não lança", () => {
  const parsed = parseFault(req(activeHeaders("slow:abc")), { testFaultKey: TEST_FAULT_KEY });
  assertEquals(parsed, null);
});

Deno.test("valor desconhecido de X-Test-Fault é ignorado em silêncio (§10.1)", () => {
  const parsed = parseFault(req(activeHeaders("um-tipo-que-nao-existe")), {
    testFaultKey: TEST_FAULT_KEY,
  });
  assertEquals(parsed, null);
});

Deno.test("sem X-Test-Key correto, X-Test-Fault é ignorado mesmo com valor válido", () => {
  const parsed = parseFault(req({ "X-Test-Fault": "timeout" }), { testFaultKey: TEST_FAULT_KEY });
  assertEquals(parsed, null);
});

Deno.test("sem X-Test-Fault, devolve null (nada a interpretar)", () => {
  const parsed = parseFault(req({ "X-Test-Key": TEST_FAULT_KEY }), {
    testFaultKey: TEST_FAULT_KEY,
  });
  assertEquals(parsed, null);
});

Deno.test("applyFault registra exatamente 1 chamada de log por tipo válido, com o valor bruto certo", async () => {
  for (const type of SIMPLE_TYPES) {
    const logged: Array<{ requestId: string; endpoint: string; faultType: string }> = [];
    const result = await applyFault(req(activeHeaders(type)), "req-1", "/entries", {
      testFaultKey: TEST_FAULT_KEY,
      logFaultInjection: (args) => {
        logged.push(args);
        return Promise.resolve();
      },
    });
    assertEquals(result, { type });
    assertEquals(logged.length, 1);
    assertEquals(logged[0], { requestId: "req-1", endpoint: "/entries", faultType: type });
  }
});

Deno.test("applyFault registra 'slow:<ms>' por extenso no log", async () => {
  const logged: Array<{ faultType: string }> = [];
  await applyFault(req(activeHeaders("slow:250")), "req-2", "/chat/sessions/x/messages", {
    testFaultKey: TEST_FAULT_KEY,
    logFaultInjection: (args) => {
      logged.push(args);
      return Promise.resolve();
    },
  });
  assertEquals(logged[0]?.faultType, "slow:250");
});

Deno.test("applyFault não chama logFaultInjection quando não há falha a aplicar", async () => {
  let calls = 0;
  const result = await applyFault(req(), "req-3", "/entries", {
    testFaultKey: TEST_FAULT_KEY,
    logFaultInjection: () => {
      calls++;
      return Promise.resolve();
    },
  });
  assertEquals(result, null);
  assertEquals(calls, 0);
});

Deno.test("os 15 cenários (5 endpoints x 3 tipos) usam só timeout/malformed/offline — todos reconhecidos", () => {
  const endpoints = [
    "/entries",
    "/chat/sessions/:id/messages",
    "/media/ocr",
    "/export/summary",
    "/chat/sessions/:id/insight",
  ];
  const types: FaultType[] = ["timeout", "malformed", "offline"];
  for (const endpoint of endpoints) {
    for (const type of types) {
      const parsed = parseFault(req(activeHeaders(type)), { testFaultKey: TEST_FAULT_KEY });
      assert(parsed !== null, `${endpoint} + ${type} deveria ser reconhecido`);
    }
  }
});
