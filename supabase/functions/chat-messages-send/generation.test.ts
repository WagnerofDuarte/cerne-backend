// Teste do módulo `generation` (T-046/T-047).
// Critérios de conclusão: "hit produz exatamente a mesma sequência de
// eventos" (T-047) e "queda no meio do streaming preserva o texto
// parcial com status='failed'" (T-046, verificado aqui a nível do que o
// módulo expõe via onPartialText — a gravação em si é do handler).

import { assert, assertEquals, assertThrowsAsync } from "../_shared/_test_utils.ts";
import { AnthropicApiError } from "../_shared/ai/anthropic.ts";
import type { CanonicalEnvelope, ReplayDeps } from "../_shared/replay.ts";
import { ReplayMissError } from "../_shared/replay.ts";
import type { ChatStreamEvent, SseEmitter } from "../_shared/sse.ts";
import {
  type ChatGenerationCacheResponse,
  peekChatCacheStatus,
  runChatGeneration,
} from "./generation.ts";

function collectingEmitter(): { emitter: SseEmitter; tokens: string[] } {
  const tokens: string[] = [];
  return {
    tokens,
    emitter: {
      emit: (event: ChatStreamEvent) => {
        if (event.type === "token") tokens.push(event.text);
      },
      close: () => {},
    },
  };
}

function fakeReplay(
  opts: { mode: ReplayDeps["mode"]; cached?: ChatGenerationCacheResponse },
): { replay: ReplayDeps; stored: unknown[] } {
  const stored: unknown[] = [];
  const replay: ReplayDeps = {
    mode: opts.mode,
    lookup: () => Promise.resolve(opts.cached ? { response: opts.cached, hitCount: 1 } : null),
    store: (args) => {
      stored.push(args);
      return Promise.resolve();
    },
  };
  return { replay, stored };
}

const ENVELOPE: CanonicalEnvelope = {
  operation: "chat",
  provider: "anthropic",
  model: "claude-sonnet-5",
  promptVersion: "v1",
  personaSnapshot: "empatico",
  input: { historySeqs: [], historyHash: "h", userMessage: "oi", retrievedEntryIds: [] },
};

const PROMPT = { system: "system", messages: [{ role: "user" as const, content: "oi" }] };

function fakeStreamFetch(deltas: string[], opts: { status?: number } = {}): typeof fetch {
  const encoder = new TextEncoder();
  const frames = [
    ...deltas.map((d) =>
      `event: content_block_delta\ndata: ${JSON.stringify({ delta: { text: d } })}\n\n`
    ),
    `event: message_delta\ndata: ${JSON.stringify({ delta: { stop_reason: "end_turn" } })}\n\n`,
  ].join("");
  return (() =>
    Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(frames));
            controller.close();
          },
        }),
        { status: opts.status ?? 200 },
      ),
    )) as typeof fetch;
}

// --- Hit (T-047) -------------------------------------------------------

Deno.test("hit: reemite o texto do cache fatiado, nunca chama a Anthropic", async () => {
  const { emitter, tokens } = collectingEmitter();
  const { replay } = fakeReplay({
    mode: "replay",
    cached: { text: "a".repeat(40), finishReason: "end_turn" },
  });
  const fetchImpl = (() => {
    throw new Error("não deveria chamar fetch num hit");
  }) as unknown as typeof fetch;

  const result = await runChatGeneration({
    envelope: ENVELOPE,
    prompt: PROMPT,
    replayMode: "replay",
    replay,
    anthropicApiKey: "chave",
    fetchImpl,
    emitter,
    replayDelayFn: () => Promise.resolve(),
  });

  assertEquals(result.status, "hit");
  assertEquals(result.text, "a".repeat(40));
  assertEquals(tokens.join(""), "a".repeat(40));
  assertEquals(tokens.length, 2); // 32 + 8
});

Deno.test("hit: mesmo texto em cache produz exatamente a mesma sequência de eventos em duas execuções", async () => {
  const cached: ChatGenerationCacheResponse = {
    text: "resposta idêntica",
    finishReason: "end_turn",
  };
  const run1 = collectingEmitter();
  const run2 = collectingEmitter();
  const { replay: replay1 } = fakeReplay({ mode: "replay", cached });
  const { replay: replay2 } = fakeReplay({ mode: "replay", cached });

  await runChatGeneration({
    envelope: ENVELOPE,
    prompt: PROMPT,
    replayMode: "replay",
    replay: replay1,
    anthropicApiKey: "chave",
    emitter: run1.emitter,
    replayDelayFn: () => Promise.resolve(),
  });
  await runChatGeneration({
    envelope: ENVELOPE,
    prompt: PROMPT,
    replayMode: "replay",
    replay: replay2,
    anthropicApiKey: "chave",
    emitter: run2.emitter,
    replayDelayFn: () => Promise.resolve(),
  });

  assertEquals(run1.tokens, run2.tokens);
});

// --- Miss (T-046) --------------------------------------------------------

Deno.test("miss: streaming real, emite token por delta, grava no cache ao final", async () => {
  const { emitter, tokens } = collectingEmitter();
  const { replay, stored } = fakeReplay({ mode: "replay" });
  const fetchImpl = fakeStreamFetch(["olá", ", mundo"]);

  const result = await runChatGeneration({
    envelope: ENVELOPE,
    prompt: PROMPT,
    replayMode: "replay",
    replay,
    anthropicApiKey: "chave",
    fetchImpl,
    emitter,
  });

  assertEquals(result.status, "miss");
  assertEquals(result.text, "olá, mundo");
  assertEquals(result.finishReason, "end_turn");
  assertEquals(tokens, ["olá", ", mundo"]);
  assertEquals(stored.length, 1);
  assertEquals(
    (stored[0] as { response: ChatGenerationCacheResponse }).response,
    { text: "olá, mundo", finishReason: "end_turn" },
  );
});

