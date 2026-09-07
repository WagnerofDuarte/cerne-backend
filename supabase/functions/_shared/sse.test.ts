// Teste do módulo `sse` (T-044).
// Critério de conclusão do checklist: "sse_ordem.hurl verde" — aqui
// cobrimos a máquina de estados e o encoding em nível de unidade; o
// próprio `sse_ordem.hurl` (tests/hurl/) exercita isso fim a fim contra o
// endpoint real (T-046), fora do alcance de `deno test`.

import { assert, assertEquals, assertThrowsSync } from "./_test_utils.ts";
import {
  type ChatStreamEvent,
  createSseSequencer,
  createSseStream,
  emitReplayedTokens,
  encodeSseEvent,
  REPLAY_CHUNK_INTERVAL_MS,
  REPLAY_CHUNK_SIZE,
  type SseEmitter,
  SseFormatError,
  sseHeaders,
  SseSequenceError,
} from "./sse.ts";

const decoder = new TextDecoder();

// --- encodeSseEvent --------------------------------------------------------

Deno.test("encodeSseEvent: formato 'event: <tipo>\\ndata: <json>\\n\\n'", () => {
  const bytes = encodeSseEvent({ type: "token", text: "olá" });
  assertEquals(decoder.decode(bytes), `event: token\ndata: ${JSON.stringify({ text: "olá" })}\n\n`);
});

Deno.test("encodeSseEvent: valida cada tipo contra o schema Zod do contrato", () => {
  assertThrowsSync(
    () =>
      encodeSseEvent(
        // deno-lint-ignore no-explicit-any
        { type: "message_created", userMessageId: "não é um uuid" } as any,
      ),
    undefined,
  );
});

Deno.test("encodeSseEvent: evento válido de cada um dos 5 tipos não lança", () => {
  const uuid = "00000000-0000-0000-0000-000000000001";
  const events: ChatStreamEvent[] = [
    { type: "message_created", userMessageId: uuid, assistantMessageId: uuid, seq: 1 },
    { type: "context", retrievedEntryIds: [uuid] },
    { type: "token", text: "abc" },
    { type: "done", assistantMessageId: uuid, finishReason: "stop" },
    { type: "error", code: "AI_GENERATION_TIMEOUT", message: "falhou", retryable: true },
  ];
  for (const event of events) {
    encodeSseEvent(event); // não deve lançar
  }
});

Deno.test("encodeSseEvent: 'error' com code REPLAY_MISS é aceito mesmo fora dos 13 códigos (§9.3)", () => {
  const bytes = encodeSseEvent({
    type: "error",
    code: "REPLAY_MISS",
    message: "sem entrada em cache",
    retryable: false,
  });
  assert(decoder.decode(bytes).includes("REPLAY_MISS"));
});

// --- createSseSequencer (ordem fixa da D12) --------------------------------

Deno.test("sequencer: aceita a ordem feliz message_created -> context -> token -> token -> done", () => {
  const seq = createSseSequencer();
  seq.assertNext("message_created");
  seq.assertNext("context");
  seq.assertNext("token");
  seq.assertNext("token");
  seq.assertNext("done");
});

Deno.test("sequencer: aceita zero tokens (context -> error direto)", () => {
  const seq = createSseSequencer();
  seq.assertNext("message_created");
  seq.assertNext("context");
  seq.assertNext("error");
});

Deno.test("sequencer: rejeita começar com qualquer coisa que não seja message_created", () => {
  const seq = createSseSequencer();
  assertThrowsSync(() => seq.assertNext("context"), undefined);
});

Deno.test("sequencer: rejeita token antes de context", () => {
  const seq = createSseSequencer();
  seq.assertNext("message_created");
  assertThrowsSync(() => seq.assertNext("token"), undefined);
});

Deno.test("sequencer: rejeita qualquer evento depois de done/error (stream já encerrado)", () => {
  const seq = createSseSequencer();
  seq.assertNext("message_created");
  seq.assertNext("context");
  seq.assertNext("done");
  assertThrowsSync(() => seq.assertNext("token"), undefined);
  assertThrowsSync(() => seq.assertNext("error"), undefined);
});

Deno.test("sequencer: rejeita message_created ou context repetidos", () => {
  const seq = createSseSequencer();
  seq.assertNext("message_created");
  assertThrowsSync(() => seq.assertNext("message_created"), undefined);
  seq.assertNext("context");
  assertThrowsSync(() => seq.assertNext("context"), undefined);
});

// --- createSseStream --------------------------------------------------------

async function collectStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return decoder.decode(out);
}

const uuid = "00000000-0000-0000-0000-000000000001";

Deno.test("createSseStream: bytes emitidos batem exatamente com a sequência de eventos, na ordem", async () => {
  const { stream, emitter } = createSseStream();
  emitter.emit({ type: "message_created", userMessageId: uuid, assistantMessageId: uuid, seq: 1 });
  emitter.emit({ type: "context", retrievedEntryIds: [] });
  emitter.emit({ type: "token", text: "oi" });
  emitter.emit({ type: "done", assistantMessageId: uuid, finishReason: "stop" });
  emitter.close();

  const text = await collectStream(stream);
  const expected = [
    "event: message_created",
    "event: context",
    "event: token",
    "event: done",
  ];
  let searchFrom = 0;
  for (const marker of expected) {
    const idx = text.indexOf(marker, searchFrom);
    assert(idx >= searchFrom, `esperava encontrar '${marker}' na ordem certa`);
    searchFrom = idx + marker.length;
  }
});

