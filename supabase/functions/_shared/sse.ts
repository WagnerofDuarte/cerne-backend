// T-044 — Módulo `sse` (Plano técnico §7, §8.3, D12).
//
// "Emissão de eventos no formato fixo da D12": message_created -> context
// -> token* -> done|error. Dois consumidores diretos: `T-046` (streaming
// real, produzindo eventos enquanto acumula o texto do Sonnet 5) e `T-047`
// (reemissão a partir do cache, fatiando o texto já armazenado).
//
// Responsabilidades deste módulo:
//   1. Encodar cada evento no formato SSE (`event: <tipo>\ndata:
//      <json>\n\n`), validando o payload contra o schema Zod do contrato
//      (`contracts/zod/chat.ts`, T-026) antes de emitir — nunca deixa
//      passar um evento fora do formato combinado.
//   2. Impor a ordem fixa da D12 em tempo de execução — emitir fora de
//      ordem lança, em vez de silenciosamente produzir um stream errado.
//   3. `createSseStream`: ponte entre esse produtor de eventos e o
//      `ReadableStream<Uint8Array>` que o `gateway` (extensão desta
//      tarefa, ver abaixo) devolve como corpo da `Response`.
//   4. `emitReplayedTokens` (T-047): fatia um texto já completo em
//      pedaços de tamanho fixo, para reemitir a experiência de streaming
//      a partir de uma resposta em cache (Seção 9.4).
//
// Extensão de infraestrutura desta tarefa (fora do módulo em si, mas sem
// ela `sse` não tem onde plugar): `gateway.ts` (T-031, Fase 2) só sabia
// devolver `Response` JSON via `dataResponse`. O contrato já previa isso —
// `EndpointContract.response` tem a variante `{ kind: "sse" }` desde o
// registro dos 23 endpoints (T-026, `chat.messages.send`/`.retry`) — mas
// nenhum código ainda usava. `GatewayHandler` agora pode devolver também
// um `SseHandlerResult`, e `runGateway` reconhece a forma (`"stream" in
// result`) e devolve uma `Response` de streaming em vez de serializar
// JSON. Mesmo "ponto de entrada único" (§7) para os 23 endpoints — só uma
// segunda forma de resposta.

import { chatStreamEventSchemas } from "../../../contracts/zod/chat.ts";
import type { ErrorCode } from "./errors.ts";

// --- Tipos dos 5 eventos (mesmo shape dos schemas Zod de chat.ts) --------

export interface MessageCreatedEvent {
  readonly type: "message_created";
  readonly userMessageId: string;
  readonly assistantMessageId: string;
  readonly seq: number;
}

export interface ContextEvent {
  readonly type: "context";
  readonly retrievedEntryIds: readonly string[];
}

export interface TokenEvent {
  readonly type: "token";
  readonly text: string;
}

export interface DoneEvent {
  readonly type: "done";
  readonly assistantMessageId: string;
  readonly finishReason: string;
}

export interface ErrorEvent {
  readonly type: "error";
  readonly code: ErrorCode | "REPLAY_MISS";
  readonly message: string;
  readonly retryable: boolean;
}

export type ChatStreamEvent =
  | MessageCreatedEvent
  | ContextEvent
  | TokenEvent
  | DoneEvent
  | ErrorEvent;

export class SseFormatError extends Error {}
export class SseSequenceError extends Error {}

// --- Encoding (formato SSE) ----------------------------------------------

const encoder = new TextEncoder();

/** Valida o payload contra o schema Zod do contrato e encoda no formato `event: <tipo>\ndata: <json>\n\n`. */
export function encodeSseEvent(event: ChatStreamEvent): Uint8Array {
  const { type, ...payload } = event;
  // `REPLAY_MISS` (fora da taxonomia de 13, §9.3) não está no schema de
  // erro do contrato — só o próprio `errorCodeEnum` (13 códigos) está.
  // Ainda assim é um `type: "error"` SSE legítimo (§9.3: infraestrutura
  // de experimento, HTTP 500 equivalente dentro do stream); a checagem
  // de schema abaixo é pulada só para esse código específico.
  if (type === "error" && (payload as ErrorEvent).code === "REPLAY_MISS") {
    return frameFor(type, payload);
  }

  const schema = chatStreamEventSchemas[type];
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new SseFormatError(
      `evento '${type}' não bate com o schema do contrato: ${parsed.error.message}`,
    );
  }
  return frameFor(type, payload);
}

