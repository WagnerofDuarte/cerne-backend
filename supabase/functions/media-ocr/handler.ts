// T-041 — POST /media/ocr (Plano técnico §8.2, D17).
//
// "Acima de OCR_MAX_BYTES decodificados -> 413 PAYLOAD_TOO_LARGE" —
// decodifica antes de checar o tamanho (o limite é sobre os bytes reais
// da imagem, não sobre o texto base64, que é ~33% maior). "A imagem não é
// gravada em lugar nenhum" (D17) — só passa pela memória desta função,
// nunca toca disco/Storage/banco; o módulo `ocr.ts` só recebe os bytes
// para calcular o SHA-256 do cache.

import { buildReplayDeps, type OcrEnv } from "../_shared/deps.ts";
import { throwError } from "../_shared/errors.ts";
import type { GatewayContext, HandlerResult } from "../_shared/gateway.ts";
import { buildDataEnvelope } from "../_shared/serialize.ts";
import { performOcr } from "./ocr.ts";

export interface OcrBody {
  readonly image: string; // base64
  readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
}

function decodeBase64(base64: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throwError("VALIDATION_ERROR", "campo 'image' não é base64 válido");
  }
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export async function handleOcr(
  ctx: GatewayContext<OcrBody>,
  env: OcrEnv,
): Promise<HandlerResult> {
  const auth = ctx.auth!; // contract.auth === true
  const { image, mimeType } = ctx.body;

  const bytes = decodeBase64(image);
  if (bytes.length > env.ocrMaxBytes) {
    throwError(
      "PAYLOAD_TOO_LARGE",
      `imagem decodificada (${bytes.length} bytes) excede OCR_MAX_BYTES (${env.ocrMaxBytes} bytes)`,
    );
  }

  const replay = buildReplayDeps(auth.db, env.replayMode);
  const result = await performOcr(image, bytes, mimeType, env.promptVersion, {
    anthropicApiKey: env.anthropicApiKey,
    fetchImpl: env.fetchImpl,
    replay,
  });

  return { status: 200, envelope: buildDataEnvelope(result) };
}
