// T-041 — OCR via visão do Haiku 4.5 (Plano técnico §8.2, RF02).
//
// Saída estruturada (tool use), mesmo padrão de pii.ts (T-036): texto
// extraído literalmente (sem corrigir/resumir) + confiança. "Sem texto
// encontrado -> OCR_NO_TEXT" (§8.2) é decidido aqui, quando o texto vem
// vazio da ferramenta — a imagem em si NUNCA é gravada em lugar nenhum
// (D17); só o SHA-256 dela entra no envelope do cache (`buildOcrEnvelope`,
// já pronto desde a Fase 2).

import { z } from "zod";
import { ANTHROPIC_MODELS, type AnthropicEnv, callAnthropic } from "../_shared/ai/anthropic.ts";
import { throwError } from "../_shared/errors.ts";
import { buildOcrEnvelope, type ReplayDeps } from "../_shared/replay.ts";

const OCR_TOOL_NAME = "report_ocr_result";

const OCR_TOOL = {
  name: OCR_TOOL_NAME,
  description: "Reporta o texto extraído da imagem, literalmente — sem corrigir ortografia, " +
    "sem resumir, sem completar frases. Se a imagem não tiver nenhum texto legível " +
    "(página em branco, ilegível, ou sem texto de qualquer natureza), reporte 'text' " +
    "como uma string vazia.",
  input_schema: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description:
          "todo o texto legível da imagem, na ordem em que aparece; string vazia se não houver texto legível",
      },
      confidence: {
        type: "string",
        enum: ["high", "low"],
        description:
          "'high' se o texto está claramente legível; 'low' se houve dúvida em alguma parte",
      },
    },
    required: ["text", "confidence"],
  },
} as const;

const OCR_SYSTEM_PROMPT =
  "Você faz reconhecimento de texto (OCR) sobre a imagem de uma página de caderno, " +
  "manuscrita ou impressa, em português. Extraia o texto literalmente — sem corrigir " +
  "ortografia, sem resumir, sem completar frases. Se a imagem não tiver nenhum texto " +
  "legível, reporte 'text' como string vazia. Reporte 'confidence' honestamente: 'low' " +
  "se houve qualquer dúvida na leitura de alguma parte.";

const ocrToolInputSchema = z.object({
  text: z.string(),
  confidence: z.enum(["high", "low"]),
});

export interface OcrResult {
  readonly text: string;
  readonly confidence: "high" | "low";
}

async function sha256HexOfBytes(bytes: Uint8Array): Promise<string> {
  // `as BufferSource`: TS5 tornou `Uint8Array` genérico em `ArrayBufferLike`,
  // mas `crypto.subtle.digest` só aceita a variante especializada em
  // `ArrayBuffer` — o valor em si é sempre compatível em runtime.
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * `imageBase64` chega já decodificada em `imageBytes` (o handler decodifica
 * uma vez só, para checar `OCR_MAX_BYTES` — ver media-ocr/handler.ts) —
 * este módulo reaproveita os bytes só para o SHA-256, e a string base64
 * original para o corpo da requisição à Anthropic (nenhuma reconversão).
 */
export async function performOcr(
  imageBase64: string,
  imageBytes: Uint8Array,
  mimeType: string,
  promptVersion: string,
  deps: AnthropicEnv & { replay: ReplayDeps },
): Promise<OcrResult> {
  const imageSha256 = await sha256HexOfBytes(imageBytes);
  const envelope = buildOcrEnvelope({
    provider: "anthropic",
    model: ANTHROPIC_MODELS.haiku45,
    promptVersion,
    imageSha256,
    mimeType,
  });

  let result;
  try {
    result = await callAnthropic(
      envelope,
      {
        model: ANTHROPIC_MODELS.haiku45,
        system: OCR_SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mimeType, data: imageBase64 },
            },
            { type: "text", text: "Extraia o texto desta imagem." },
          ],
        }],
        maxTokens: 4096,
        tools: [OCR_TOOL],
        toolChoice: { type: "tool", name: OCR_TOOL_NAME },
      },
      deps,
    );
  } catch (err) {
    // Nenhum dos 13 códigos é específico para "OCR falhou" —
    // AI_GENERATION_TIMEOUT é o mais próximo (falha genérica de geração
    // por IA, já usado em dashboard/insight) — lacuna preenchida aqui,
    // revisar se o Wagner discordar.
    throwError(
      "AI_GENERATION_TIMEOUT",
      `chamada à Anthropic (OCR) falhou: ${describeError(err)}`,
      { cause: err },
    );
  }

  const toolBlock = result.response.content.find(
    (block) => block.type === "tool_use" && block.name === OCR_TOOL_NAME,
  );
  if (!toolBlock) {
    throwError(
      "AI_GENERATION_TIMEOUT",
      "resposta da Anthropic não trouxe o tool_use esperado (OCR)",
    );
  }

  const parsed = ocrToolInputSchema.safeParse(toolBlock.input);
  if (!parsed.success) {
    throwError(
      "AI_GENERATION_TIMEOUT",
      `saída estruturada da Anthropic (OCR) não bate com o schema esperado: ${parsed.error.message}`,
    );
  }

  if (parsed.data.text.trim().length === 0) {
    throwError("OCR_NO_TEXT", "nenhum texto legível encontrado na imagem");
  }

  return parsed.data;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
