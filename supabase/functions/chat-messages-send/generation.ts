// T-046/T-047 — Geração da resposta do assistente (Plano técnico §8.3
// passos 6-7, §9.3, §9.4).
//
// Dois caminhos, decididos por uma única consulta ao cache (`replay.lookup`,
// chamada diretamente — não via `withReplay`, ver nota em `ai/anthropic.ts`):
//   - hit: reemite o texto já armazenado, fatiado em pedaços de 32
//     caracteres a cada 15ms (T-047, §9.4) — nunca chama a Anthropic.
//   - miss (ou modo `off`): streaming real do Sonnet 5 (`streamAnthropic`,
//     T-046), emitindo `token` a cada pedaço que chega. Em modo diferente
//     de `off`, o texto final é gravado no cache ao terminar.
//   - miss em `replay_strict`: nunca chama o provedor — lança
//     `ReplayMissError` (mesma classe de `replay.ts`, §9.3) antes de
//     emitir qualquer `token`.
//
// Isolado de `handler.ts` para ser testável sem montar o pipeline inteiro
// de gateway/SSE — só precisa de um `SseEmitter` (real ou de teste).

import { ANTHROPIC_MODELS, streamAnthropic } from "../_shared/ai/anthropic.ts";
import type { AssembledPrompt } from "../_shared/prompts.ts";
import {
  type CanonicalEnvelope,
  computeCacheKey,
  type ReplayCacheEntry,
  type ReplayDeps,
  ReplayMissError,
  type ReplayMode,
} from "../_shared/replay.ts";
import { emitReplayedTokens, type SseEmitter } from "../_shared/sse.ts";

export type ReplayStatus = "hit" | "miss" | "off";

/**
 * Consulta o cache sem produzir nenhum evento — usada pelo handler para
 * decidir o header `X-Replay-Status` *antes* de a `Response` SSE começar
 * a sair (headers não podem mudar depois que o corpo já começou a ser
 * escrito). `runChatGeneration` aceita o resultado via `args.prefetch`
 * para não repetir a mesma consulta ao cache duas vezes.
 */
export async function peekChatCacheStatus(
  envelope: CanonicalEnvelope,
  replayMode: ReplayMode,
  replay: ReplayDeps,
): Promise<{ cacheKey: string; hit: ReplayCacheEntry | null; status: ReplayStatus }> {
  const cacheKey = await computeCacheKey(envelope);
  if (replayMode === "off") return { cacheKey, hit: null, status: "off" };
  const hit = await replay.lookup(cacheKey);
  return { cacheKey, hit, status: hit ? "hit" : "miss" };
}

/** Forma armazenada em `experiment.ai_replay_cache.response` para `operation='chat'` — não é o `AnthropicResponse` cru (que carrega blocos/metadados que o replay não precisa), só o texto final e o motivo de parada. */
export interface ChatGenerationCacheResponse {
  readonly text: string;
  readonly finishReason: string;
}

/** Chat não tem um "breve" fixo como o insight (§8.3 não define um número) — valor pragmático, generoso o bastante para uma resposta de chat normal sem abrir espaço para uma geração descontrolada. */
export const CHAT_MAX_TOKENS = 2048;

export interface RunChatGenerationArgs {
  readonly envelope: CanonicalEnvelope;
  readonly prompt: AssembledPrompt;
  readonly replayMode: ReplayMode;
  readonly replay: ReplayDeps;
  readonly anthropicApiKey: string;
  /** Injetável para teste — produção usa `fetch` de verdade. */
  readonly fetchImpl?: typeof fetch;
  readonly emitter: SseEmitter;
  /** Chamado a cada atualização do texto acumulado até agora — o handler usa isso para gravar o texto parcial no banco se a geração falhar no meio do caminho (critério de conclusão do T-046). */
  readonly onPartialText?: (accumulated: string) => void;
  /** Injetável para teste (evita esperar os 15ms reais entre pedaços do T-047) — produção usa `setTimeout` de verdade. */
  readonly replayDelayFn?: (ms: number) => Promise<void>;
  /** Resultado já calculado de `peekChatCacheStatus` — evita consultar o cache duas vezes (uma para o header, outra aqui). Se ausente, este módulo consulta por conta própria (mantém `runChatGeneration` testável isoladamente). */
  readonly prefetch?: { cacheKey: string; hit: ReplayCacheEntry | null };
}

export interface RunChatGenerationResult {
  readonly status: ReplayStatus;
  readonly text: string;
  readonly finishReason: string;
}

export async function runChatGeneration(
  args: RunChatGenerationArgs,
): Promise<RunChatGenerationResult> {
  const cacheKey = args.prefetch?.cacheKey ?? await computeCacheKey(args.envelope);

  if (args.replayMode !== "off") {
    const hit = args.prefetch ? args.prefetch.hit : await args.replay.lookup(cacheKey);
    if (hit) {
      const cached = hit.response as ChatGenerationCacheResponse;
      await emitReplayedTokens(args.emitter, cached.text, { delayFn: args.replayDelayFn });
      args.onPartialText?.(cached.text);
      return { status: "hit", text: cached.text, finishReason: cached.finishReason };
    }

    if (args.replayMode === "replay_strict") {
      // "Lança erro REPLAY_MISS e registra" (§9.3) — nunca chama o
      // provedor real neste modo. Quem decide o que fazer com isso (aqui,
      // virar um evento SSE `error` em vez de uma Response HTTP 500) é o
      // handler, que já importa `ReplayMissError` de `replay.ts` — a
      // mesma classe usada pelos endpoints JSON (`gateway.ts`).
      throw new ReplayMissError(cacheKey, "chat");
    }
  }

  // miss (record/replay) ou modo off — os dois chamam a Anthropic de
  // verdade; a única diferença é se o resultado é gravado no cache ao final.
  let accumulated = "";
  const result = await streamAnthropic(
    {
      model: ANTHROPIC_MODELS.sonnet5,
      system: args.prompt.system,
      messages: args.prompt.messages,
      maxTokens: CHAT_MAX_TOKENS,
    },
    { anthropicApiKey: args.anthropicApiKey, fetchImpl: args.fetchImpl },
    (delta) => {
      accumulated += delta;
      args.emitter.emit({ type: "token", text: delta });
      args.onPartialText?.(accumulated);
    },
  );

  const finishReason = result.stopReason ?? "stop";
  const status = args.replayMode === "off" ? "off" : "miss";
  if (status === "miss") {
    const response: ChatGenerationCacheResponse = { text: result.text, finishReason };
    await args.replay.store({
      cacheKey,
      operation: "chat",
      provider: "anthropic",
      model: ANTHROPIC_MODELS.sonnet5,
      promptVersion: args.envelope.promptVersion,
      requestEnvelope: args.envelope,
      response,
    });
  }

  return { status, text: result.text, finishReason };
}
