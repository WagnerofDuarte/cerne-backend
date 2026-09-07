// T-050 — Geração do conteúdo do insight (Plano técnico §8.3, RF08).
//
// "Gerar via Haiku atrás do cache. Falha de geração → HTTP 200 com
// status='failed' e errorCode. Nunca erro HTTP." Mesmo espírito
// "nunca lança" de `entries-create/embedding.ts` (T-037): este módulo
// devolve sempre um resultado tipado, nunca uma exceção — quem chama
// (`handler.ts`) não precisa de try/catch.
//
// `forceFailure` existe para o fault `ai_timeout` (§10.2: "Falha apenas a
// chamada de IA; o resto do endpoint funciona" — RF08 é um dos 3 casos
// citados na tabela). Nenhuma tarefa anterior desta fase (T-036 PII,
// T-041 OCR) precisou consumir `ctx.fault` — nenhuma delas está na lista
// de endpoints citada pela linha `ai_timeout` da Seção 10.2. Este é o
// 1º lugar do projeto onde esse fault realmente precisa forçar uma
// "chamada de IA" a falhar sem bater na rede de verdade.

import { ANTHROPIC_MODELS, callAnthropic } from "../_shared/ai/anthropic.ts";
import type { AiEnv } from "../_shared/deps.ts";
import type { AssembledPrompt } from "../_shared/prompts.ts";
import type { CanonicalEnvelope, ReplayDeps } from "../_shared/replay.ts";

/** "Breve (2 a 4 frases)" (§8.3) — generoso o bastante para isso sem abrir espaço para geração descontrolada; o plano não fixa um número. */
export const INSIGHT_MAX_TOKENS = 256;

export type InsightGenerationResult =
  | { readonly status: "ready"; readonly content: string }
  | { readonly status: "failed" };

export interface GenerateInsightArgs {
  readonly envelope: CanonicalEnvelope;
  readonly prompt: AssembledPrompt;
  readonly replay: ReplayDeps;
  readonly anthropicApiKey: string;
  readonly fetchImpl?: AiEnv["fetchImpl"];
  /** `ctx.fault?.type === 'ai_timeout'` — simula a IA falhando sem chamar a Anthropic de verdade. */
  readonly forceFailure: boolean;
}

export async function generateInsightContent(
  args: GenerateInsightArgs,
): Promise<InsightGenerationResult> {
  if (args.forceFailure) return { status: "failed" };

  try {
    const result = await callAnthropic(
      args.envelope,
      {
        model: ANTHROPIC_MODELS.haiku45,
        system: args.prompt.system,
        messages: args.prompt.messages,
        maxTokens: INSIGHT_MAX_TOKENS,
      },
      { anthropicApiKey: args.anthropicApiKey, fetchImpl: args.fetchImpl, replay: args.replay },
    );

    const textBlock = result.response.content.find(
      (block) => block.type === "text" && typeof block.text === "string",
    );
    const content = textBlock?.text?.trim();
    if (!content) return { status: "failed" };

    return { status: "ready", content };
  } catch {
    // Motivo deliberadamente não propagado — mesmo raciocínio de
    // `generateEntryEmbedding` (T-037): o handler não expõe detalhe
    // interno da falha, `status: 'failed'` já é o sinal.
    return { status: "failed" };
  }
}