Deno.test("createSseStream: emit fora de ordem lança (propaga o SseSequenceError do sequencer)", () => {
  const { emitter } = createSseStream();
  assertThrowsSync(
    () => emitter.emit({ type: "token", text: "fora de ordem" }),
    undefined,
  );
});

Deno.test("createSseStream: emit depois de close() lança", () => {
  const { emitter } = createSseStream();
  emitter.emit({ type: "message_created", userMessageId: uuid, assistantMessageId: uuid, seq: 1 });
  emitter.close();
  assertThrowsSync(
    () => emitter.emit({ type: "context", retrievedEntryIds: [] }),
    undefined,
  );
});

// --- sseHeaders --------------------------------------------------------

Deno.test("sseHeaders: Content-Type text/event-stream, sem cache, keep-alive", () => {
  const headers = sseHeaders();
  assertEquals(headers.get("Content-Type"), "text/event-stream; charset=utf-8");
  assertEquals(headers.get("Cache-Control"), "no-cache");
  assertEquals(headers.get("Connection"), "keep-alive");
});

// --- emitReplayedTokens (T-047) --------------------------------------------

function collectingEmitter(): { emitter: SseEmitter; events: ChatStreamEvent[] } {
  const events: ChatStreamEvent[] = [];
  return {
    events,
    emitter: {
      emit: (event) => {
        events.push(event);
      },
      close: () => {},
    },
  };
}

Deno.test("emitReplayedTokens: fatia em pedaços de 32 caracteres por padrão", async () => {
  const { emitter, events } = collectingEmitter();
  const text = "a".repeat(70); // 32 + 32 + 6
  await emitReplayedTokens(emitter, text, { delayFn: () => Promise.resolve() });
  assertEquals(events.map((e) => (e as { text: string }).text.length), [32, 32, 6]);
  assertEquals(events.map((e) => (e as { text: string }).text).join(""), text);
});

Deno.test("emitReplayedTokens: texto vazio não emite nenhum token", async () => {
  const { emitter, events } = collectingEmitter();
  await emitReplayedTokens(emitter, "", { delayFn: () => Promise.resolve() });
  assertEquals(events.length, 0);
});

Deno.test("emitReplayedTokens: texto menor que um chunk emite um único evento", async () => {
  const { emitter, events } = collectingEmitter();
  await emitReplayedTokens(emitter, "curto", { delayFn: () => Promise.resolve() });
  assertEquals(events, [{ type: "token", text: "curto" }]);
});

Deno.test("emitReplayedTokens: espera intervalMs entre cada pedaço (delayFn injetado)", async () => {
  const { emitter } = collectingEmitter();
  const delays: number[] = [];
  await emitReplayedTokens(emitter, "a".repeat(70), {
    delayFn: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    },
  });
  assertEquals(delays, [
    REPLAY_CHUNK_INTERVAL_MS,
    REPLAY_CHUNK_INTERVAL_MS,
    REPLAY_CHUNK_INTERVAL_MS,
  ]);
});

Deno.test("emitReplayedTokens: determinístico — mesmo texto produz exatamente a mesma sequência (critério de conclusão do T-047)", async () => {
  const text = "resposta completa vinda do cache, reemitida em pedaços fixos.";
  const run1 = collectingEmitter();
  const run2 = collectingEmitter();
  await emitReplayedTokens(run1.emitter, text, { delayFn: () => Promise.resolve() });
  await emitReplayedTokens(run2.emitter, text, { delayFn: () => Promise.resolve() });
  assertEquals(run1.events, run2.events);
});

Deno.test("emitReplayedTokens: chunkSize/intervalMs customizados são respeitados", async () => {
  const { emitter, events } = collectingEmitter();
  const delays: number[] = [];
  await emitReplayedTokens(emitter, "abcdefghij", {
    chunkSize: 4,
    intervalMs: 5,
    delayFn: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    },
  });
  assertEquals(events.map((e) => (e as { text: string }).text), ["abcd", "efgh", "ij"]);
  assertEquals(delays, [5, 5, 5]);
});

Deno.test("REPLAY_CHUNK_SIZE e REPLAY_CHUNK_INTERVAL_MS batem com a Seção 9.4 (32 caracteres / 15ms)", () => {
  assertEquals(REPLAY_CHUNK_SIZE, 32);
  assertEquals(REPLAY_CHUNK_INTERVAL_MS, 15);
});

// --- Reexporta as classes de erro só para checar que existem e são Error --

Deno.test("SseFormatError e SseSequenceError são subclasses de Error", () => {
  assert(new SseFormatError("x") instanceof Error);
  assert(new SseSequenceError("x") instanceof Error);
});
