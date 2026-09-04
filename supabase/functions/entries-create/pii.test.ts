// Teste do módulo `pii` (T-036).

import { assert, assertEquals, assertThrowsAsync } from "../_shared/_test_utils.ts";
import { CerneError } from "../_shared/errors.ts";
import type { ReplayDeps } from "../_shared/replay.ts";
import { detectPii } from "./pii.ts";

const env = { anthropicApiKey: "test-key" };
// mode 'off': withReplay sempre chama o provedor — testa só a lógica de pii.ts.
const offReplay: ReplayDeps = {
  mode: "off",
  lookup: () => Promise.resolve(null),
  store: () => Promise.resolve(),
};

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    )) as typeof fetch;
}

function anthropicSuccess(spans: unknown[]) {
  return {
    id: "msg_1",
    model: "claude-haiku-4-5-20251001",
    content: [
      { type: "tool_use", id: "toolu_1", name: "report_pii_spans", input: { spans } },
    ],
    stop_reason: "tool_use",
  };
}

Deno.test("texto sem PII: status 'clean', spans vazio", async () => {
  const fetchImpl = fakeFetch(200, anthropicSuccess([]));
  const result = await detectPii("hoje o dia foi tranquilo", "v1", {
    ...env,
    fetchImpl,
    replay: offReplay,
  });
  assertEquals(result.status, "clean");
  assertEquals(result.spans, []);
});

Deno.test("texto com nome próprio: status 'flagged', spans preservados", async () => {
  const spans = [{ start: 15, end: 25, type: "nome" }];
  const fetchImpl = fakeFetch(200, anthropicSuccess(spans));
  const result = await detectPii("conversei muito com a Mariana hoje", "v1", {
    ...env,
    fetchImpl,
    replay: offReplay,
  });
  assertEquals(result.status, "flagged");
  assertEquals(result.spans, spans);
});

Deno.test("chamada à Anthropic falha (não-2xx) → PII_CHECK_FAILED", async () => {
  const fetchImpl = fakeFetch(500, { error: { message: "internal" } });
  const err = await assertThrowsAsync(() =>
    detectPii("texto qualquer", "v1", { ...env, fetchImpl, replay: offReplay })
  );
  assert(err instanceof CerneError);
  assertEquals((err as CerneError).code, "PII_CHECK_FAILED");
});

Deno.test("resposta sem o tool_use esperado → PII_CHECK_FAILED", async () => {
  const fetchImpl = fakeFetch(200, {
    id: "msg_1",
    model: "claude-haiku-4-5-20251001",
    content: [{ type: "text", text: "eu deveria ter usado a ferramenta, mas não usei" }],
    stop_reason: "end_turn",
  });
  const err = await assertThrowsAsync(() =>
    detectPii("texto qualquer", "v1", { ...env, fetchImpl, replay: offReplay })
  );
  assert(err instanceof CerneError);
  assertEquals((err as CerneError).code, "PII_CHECK_FAILED");
});

Deno.test("tool_use com input fora do schema → PII_CHECK_FAILED", async () => {
  const fetchImpl = fakeFetch(200, {
    id: "msg_1",
    model: "claude-haiku-4-5-20251001",
    content: [
      {
        type: "tool_use",
        id: "toolu_1",
        name: "report_pii_spans",
        input: { spans: "não é array" },
      },
    ],
    stop_reason: "tool_use",
  });
  const err = await assertThrowsAsync(() =>
    detectPii("texto qualquer", "v1", { ...env, fetchImpl, replay: offReplay })
  );
  assert(err instanceof CerneError);
  assertEquals((err as CerneError).code, "PII_CHECK_FAILED");
});

Deno.test("PROMPT_VERSION entra no envelope (muda a cache_key)", async () => {
  const calls: unknown[] = [];
  const replay: ReplayDeps = {
    mode: "record",
    lookup: () => Promise.resolve(null),
    store: (args) => {
      calls.push(args.promptVersion);
      return Promise.resolve();
    },
  };
  const fetchImpl = fakeFetch(200, anthropicSuccess([]));
  await detectPii("texto", "v-abc", { ...env, fetchImpl, replay });
  assertEquals(calls, ["v-abc"]);
});
