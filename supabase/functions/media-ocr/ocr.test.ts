// Teste do módulo `ocr` (T-041).

import { assert, assertEquals, assertThrowsAsync } from "../_shared/_test_utils.ts";
import { CerneError } from "../_shared/errors.ts";
import type { ReplayDeps } from "../_shared/replay.ts";
import { performOcr } from "./ocr.ts";

const env = { anthropicApiKey: "test-key" };
const offReplay: ReplayDeps = {
  mode: "off",
  lookup: () => Promise.resolve(null),
  store: () => Promise.resolve(),
};

const SOME_BYTES = new TextEncoder().encode("fake-image-bytes");
const SOME_BASE64 = btoa("fake-image-bytes");

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    )) as typeof fetch;
}

function anthropicOcrResponse(text: string, confidence: "high" | "low" = "high") {
  return {
    id: "msg_1",
    model: "claude-haiku-4-5-20251001",
    content: [
      { type: "tool_use", id: "toolu_1", name: "report_ocr_result", input: { text, confidence } },
    ],
    stop_reason: "tool_use",
  };
}

Deno.test("texto encontrado: devolve { text, confidence }", async () => {
  const fetchImpl = fakeFetch(200, anthropicOcrResponse("um texto de caderno manuscrito", "high"));
  const result = await performOcr(SOME_BASE64, SOME_BYTES, "image/png", "v1", {
    ...env,
    fetchImpl,
    replay: offReplay,
  });
  assertEquals(result, { text: "um texto de caderno manuscrito", confidence: "high" });
});

Deno.test("texto vazio (imagem ilegível/em branco) → OCR_NO_TEXT", async () => {
  const fetchImpl = fakeFetch(200, anthropicOcrResponse("", "low"));
  const err = await assertThrowsAsync(() =>
    performOcr(SOME_BASE64, SOME_BYTES, "image/png", "v1", { ...env, fetchImpl, replay: offReplay })
  );
  assert(err instanceof CerneError);
  assertEquals((err as CerneError).code, "OCR_NO_TEXT");
});

Deno.test("texto só com espaços em branco → OCR_NO_TEXT (trim antes de checar)", async () => {
  const fetchImpl = fakeFetch(200, anthropicOcrResponse("   \n  ", "low"));
  const err = await assertThrowsAsync(() =>
    performOcr(SOME_BASE64, SOME_BYTES, "image/png", "v1", { ...env, fetchImpl, replay: offReplay })
  );
  assert(err instanceof CerneError);
  assertEquals((err as CerneError).code, "OCR_NO_TEXT");
});

Deno.test("chamada à Anthropic falha (não-2xx) → AI_GENERATION_TIMEOUT", async () => {
  const fetchImpl = fakeFetch(500, { error: "internal" });
  const err = await assertThrowsAsync(() =>
    performOcr(SOME_BASE64, SOME_BYTES, "image/png", "v1", { ...env, fetchImpl, replay: offReplay })
  );
  assert(err instanceof CerneError);
  assertEquals((err as CerneError).code, "AI_GENERATION_TIMEOUT");
});

Deno.test("resposta sem o tool_use esperado → AI_GENERATION_TIMEOUT", async () => {
  const fetchImpl = fakeFetch(200, {
    id: "msg_1",
    model: "claude-haiku-4-5-20251001",
    content: [{ type: "text", text: "não usei a ferramenta" }],
    stop_reason: "end_turn",
  });
  const err = await assertThrowsAsync(() =>
    performOcr(SOME_BASE64, SOME_BYTES, "image/png", "v1", { ...env, fetchImpl, replay: offReplay })
  );
  assert(err instanceof CerneError);
  assertEquals((err as CerneError).code, "AI_GENERATION_TIMEOUT");
});

Deno.test("input do tool fora do schema → AI_GENERATION_TIMEOUT", async () => {
  const fetchImpl = fakeFetch(200, {
    id: "msg_1",
    model: "claude-haiku-4-5-20251001",
    content: [
      { type: "tool_use", id: "toolu_1", name: "report_ocr_result", input: { confidence: "high" } }, // falta 'text'
    ],
    stop_reason: "tool_use",
  });
  const err = await assertThrowsAsync(() =>
    performOcr(SOME_BASE64, SOME_BYTES, "image/png", "v1", { ...env, fetchImpl, replay: offReplay })
  );
  assert(err instanceof CerneError);
  assertEquals((err as CerneError).code, "AI_GENERATION_TIMEOUT");
});

Deno.test("o cache é chaveado pelo SHA-256 dos bytes, não pela string base64 (D17: só a impressão digital)", async () => {
  const calls: unknown[] = [];
  const replay: ReplayDeps = {
    mode: "record",
    lookup: () => Promise.resolve(null),
    store: (args) => {
      calls.push(args.requestEnvelope);
      return Promise.resolve();
    },
  };
  const fetchImpl = fakeFetch(200, anthropicOcrResponse("texto", "high"));
  await performOcr(SOME_BASE64, SOME_BYTES, "image/png", "v1", { ...env, fetchImpl, replay });
  const envelope = calls[0] as { input: { imageSha256: string; mimeType: string } };
  assertEquals(envelope.input.mimeType, "image/png");
  assertEquals(envelope.input.imageSha256.length, 64); // hex de 32 bytes (SHA-256)
  assert(
    !JSON.stringify(envelope).includes(SOME_BASE64),
    "a imagem em si nunca entra no envelope (D17)",
  );
});