Deno.test("modo off: streaming real, mas NUNCA grava no cache", async () => {
  const { emitter } = collectingEmitter();
  const { replay, stored } = fakeReplay({ mode: "off" });
  const fetchImpl = fakeStreamFetch(["x"]);

  const result = await runChatGeneration({
    envelope: ENVELOPE,
    prompt: PROMPT,
    replayMode: "off",
    replay,
    anthropicApiKey: "chave",
    fetchImpl,
    emitter,
  });

  assertEquals(result.status, "off");
  assertEquals(stored.length, 0);
});

Deno.test("onPartialText é chamado com o texto acumulado a cada delta (base para preservar texto parcial em falha)", async () => {
  const { emitter } = collectingEmitter();
  const { replay } = fakeReplay({ mode: "replay" });
  const fetchImpl = fakeStreamFetch(["ab", "cd", "ef"]);
  const partials: string[] = [];

  await runChatGeneration({
    envelope: ENVELOPE,
    prompt: PROMPT,
    replayMode: "replay",
    replay,
    anthropicApiKey: "chave",
    fetchImpl,
    emitter,
    onPartialText: (acc) => partials.push(acc),
  });

  assertEquals(partials, ["ab", "abcd", "abcdef"]);
});

Deno.test("falha da Anthropic no meio do streaming propaga o erro (handler decide o evento SSE e o status='failed')", async () => {
  const { emitter } = collectingEmitter();
  const { replay } = fakeReplay({ mode: "replay" });
  const fetchImpl = fakeStreamFetch([], { status: 529 });

  const err = await assertThrowsAsync(() =>
    runChatGeneration({
      envelope: ENVELOPE,
      prompt: PROMPT,
      replayMode: "replay",
      replay,
      anthropicApiKey: "chave",
      fetchImpl,
      emitter,
    })
  );
  assert(err instanceof AnthropicApiError);
});

// --- replay_strict (§9.3) -------------------------------------------------

Deno.test("replay_strict com miss: lança ReplayMissError, nunca chama a Anthropic", async () => {
  const { emitter } = collectingEmitter();
  const { replay, stored } = fakeReplay({ mode: "replay_strict" });
  const fetchImpl = (() => {
    throw new Error("replay_strict nunca deveria chamar a Anthropic num miss");
  }) as unknown as typeof fetch;

  const err = await assertThrowsAsync(() =>
    runChatGeneration({
      envelope: ENVELOPE,
      prompt: PROMPT,
      replayMode: "replay_strict",
      replay,
      anthropicApiKey: "chave",
      fetchImpl,
      emitter,
    })
  );
  assert(err instanceof ReplayMissError);
  assertEquals(stored.length, 0);
});

Deno.test("replay_strict com hit: serve do cache normalmente", async () => {
  const { emitter, tokens } = collectingEmitter();
  const { replay } = fakeReplay({
    mode: "replay_strict",
    cached: { text: "do cache", finishReason: "end_turn" },
  });

  const result = await runChatGeneration({
    envelope: ENVELOPE,
    prompt: PROMPT,
    replayMode: "replay_strict",
    replay,
    anthropicApiKey: "chave",
    emitter,
    replayDelayFn: () => Promise.resolve(),
  });

  assertEquals(result.status, "hit");
  assertEquals(tokens.join(""), "do cache");
});

// --- peekChatCacheStatus (header X-Replay-Status antes do stream) --------

Deno.test("peekChatCacheStatus: modo off -> 'off' sem consultar o cache", async () => {
  const { replay } = fakeReplay({ mode: "off" });
  let lookupCalls = 0;
  const wrapped: ReplayDeps = { ...replay, lookup: (k) => (lookupCalls++, replay.lookup(k)) };
  const result = await peekChatCacheStatus(ENVELOPE, "off", wrapped);
  assertEquals(result.status, "off");
  assertEquals(lookupCalls, 0);
});

Deno.test("peekChatCacheStatus: hit -> 'hit', miss -> 'miss'", async () => {
  const { replay: replayHit } = fakeReplay({
    mode: "replay",
    cached: { text: "x", finishReason: "end_turn" },
  });
  assertEquals((await peekChatCacheStatus(ENVELOPE, "replay", replayHit)).status, "hit");

  const { replay: replayMiss } = fakeReplay({ mode: "replay" });
  assertEquals((await peekChatCacheStatus(ENVELOPE, "replay", replayMiss)).status, "miss");
});

Deno.test("prefetch: runChatGeneration reaproveita o resultado sem consultar o cache de novo", async () => {
  const { emitter, tokens } = collectingEmitter();
  const { replay } = fakeReplay({
    mode: "replay",
    cached: { text: "prefetchado", finishReason: "end_turn" },
  });
  let lookupCalls = 0;
  const wrapped: ReplayDeps = { ...replay, lookup: (k) => (lookupCalls++, replay.lookup(k)) };

  const prefetch = await peekChatCacheStatus(ENVELOPE, "replay", wrapped);
  assertEquals(lookupCalls, 1);

  const result = await runChatGeneration({
    envelope: ENVELOPE,
    prompt: PROMPT,
    replayMode: "replay",
    replay: wrapped,
    anthropicApiKey: "chave",
    emitter,
    replayDelayFn: () => Promise.resolve(),
    prefetch,
  });

  assertEquals(lookupCalls, 1, "não deveria consultar o cache de novo — já tinha o prefetch");
  assertEquals(result.status, "hit");
  assertEquals(tokens.join(""), "prefetchado");
});
