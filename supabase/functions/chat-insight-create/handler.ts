// T-050 — POST /chat/sessions/:id/insight (Plano técnico §8.3, RF08).
//
// - Tentar inserir; conflito na UNIQUE (session_id, trigger_type,
//   trigger_key — migração 0006) → 200 com o insight existente, sem
//   gerar de novo.
// - Gerar via Haiku atrás do cache.
// - Falha de geração → HTTP 200 com status='failed' e errorCode. NUNCA
//   erro HTTP — "o chat não pode quebrar" (§8.3, literal).
//
// `triggerKey` é calculado pelo CLIENTE (§8.3, "documentado, calculado
// pelo cliente") — este handler não recalcula/verifica a fórmula
// (floor(user_message_count/5) ou id da última mensagem do usuário), só
// usa o que veio como chave de deduplicação da UNIQUE. Fora de escopo de
// medição do RF08 ("apenas o mecanismo de disparo, nunca a qualidade").

import { ANTHROPIC_MODELS } from "../_shared/ai/anthropic.ts";
import {
  findChatSessionById,
  insertInsightIfNotExists,
  type InsightTriggerType,
  listChatMessages,
  updateInsightResult,
} from "../_shared/chat-repo.ts";
import { buildReplayDeps } from "../_shared/deps.ts";
import type { AiEnv } from "../_shared/deps.ts";
import { throwError } from "../_shared/errors.ts";
import type { GatewayContext, HandlerResult } from "../_shared/gateway.ts";
import { buildInsightPrompt } from "../_shared/prompts.ts";
import { buildInsightEnvelope } from "../_shared/replay.ts";
import { buildDataEnvelope } from "../_shared/serialize.ts";
import { generateInsightContent } from "./generation.ts";

export interface CreateInsightBody {
  readonly triggerType: InsightTriggerType;
  readonly triggerKey: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Nenhum dos 13 códigos é específico para "a geração do insight falhou" — mesmo mapeamento genérico já usado pelo OCR (T-041) para "a chamada de IA falhou". */
const INSIGHT_FAILURE_ERROR_CODE = "AI_GENERATION_TIMEOUT";

export async function handleCreateInsight(
  ctx: GatewayContext<CreateInsightBody>,
  env: AiEnv,
): Promise<HandlerResult> {
  const auth = ctx.auth!; // contract.auth === true
  const sessionId = ctx.params.id;

  if (!sessionId || !UUID_RE.test(sessionId)) {
    throwError("NOT_FOUND", "sessão de chat não encontrada");
  }
  const session = await findChatSessionById(auth.db, { userId: auth.userId, sessionId });
  if (!session) throwError("NOT_FOUND", "sessão de chat não encontrada");

  const { insight, alreadyExisted } = await insertInsightIfNotExists(auth.db, {
    sessionId: session.id,
    userId: auth.userId,
    triggerType: ctx.body.triggerType,
    triggerKey: ctx.body.triggerKey,
  });

  // "Conflito na UNIQUE → retornar 200 com o insight existente" — nunca
  // tenta gerar de novo, devolve a linha como está (generating/ready/
  // failed/dismissed).
  if (alreadyExisted) {
    return { status: 200, envelope: buildDataEnvelope(insight) };
  }

  const history = await listChatMessages(auth.db, { sessionId: session.id });
  const replay = buildReplayDeps(auth.db, env.replayMode);

  const envelope = await buildInsightEnvelope({
    provider: "anthropic",
    model: ANTHROPIC_MODELS.haiku45,
    promptVersion: env.promptVersion,
    personaSnapshot: session.persona_snapshot,
    sessionId: session.id,
    triggerType: ctx.body.triggerType,
    triggerKey: ctx.body.triggerKey,
    historyMessages: history.map((h) => ({ role: h.role, content: h.content })),
  });
  const prompt = buildInsightPrompt({
    promptVersion: env.promptVersion,
    persona: session.persona_snapshot,
    triggerType: ctx.body.triggerType,
    history: history.map((h) => ({ role: h.role, content: h.content })),
  });

  const result = await generateInsightContent({
    envelope,
    prompt,
    replay,
    anthropicApiKey: env.anthropicApiKey,
    fetchImpl: env.fetchImpl,
    // §10.2: "ai_timeout: falha apenas a chamada de IA; o resto do
    // endpoint funciona" — RF08 é um dos 3 casos citados pela própria
    // tabela do plano técnico.
    forceFailure: ctx.fault?.type === "ai_timeout",
  });

  const updated = result.status === "ready"
    ? await updateInsightResult(auth.db, {
      insightId: insight.id,
      status: "ready",
      content: result.content,
    })
    : await updateInsightResult(auth.db, {
      insightId: insight.id,
      status: "failed",
      errorCode: INSIGHT_FAILURE_ERROR_CODE,
    });

  // "Nunca erro HTTP" — sempre 200, mesmo quando status='failed'.
  return { status: 200, envelope: buildDataEnvelope(updated) };
}
