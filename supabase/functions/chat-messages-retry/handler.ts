// T-048 — POST /chat/sessions/:id/messages/:userMessageId/retry (Plano
// técnico §8.3, D15). Resposta em streaming SSE, corpo vazio.
//
// D15: "Regenera a resposta da IA sem duplicar a pergunta do usuário.
// Como histórico e pergunta são os mesmos, a impressão digital do cache
// é idêntica à primeira tentativa — retry acerta o cache, custo zero,
// determinístico." Por isso este handler NÃO recebe conteúdo novo — ele
// relê a mensagem do usuário já gravada e reconstrói o mesmo envelope
// (mesmo histórico anterior, mesma pergunta, mesmo RAG recomputado — que
// é determinístico por construção, T-043) que a 1ª tentativa produziu.
//
// Decisão confirmada com o Wagner (big-plan.md, Fase 4): "marcar a
// resposta anterior falhada como substituída" reaproveita A MESMA linha
// de `chat_messages` do assistente (mesmo `id`, mesmo `seq`), resetando
// para `status='streaming'`/`content=''` — não existe (nem deveria
// existir) um estado "substituída" no CHECK já aplicado na migração 0003.
//
// Lacuna preenchida pragmaticamente: o §8.3 valida "que :userMessageId é
// a última mensagem da sessão", mas a mensagem do assistente (mesmo que
// `failed`) já ocupa o `seq` seguinte — literalmente a ÚLTIMA linha da
// tabela nunca é a do usuário. Leitura adotada: "última mensagem da
// sessão" quer dizer "a última mensagem de papel `user`" (nenhum turno
// mais novo foi enviado depois dela) — e nada no contrato exige que a
// resposta do assistente esteja `failed` para permitir o retry.

import { findChatSessionById, listChatMessages, updateMessage } from "../_shared/chat-repo.ts";
import { peekChatCacheStatus, runChatTurnStream } from "../_shared/chat-generation.ts";
import { ANTHROPIC_MODELS } from "../_shared/ai/anthropic.ts";
import { buildReplayDeps } from "../_shared/deps.ts";
import type { AiEnv } from "../_shared/deps.ts";
import { throwError } from "../_shared/errors.ts";
import type { GatewayContext, StreamHandlerResult } from "../_shared/gateway.ts";
import { buildChatPrompt } from "../_shared/prompts.ts";
import { runRag } from "../_shared/rag.ts";
import { buildChatEnvelope } from "../_shared/replay.ts";
import { createSseStream } from "../_shared/sse.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleRetryChatMessage(
  ctx: GatewayContext<Record<string, never>>,
  env: AiEnv,
): Promise<StreamHandlerResult> {
  const auth = ctx.auth!; // contract.auth === true
  const sessionId = ctx.params.id;
  const userMessageId = ctx.params.userMessageId;

  if (!sessionId || !UUID_RE.test(sessionId)) {
    throwError("NOT_FOUND", "sessão de chat não encontrada");
  }
  const session = await findChatSessionById(auth.db, { userId: auth.userId, sessionId });
  if (!session) throwError("NOT_FOUND", "sessão de chat não encontrada");

  const allMessages = await listChatMessages(auth.db, { sessionId: session.id });
  const userMessages = allMessages.filter((m) => m.role === "user");
  const lastUserMessage = userMessages[userMessages.length - 1];

  // "Validar que :userMessageId tem role='user' e é a última mensagem da
  // sessão. Caso contrário: VALIDATION_ERROR" (§8.3, literal — o próprio
  // plano nomeia esse código para esta checagem, diferente do NOT_FOUND
  // genérico de D7 usado em outros endpoints).
  if (!userMessageId || !lastUserMessage || lastUserMessage.id !== userMessageId) {
    throwError(
      "VALIDATION_ERROR",
      "só é possível regenerar a última mensagem do usuário da sessão",
    );
  }
  const userMessage = lastUserMessage;

  const assistantMessage = allMessages.find(
    (m) => m.role === "assistant" && m.seq === userMessage.seq + 1,
  );
  if (!assistantMessage) {
    throwError("VALIDATION_ERROR", "mensagem do assistente correspondente não encontrada");
  }

  // Mesmo histórico da 1ª tentativa: tudo ANTES da mensagem sendo
  // regenerada (nunca inclui o próprio par user/assistant do turno atual).
  const history = allMessages.filter((m) => m.seq < userMessage.seq);

  // "Incrementar retry_count" + reabrir a MESMA linha do assistente
  // (decisão acima) — limpa o conteúdo antigo, volta para 'streaming'.
  await updateMessage(auth.db, {
    messageId: assistantMessage.id,
    content: "",
    status: "streaming",
    retryCount: assistantMessage.retry_count + 1,
  });

  // RAG recomputado (não reaproveitado de nenhum lugar) — determinístico
  // por construção (T-043): mesma pergunta, mesmo estado do banco (retry
  // não escreve em `entries`) => mesmos retrievedEntryIds, na mesma
  // ordem, todas as vezes.
  const replay = buildReplayDeps(auth.db, env.replayMode);
  const { retrievedEntries } = await runRag({
    db: auth.db,
    userMessage: userMessage.content,
    promptVersion: env.promptVersion,
    voyageApiKey: env.voyageApiKey,
    fetchImpl: env.fetchImpl,
    replay,
  });

  const envelope = await buildChatEnvelope({
    provider: "anthropic",
    model: ANTHROPIC_MODELS.sonnet5,
    promptVersion: env.promptVersion,
    personaSnapshot: session.persona_snapshot,
    historyMessages: history.map((h) => ({ role: h.role, content: h.content, seq: h.seq })),
    userMessage: userMessage.content,
    retrievedEntryIds: retrievedEntries.map((e) => e.id),
  });

  const prompt = buildChatPrompt({
    promptVersion: env.promptVersion,
    persona: session.persona_snapshot,
    history: history.map((h) => ({ role: h.role, content: h.content })),
    retrievedEntries,
    userMessage: userMessage.content,
  });

  // Mesmo histórico + mesma pergunta + mesmo RAG => mesmo envelope da 1ª
  // tentativa => mesma cache_key => "X-Replay-Status: hit" (critério de
  // conclusão do T-048), desde que a 1ª tentativa já tenha gravado essa
  // resposta no cache (isto é, REPLAY_MODE não seja 'off' — documentado
  // em tests/hurl/README.md).
  const prefetch = await peekChatCacheStatus(envelope, env.replayMode, replay);

  const { stream, emitter } = createSseStream();

  runChatTurnStream({
    db: auth.db,
    emitter,
    userMessageId: userMessage.id,
    assistantMessageId: assistantMessage.id,
    seq: assistantMessage.seq,
    retrievedEntryIds: retrievedEntries.map((e) => e.id),
    envelope,
    prompt,
    replayMode: env.replayMode,
    replay,
    anthropicApiKey: env.anthropicApiKey,
    fetchImpl: env.fetchImpl,
    prefetch,
  });

  return { stream, headers: { "X-Replay-Status": prefetch.status } };
}