function frameFor(type: string, payload: unknown): Uint8Array {
  return encoder.encode(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

// --- Ordem fixa da D12 -----------------------------------------------------

type SseState = "start" | "message_created" | "context" | "streaming" | "ended";

const ALLOWED_NEXT: Record<SseState, ReadonlySet<ChatStreamEvent["type"]>> = {
  start: new Set(["message_created"]),
  message_created: new Set(["context"]),
  // Depois de `context`, zero ou mais `token`, terminando em `done` ou `error`.
  context: new Set(["token", "done", "error"]),
  streaming: new Set(["token", "done", "error"]),
  ended: new Set(),
};

function nextState(eventType: ChatStreamEvent["type"]): SseState {
  if (eventType === "done" || eventType === "error") return "ended";
  if (eventType === "token") return "streaming";
  return eventType; // "message_created" | "context"
}

/** Guarda de sequência isolado do encoding — usado por `createSseStream`, exposto também para teste direto da máquina de estados. */
export function createSseSequencer(): { assertNext(eventType: ChatStreamEvent["type"]): void } {
  let state: SseState = "start";
  return {
    assertNext(eventType) {
      if (!ALLOWED_NEXT[state].has(eventType)) {
        throw new SseSequenceError(
          `evento '${eventType}' fora de ordem — estado atual '${state}' só aceita: ${
            [...ALLOWED_NEXT[state]].join(", ") || "(nenhum — stream já encerrado)"
          }`,
        );
      }
      state = nextState(eventType);
    },
  };
}

// --- Produtor: ponte entre eventos e ReadableStream -----------------------

export interface SseEmitter {
  /** Valida (schema + ordem fixa da D12) e emite um evento. Lança se a ordem ou o schema forem violados. */
  emit(event: ChatStreamEvent): void;
  /** Fecha o stream. Chamar exatamente uma vez, sempre depois de `done` ou `error`. */
  close(): void;
}

export interface SseStream {
  readonly stream: ReadableStream<Uint8Array>;
  readonly emitter: SseEmitter;
}

/**
 * Constrói o par (`ReadableStream`, `emitter`) que todo endpoint de chat
 * streaming (T-046/T-048) usa: o handler devolve `stream` como corpo da
 * `Response` (via a extensão de `gateway.ts`) e alimenta `emitter` de
 * dentro de uma função assíncrona não esperada pelo gateway (fire-and-
 * forget deliberado — o corpo da `Response` já foi devolvido; o
 * `ReadableStream` é quem carrega os bytes conforme `emitter.emit` os
 * produz).
 */
export function createSseStream(): SseStream {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const sequencer = createSseSequencer();
  let closed = false;
  const emitter: SseEmitter = {
    emit(event) {
      if (closed) {
        throw new SseSequenceError("emit chamado depois de close() — stream já encerrado");
      }
      sequencer.assertNext(event.type);
      controller.enqueue(encodeSseEvent(event));
    },
    close() {
      closed = true;
      controller.close();
    },
  };
  return { stream, emitter };
}

// --- Cabeçalhos da resposta SSE --------------------------------------------

export function sseHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("Content-Type", "text/event-stream; charset=utf-8");
  headers.set("Cache-Control", "no-cache");
  headers.set("Connection", "keep-alive");
  return headers;
}

// --- T-047: reemissão a partir do cache (Seção 9.4) ------------------------

/** "Fatiando em pedaços de tamanho fixo (32 caracteres) com intervalo de 15ms" (§9.4) — congelados; mudar isso muda a experiência de replay, não é config. */
export const REPLAY_CHUNK_SIZE = 32;
export const REPLAY_CHUNK_INTERVAL_MS = 15;

export interface EmitReplayedTokensOptions {
  readonly chunkSize?: number;
  readonly intervalMs?: number;
  /** Injetável para teste — produção usa `setTimeout` de verdade. */
  readonly delayFn?: (ms: number) => Promise<void>;
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reemite um texto já completo (vindo do cache de replay) como uma
 * sequência de eventos `token`, em pedaços de `chunkSize` caracteres, com
 * `intervalMs` entre cada um. Determinístico por construção: os limites
 * de cada pedaço dependem só do comprimento do texto, nunca do relógio ou
 * da rede — "hit produz exatamente a mesma sequência de eventos"
 * (critério de conclusão do T-047).
 */
export async function emitReplayedTokens(
  emitter: SseEmitter,
  fullText: string,
  opts: EmitReplayedTokensOptions = {},
): Promise<void> {
  const chunkSize = opts.chunkSize ?? REPLAY_CHUNK_SIZE;
  const intervalMs = opts.intervalMs ?? REPLAY_CHUNK_INTERVAL_MS;
  const delayFn = opts.delayFn ?? defaultDelay;

  for (let i = 0; i < fullText.length; i += chunkSize) {
    emitter.emit({ type: "token", text: fullText.slice(i, i + chunkSize) });
    await delayFn(intervalMs);
  }
}
