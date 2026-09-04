// Teste do handler `media-ocr` (T-041).
// Critério de conclusão do checklist: "imagem grande demais -> 413;
// imagem ilegível -> OCR_NO_TEXT".

import { assert, assertEquals, assertThrowsAsync } from "../_shared/_test_utils.ts";
import type { DbClient } from "../_shared/db.ts";
import type { OcrEnv } from "../_shared/deps.ts";
import { CerneError } from "../_shared/errors.ts";
import type { GatewayContext } from "../_shared/gateway.ts";
import { handleOcr, type OcrBody } from "./handler.ts";

const baseEnv: Omit<OcrEnv, "fetchImpl"> = {
  supabaseUrl: "https://example.test",
  supabaseAnonKey: "anon-key",
  testFaultKey: undefined,
  anthropicApiKey: "anthropic-key",
  voyageApiKey: "voyage-key",
  promptVersion: "v1",
  replayMode: "off",
  ocrMaxBytes: 1024, // pequeno de propósito, pra testar o 413 sem gerar bytes reais grandes
};

const dummyDb = {} as DbClient;

function ctxFor(body: OcrBody): GatewayContext<OcrBody> {
  return {
    req: new Request("https://example.test/media/ocr", { method: "POST" }),
    requestId: "req-1",
    now: new Date("2026-09-10T00:00:00Z"),
    params: {},
    body,
    query: undefined,
    auth: { userId: "u1", accessToken: "t", db: dummyDb },
    fault: null,
  };
}

function fakeAnthropicFetch(status: number, body: unknown): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    )) as typeof fetch;
}

function ocrToolResponse(text: string) {
  return {
    id: "msg_1",
    model: "claude-haiku-4-5-20251001",
    content: [
      {
        type: "tool_use",
        id: "toolu_1",
        name: "report_ocr_result",
        input: { text, confidence: "high" },
      },
    ],
    stop_reason: "tool_use",
  };
}

Deno.test("imagem dentro do limite, texto encontrado → 200 { text, confidence }", async () => {
  const smallImage = btoa("x".repeat(10)); // bem menor que ocrMaxBytes=1024
  const fetchImpl = fakeAnthropicFetch(200, ocrToolResponse("texto do caderno"));
  const result = await handleOcr(
    ctxFor({ image: smallImage, mimeType: "image/png" }),
    { ...baseEnv, fetchImpl },
  );
  assertEquals(result.status, 200);
  assertEquals(result.envelope.data, { text: "texto do caderno", confidence: "high" });
});

Deno.test("imagem acima de OCR_MAX_BYTES decodificada → 413 PAYLOAD_TOO_LARGE (nunca chama a Anthropic)", async () => {
  const bigImage = btoa("x".repeat(2000)); // 2000 bytes decodificados > ocrMaxBytes=1024
  const fetchImpl = (() => {
    throw new Error("não deveria chamar a Anthropic — o tamanho já deveria ter barrado antes");
  }) as unknown as typeof fetch;
  const err = await assertThrowsAsync(() =>
    handleOcr(ctxFor({ image: bigImage, mimeType: "image/png" }), { ...baseEnv, fetchImpl })
  );
  assert(err instanceof CerneError);
  assertEquals((err as CerneError).code, "PAYLOAD_TOO_LARGE");
  assertEquals((err as CerneError).http, 413);
});

Deno.test("base64 malformado → VALIDATION_ERROR", async () => {
  const err = await assertThrowsAsync(() =>
    handleOcr(ctxFor({ image: "!!!não é base64!!!", mimeType: "image/png" }), baseEnv)
  );
  assert(err instanceof CerneError);
  assertEquals((err as CerneError).code, "VALIDATION_ERROR");
});

Deno.test("imagem ilegível (sem texto) → OCR_NO_TEXT propagado do módulo ocr.ts", async () => {
  const smallImage = btoa("x".repeat(10));
  const fetchImpl = fakeAnthropicFetch(200, ocrToolResponse(""));
  const err = await assertThrowsAsync(() =>
    handleOcr(ctxFor({ image: smallImage, mimeType: "image/png" }), { ...baseEnv, fetchImpl })
  );
  assert(err instanceof CerneError);
  assertEquals((err as CerneError).code, "OCR_NO_TEXT");
});
