// T-057 — GET /dashboard/narrative (Plano técnico §8.5).
//
// "Independente do agregado" — endpoint próprio, falha aqui
// (AI_GENERATION_TIMEOUT) nunca deriva de nem afeta `GET /dashboard/
// aggregate` (T-056). Diferente da narrativa de exportação (T-054), esta
// roda dentro do ciclo requisição/resposta do app — cliente comum
// (`ctx.auth.db`, nunca `service_role`, regra nº5), igual a qualquer outro
// dos 23 endpoints que chama IA (PII, OCR, chat, insight).

import { ANTHROPIC_MODELS, callAnthropic } from "../_shared/ai/anthropic.ts";
import { type AiEnv, buildReplayDeps } from "../_shared/deps.ts";
import {
  type DashboardPeriod,
  fetchEntriesForNarrative,
  periodStartFor,
} from "../_shared/dashboard-repo.ts";
import { throwError } from "../_shared/errors.ts";
import type { GatewayContext, HandlerResult } from "../_shared/gateway.ts";
import { buildDashboardNarrativePrompt } from "../_shared/prompts.ts";
import { buildDashboardEnvelope } from "../_shared/replay.ts";
import { buildDataEnvelope } from "../_shared/serialize.ts";

/** Mesma natureza pragmática de `EXPORT_NARRATIVE_MAX_TOKENS` (T-054) — "3 a 6 frases" (prompts.ts). */
export const DASHBOARD_NARRATIVE_MAX_TOKENS = 512;

export interface DashboardNarrativeQuery {
  readonly period: DashboardPeriod;
}

export async function handleGetDashboardNarrative(
  ctx: GatewayContext<undefined, DashboardNarrativeQuery>,
  env: AiEnv,
): Promise<HandlerResult> {
  const auth = ctx.auth!; // contract.auth === true
  const periodStart = periodStartFor(ctx.query.period, ctx.now);

  const entries = await fetchEntriesForNarrative(auth.db, { periodStart, periodEnd: null });
  const replay = buildReplayDeps(auth.db, env.replayMode);
  const prompt = buildDashboardNarrativePrompt({ promptVersion: env.promptVersion, entries });

  const envelope = await buildDashboardEnvelope({
    provider: "anthropic",
    model: ANTHROPIC_MODELS.haiku45,
    promptVersion: env.promptVersion,
    period: ctx.query.period,
    entryIds: entries.map((e) => e.id),
  });

  let narrativeText: string | undefined;
  if (ctx.fault?.type === "ai_timeout") {
    // "Falha apenas a chamada de IA; o resto do endpoint funciona" (§10.2)
    // — RF09 é um dos 3 casos citados na tabela, mesmo mecanismo do T-050.
    narrativeText = undefined;
  } else {
    try {
      const result = await callAnthropic(
        envelope,
        {
          model: ANTHROPIC_MODELS.haiku45,
          system: prompt.system,
          messages: prompt.messages,
          maxTokens: DASHBOARD_NARRATIVE_MAX_TOKENS,
        },
        { anthropicApiKey: env.anthropicApiKey, fetchImpl: env.fetchImpl, replay },
      );
      const textBlock = result.response.content.find(
        (block) => block.type === "text" && typeof block.text === "string",
      );
      narrativeText = textBlock?.text?.trim();
    } catch {
      narrativeText = undefined;
    }
  }

  if (!narrativeText) {
    throwError("AI_GENERATION_TIMEOUT", "não foi possível gerar a narrativa do dashboard");
  }

  return {
    status: 200,
    envelope: buildDataEnvelope({ text: narrativeText, generated_at: ctx.now.toISOString() }),
  };
}
