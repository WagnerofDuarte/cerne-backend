// T-046 — POST /chat/sessions/:id/messages (Plano técnico §8.3, D12).
// Resposta em streaming SSE. Sequência dos 9 passos do §8.3:
//   1. gravar a mensagem do usuário
//   2. gerar embedding da pergunta e executar o RAG (top 5)
//   3. criar a mensagem do assistente, status='streaming'
//   4-9. ver `_shared/chat-generation.ts` (`runChatTurnStream`,
//        compartilhado com o retry, T-048)
//
// Os passos 1-2 ainda são síncronos (antes de qualquer byte do stream
// sair) — uma falha aqui (ex.: EMBEDDING_FAILED do RAG) é uma resposta
// HTTP de erro comum, tratada pelo `catch` do `gateway.ts`, não um
// evento SSE `error`.

import { ANTHROPIC_MODELS } from "../_shared/ai/anthropic.ts";
import {
  findChatSessionById,
  insertMessage,
  listChatMessages,
  setSessionTitleIfEmpty,
  touchSessionUpdatedAt,
} from "../_shared/chat-repo.ts";
import { peekChatCacheStatus, runChatTurnStream } from "../_shared/chat-generation.ts";
import { buildReplayDeps } from "../_shared/deps.ts";
import type { AiEnv } from "../_shared/deps.ts";
import { throwError } from "../_shared/errors.ts";
import type { GatewayContext, StreamHandlerResult } from "../_shared/gateway.ts";
import { buildChatPrompt } from "../_shared/prompts.ts";
import { runRag } from "../_shared/rag.ts";
import { buildChatEnvelope } from "../_shared/replay.ts";
import { createSseStream } from "../_shared/sse.ts";

export interface SendChatMessageBody {
  readonly content: string;
}

// Mesmo raciocínio de `entries-get`/`chat-messages-list`: um `id` que não
// é sequer um uuid não pode ser de ninguém.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Arbitrário, documentado — o plano técnico não fixa um tamanho para o título. */
const TITLE_MAX_LENGTH = 60;

/**
 * Título gerado no servidor por truncamento determinístico da 1ª
 * mensagem — decisão confirmada com o Wagner em 07/09/2026 (big-plan.md,
 * Fase 4): nenhuma chamada de IA para isso, já que não existe operação
 * `title` no cache de replay (`ReplayOperation`, `replay.ts`) nem na
 * tabela da Seção 9.2 — inventar uma exigiria expandir o mecanismo de
 * cache para algo que nenhum documento-fonte pede.
 */
export function deriveSessionTitle(firstMessage: string): string {
  const trimmed = firstMessage.trim();
  if (trimmed.length <= TITLE_MAX_LENGTH) return trimmed;
  return `${trimmed.slice(0, TITLE_MAX_LENGTH).trimEnd()}…`;
}

export async function handleSendChatMessage(
  ctx: GatewayContext<SendChatMessageBody>,
  env: AiEnv,
): Promise<StreamHandlerResult> {
  const auth = ctx.auth!; // contract.auth === true
  const sessionId = ctx.params.id;

  if (!sessionId || !UUID_RE.test(sessionId)) {
    throwError("NOT_FOUND", "sessão de chat não encontrada");
  }
  const session = await findChatSessionById(auth.db, { userId: auth.userId, sessionId });
  if (!session) throwError("NOT_FOUND", "sessão de chat não encontrada");

  // Histórico ANTES da nova mensagem — lido antes do insert, para nunca
  // incluir a própria mensagem que está sendo enviada agora
  // (historySeqs/historyHash do cache, §9.2, e o prompt montado abaixo).
  const history = await listChatMessages(auth.db, { sessionId: session.id });
  const lastHistoryMessage = history[history.length - 1];
  const userSeq = lastHistoryMessage ? lastHistoryMessage.seq + 1 : 1;

  // Passo 1.
  const userMessage = await insertMessage(auth.db, {
    sessionId: session.id,
    userId: auth.userId,
    role: "user",
    content: ctx.body.content,
    seq: userSeq,
    status: "complete",
  });

  if (session.title === "") {
    await setSessionTitleIfEmpty(auth.db, {
      sessionId: session.id,
      title: deriveSessionTitle(ctx.body.content),
    });
  }
  await touchSessionUpdatedAt(auth.db, {
    sessionId: session.id,
    updatedAt: ctx.now.toISOString(),
  });

  // Passo 2 — pode lançar EMBEDDING_FAILED; ainda estamos na fase síncrona
  // da requisição (nenhum evento SSE foi emitido), então propagar é a
  // resposta certa (vira JSON de erro comum via o catch do gateway.ts).
  const replay = buildReplayDeps(auth.db, env.replayMode);
  const { retrievedEntries } = await runRag({
    db: auth.db,
    userMessage: ctx.body.content,
    promptVersion: env.promptVersion,
    voyageApiKey: env.voyageApiKey,
    fetchImpl: env.fetchImpl,
    replay,
  });

  // Passo 3.
  const assistantSeq = userSeq + 1;
  const assistantMessage = await insertMessage(auth.db, {
    sessionId: session.id,
    userId: auth.userId,
    role: "assistant",
    content: "",
    seq: assistantSeq,
    status: "streaming",
  });

  const envelope = await buildChatEnvelope({
    provider: "anthropic",
    model: ANTHROPIC_MODELS.sonnet5,
    promptVersion: env.promptVersion,
    personaSnapshot: session.persona_snapshot,
    historyMessages: history.map((h) => ({ role: h.role, content: h.content, seq: h.seq })),
    userMessage: ctx.body.content,
    retrievedEntryIds: retrievedEntries.map((e) => e.id),
  });

  const prompt = buildChatPrompt({
    promptVersion: env.promptVersion,
    persona: session.persona_snapshot,
    history: history.map((h) => ({ role: h.role, content: h.content })),
    retrievedEntries,
    userMessage: ctx.body.content,
  });

  // Decide o header X-Replay-Status ANTES de abrir o stream — headers não
  // podem mudar depois que o corpo da Response já começou a sair.
  const prefetch = await peekChatCacheStatus(envelope, env.replayMode, replay);

  const { stream, emitter } = createSseStream();

  // Passos 4-9, compartilhados com o retry (T-048) — ver
  // `_shared/chat-generation.ts`. `seq` no payload de `message_created` é
  // o do assistente: é essa linha que o cliente observa mudar de
  // 'streaming' para 'complete'/'failed' (lacuna do §8.3, que só diz "com
  // id" sem especificar; resolvido assim por ser o dado imediatamente
  // útil ao cliente).
  runChatTurnStream({
    db: auth.db,
    emitter,
    userMessageId: userMessage.id,
    assistantMessageId: assistantMessage.id,
    seq: assistantSeq,
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
