// T-036 — Detecção de PII com saída estruturada (Plano técnico §8.2 passo
// 4, D3, RNF02).
//
// "Anota, nunca remove" (D3): o `content` gravado é sempre o texto
// original, intacto — este módulo só reporta onde há informação pessoal,
// via *tool use* da Anthropic (saída estruturada, não um regex/NER
// dedicado). `PII_CHECK_FAILED` significa que a *verificação* falhou
// (chamada à IA quebrou, ou a saída não veio no formato esperado) — nunca
// que encontrou algo. Encontrar é o caminho normal (`status: 'flagged'`).
//
// Vive dentro de `entries-create/` (não em `_shared/`) porque só este
// endpoint usa PII nesta fase — a Seção 7 não lista um módulo `pii`
// compartilhado.

import { z } from "zod";
import { ANTHROPIC_MODELS, type AnthropicEnv, callAnthropic } from "../_shared/ai/anthropic.ts";
import { throwError } from "../_shared/errors.ts";
import { buildPiiEnvelope, type ReplayDeps } from "../_shared/replay.ts";

const PII_TOOL_NAME = "report_pii_spans";

const PII_TOOL = {
  name: PII_TOOL_NAME,
  description: "Reporta os trechos do texto que contêm informação pessoal identificável (PII) — " +
    "nomes de pessoas, endereços, telefones, e-mails, documentos de identificação. " +
    "Nunca reescreve, resume ou remove o texto — só aponta onde cada trecho está. " +
    "Se não houver nenhuma informação pessoal, chame a ferramenta com spans: [].",
  input_schema: {
    type: "object",
    properties: {
      spans: {
        type: "array",
        items: {
          type: "object",
          properties: {
            start: {
              type: "integer",
              description: "índice (0-based) do primeiro caractere do trecho, no texto original",
            },
            end: {
              type: "integer",
              description: "índice logo após o último caractere do trecho",
            },
            type: {
              type: "string",
              description: "o que foi identificado, ex.: 'nome', 'telefone', 'endereço', 'e-mail'",
            },
          },
          required: ["start", "end", "type"],
        },
      },
    },
    required: ["spans"],
  },
} as const;

const PII_SYSTEM_PROMPT =
  "Você analisa um texto de diário pessoal em português e identifica trechos que contêm " +
  "informação pessoal identificável (PII) — nomes de pessoas, endereços, telefones, e-mails, " +
  "documentos. O texto NÃO deve ser reescrito, resumido, censurado ou alterado de forma " +
  "alguma — sua única saída é a lista de trechos, via a ferramenta fornecida. Encontrar " +
  "informação pessoal é normal e esperado num diário; reporte com precisão, sem inventar.";

const piiSpanSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  type: z.string(),
});
const piiToolInputSchema = z.object({ spans: z.array(piiSpanSchema) });

export interface PiiSpan {
  readonly start: number;
  readonly end: number;
  readonly type: string;
}

export interface PiiResult {
  readonly status: "clean" | "flagged";
  readonly spans: readonly PiiSpan[];
}

export async function detectPii(
  text: string,
  promptVersion: string,
  deps: AnthropicEnv & { replay: ReplayDeps },
): Promise<PiiResult> {
  const envelope = buildPiiEnvelope({
    provider: "anthropic",
    model: ANTHROPIC_MODELS.haiku45,
    promptVersion,
    text,
  });

  let result;
  try {
    result = await callAnthropic(
      envelope,
      {
        model: ANTHROPIC_MODELS.haiku45,
        system: PII_SYSTEM_PROMPT,
        messages: [{ role: "user", content: text }],
        maxTokens: 4096,
        tools: [PII_TOOL],
        toolChoice: { type: "tool", name: PII_TOOL_NAME },
      },
      deps,
    );
  } catch (err) {
    throwError("PII_CHECK_FAILED", `chamada à Anthropic falhou: ${describeError(err)}`, {
      cause: err,
    });
  }

  const toolBlock = result.response.content.find(
    (block) => block.type === "tool_use" && block.name === PII_TOOL_NAME,
  );
  if (!toolBlock) {
    throwError("PII_CHECK_FAILED", "resposta da Anthropic não trouxe o tool_use esperado");
  }

  const parsed = piiToolInputSchema.safeParse(toolBlock.input);
  if (!parsed.success) {
    throwError(
      "PII_CHECK_FAILED",
      `saída estruturada da Anthropic não bate com o schema esperado: ${parsed.error.message}`,
    );
  }

  return {
    status: parsed.data.spans.length > 0 ? "flagged" : "clean",
    spans: parsed.data.spans,
  };
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
