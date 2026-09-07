// Teste do módulo `ai/anthropic` (T-032).
// Critério de conclusão do checklist: "segunda chamada idêntica retorna hit".

import { assert, assertEquals, assertThrowsAsync } from "../_test_utils.ts";
import { buildPiiEnvelope, type ReplayDeps } from "../replay.ts";
import {
  ANTHROPIC_MODELS,
  AnthropicApiError,
  callAnthropic,
  streamAnthropic,
} from "./anthropic.ts";

const OFF_REPLAY: ReplayDeps = {
  mode: "off",
  lookup: () => Promise.resolve(null),
  store: () => Promise.resolve(),
};

function fakeReplayDeps(): ReplayDeps & { mode: "record" } {
  const cache = new Map<string, { response: unknown; hitCount: number }>();
  return {
    mode: "record",
    lookup: (cacheKey) => {
      const entry = cache.get(cacheKey);
      if (!entry) return Promise.resolve(null);
      entry.hitCount += 1;
      return Promise.resolve({ ...entry });
    },
    store: (args) => {
      if (!cache.has(args.cacheKey)) {
        cache.set(args.cacheKey, { response: args.response, hitCount: 0 });
      }
      return Promise.resolve();
    },
  };
}

/** Contador de chamadas simples, sem getter/cast — só um objeto mutável. */
function fakeFetch(
  responseBody: unknown,
  status = 200,
): { fetchImpl: typeof fetch; calls: { count: number } } {
  const calls = { count: 0 };
  const fetchImpl = ((..._args: Parameters<typeof fetch>) => {
    calls.count += 1;
    return Promise.resolve(
      new Response(JSON.stringify(responseBody), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const VALID_MESSAGES_RESPONSE = {
  id: "msg_1",
  model: ANTHROPIC_MODELS.haiku45,
  content: [{ type: "text", text: "olá!" }],
  stop_reason: "end_turn",
};

Deno.test("segunda chamada idêntica retorna hit sem bater na rede (critério de conclusão do T-032)", async () => {
  const envelope = buildPiiEnvelope({
    provider: "anthropic",
    model: ANTHROPIC_MODELS.haiku45,
    promptVersion: "v1",
    text: "meu nome é Wagner",
  });
  const request = {
    model: ANTHROPIC_MODELS.haiku45,
    messages: [{ role: "user" as const, content: "detecte PII em: meu nome é Wagner" }],
    maxTokens: 256,
  };
  const replay = fakeReplayDeps();
  const { fetchImpl, calls } = fakeFetch(VALID_MESSAGES_RESPONSE);

  const first = await callAnthropic(envelope, request, {
    anthropicApiKey: "chave-de-teste",
    fetchImpl,
    replay,
  });
  assertEquals(first.status, "miss");
  assertEquals(calls.count, 1);

  const second = await callAnthropic(envelope, request, {
    anthropicApiKey: "chave-de-teste",
    fetchImpl,
    replay,
  });
  assertEquals(second.status, "hit");
  assertEquals(calls.count, 1, "não deveria ter chamado fetch de novo");
  assertEquals(second.response, first.response);
});

Deno.test("envia os campos certos no corpo da requisição (model, max_tokens, headers)", async () => {
  let capturedInit: RequestInit | undefined;
  const fetchImpl = ((_url: string | URL | Request, init?: RequestInit) => {
    capturedInit = init;
    return Promise.resolve(
      new Response(JSON.stringify(VALID_MESSAGES_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch;

  const envelope = buildPiiEnvelope({
    provider: "anthropic",
    model: ANTHROPIC_MODELS.haiku45,
    promptVersion: "v1",
    text: "x",
  });
  await callAnthropic(
    envelope,
    { model: ANTHROPIC_MODELS.haiku45, messages: [{ role: "user", content: "x" }], maxTokens: 64 },
    { anthropicApiKey: "chave-abc", fetchImpl, replay: OFF_REPLAY },
  );

  const headers = new Headers(capturedInit?.headers);
  assertEquals(headers.get("x-api-key"), "chave-abc");
  assertEquals(headers.get("anthropic-version"), "2023-06-01");
  const body = JSON.parse(capturedInit?.body as string);
  assertEquals(body.model, ANTHROPIC_MODELS.haiku45);
  assertEquals(body.max_tokens, 64);
});

Deno.test("manda um AbortSignal no fetch — sem ele, uma chamada presa nunca falha sozinha (achado real, T-041)", async () => {
  let capturedInit: RequestInit | undefined;
  const fetchImpl = ((_url: string | URL | Request, init?: RequestInit) => {
    capturedInit = init;
    return Promise.resolve(
      new Response(JSON.stringify(VALID_MESSAGES_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch;

  const envelope = buildPiiEnvelope({
    provider: "anthropic",
    model: ANTHROPIC_MODELS.haiku45,
    promptVersion: "v1",
    text: "x",
  });
  await callAnthropic(
    envelope,
    { model: ANTHROPIC_MODELS.haiku45, messages: [{ role: "user", content: "x" }], maxTokens: 64 },
    { anthropicApiKey: "chave-abc", fetchImpl, replay: OFF_REPLAY },
  );

  assert(capturedInit?.signal instanceof AbortSignal);
  assertEquals(capturedInit.signal.aborted, false);
});

Deno.test("resposta não-2xx vira AnthropicApiError, propagado por withReplay", async () => {
  const envelope = buildPiiEnvelope({
    provider: "anthropic",
    model: ANTHROPIC_MODELS.haiku45,
    promptVersion: "v1",
    text: "x",
  });
  const { fetchImpl } = fakeFetch({ error: { message: "rate limited pela Anthropic" } }, 429);

  const err = await assertThrowsAsync(() =>
    callAnthropic(
      envelope,
      {
        model: ANTHROPIC_MODELS.haiku45,
        messages: [{ role: "user", content: "x" }],
        maxTokens: 64,
      },
      { anthropicApiKey: "chave", fetchImpl, replay: OFF_REPLAY },
    )
  );
  assert(err instanceof AnthropicApiError);
  assertEquals((err as AnthropicApiError).status, 429);
});

Deno.test("mode 'off': nunca consulta o cache, chama sempre", async () => {
  const envelope = buildPiiEnvelope({
    provider: "anthropic",
    model: ANTHROPIC_MODELS.haiku45,
    promptVersion: "v1",
    text: "x",
  });
  const { fetchImpl, calls } = fakeFetch(VALID_MESSAGES_RESPONSE);
  const request = {
    model: ANTHROPIC_MODELS.haiku45,
    messages: [{ role: "user" as const, content: "x" }],
    maxTokens: 64,
  };

  await callAnthropic(envelope, request, {
    anthropicApiKey: "chave",
    fetchImpl,
    replay: OFF_REPLAY,
  });
  await callAnthropic(envelope, request, {
    anthropicApiKey: "chave",
    fetchImpl,
    replay: OFF_REPLAY,
  });
  assertEquals(calls.count, 2);
});

// --- streamAnthropic (T-046, Fase 4) ---------------------------------------

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Simula a resposta em streaming da Messages API — um `Response` cujo corpo é um `ReadableStream` de bytes, entregue em `chunkBoundaries` pedaços arbitrários (para provar que o parser reagrupa frames cortados no meio). */
function fakeStreamingFetch(
  frames: string[],
  opts: { chunkBoundaries?: number[]; status?: number } = {},
): typeof fetch {
  const fullBody = frames.join("");
  const encoder = new TextEncoder();
  const bytes = encoder.encode(fullBody);
  const boundaries = opts.chunkBoundaries ?? [bytes.length]; // um chunk só, por padrão

  return (() =>
    Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            let offset = 0;
            for (const end of boundaries) {
              controller.enqueue(bytes.slice(offset, end));
              offset = end;
            }
            if (offset < bytes.length) controller.enqueue(bytes.slice(offset));
            controller.close();
          },
        }),
        { status: opts.status ?? 200 },
      ),
    )) as typeof fetch;
}

const request = {
  model: ANTHROPIC_MODELS.sonnet5,
  system: "system prompt",
  messages: [{ role: "user" as const, content: "oi" }],
  maxTokens: 256,
};

Deno.test("streamAnthropic: acumula content_block_delta e chama onDelta na ordem", async () => {
  const frames = [
    sseFrame("message_start", { type: "message_start" }),
    sseFrame("content_block_start", { type: "content_block_start" }),
    sseFrame("content_block_delta", { delta: { type: "text_delta", text: "olá" } }),
    sseFrame("content_block_delta", { delta: { type: "text_delta", text: ", mundo" } }),
    sseFrame("content_block_stop", {}),
    sseFrame("message_delta", { delta: { stop_reason: "end_turn" } }),
    sseFrame("message_stop", {}),
  ];
  const deltas: string[] = [];
  const result = await streamAnthropic(request, {
    anthropicApiKey: "chave",
    fetchImpl: fakeStreamingFetch(frames),
  }, (t) => deltas.push(t));
  assertEquals(deltas, ["olá", ", mundo"]);
  assertEquals(result.text, "olá, mundo");
  assertEquals(result.stopReason, "end_turn");
});

Deno.test("streamAnthropic: reagrupa um frame cortado no meio entre dois chunks de rede", async () => {
  const frames = [sseFrame("content_block_delta", { delta: { type: "text_delta", text: "abc" } })];
  const fullBody = frames.join("");
  // corta bem no meio do frame — antes que a linha \n\n final tenha sido lida
  const cutPoint = Math.floor(fullBody.length / 2);
  const deltas: string[] = [];
  const result = await streamAnthropic(
    request,
    {
      anthropicApiKey: "chave",
      fetchImpl: fakeStreamingFetch(frames, { chunkBoundaries: [cutPoint, fullBody.length] }),
    },
    (t) => deltas.push(t),
  );
  assertEquals(deltas, ["abc"]);
  assertEquals(result.text, "abc");
});

Deno.test("streamAnthropic: eventos desconhecidos (ex.: ping) são ignorados sem quebrar o parsing", async () => {
  const frames = [
    sseFrame("ping", {}),
    sseFrame("content_block_delta", { delta: { type: "text_delta", text: "ok" } }),
    sseFrame("ping", {}),
  ];
  const result = await streamAnthropic(
    request,
    { anthropicApiKey: "chave", fetchImpl: fakeStreamingFetch(frames) },
    () => {},
  );
  assertEquals(result.text, "ok");
});

Deno.test("streamAnthropic: sem stop_reason no stream -> stopReason null", async () => {
  const frames = [sseFrame("content_block_delta", { delta: { type: "text_delta", text: "x" } })];
  const result = await streamAnthropic(
    request,
    { anthropicApiKey: "chave", fetchImpl: fakeStreamingFetch(frames) },
    () => {},
  );
  assertEquals(result.stopReason, null);
});

Deno.test("streamAnthropic: resposta não-2xx vira AnthropicApiError (mesmo tratamento de callAnthropic)", async () => {
  const fetchImpl = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ error: { message: "sobrecarregado" } }), { status: 529 }),
    )) as typeof fetch;
  const err = await assertThrowsAsync(() =>
    streamAnthropic(request, { anthropicApiKey: "chave", fetchImpl }, () => {})
  );
  assert(err instanceof AnthropicApiError);
  assertEquals((err as AnthropicApiError).status, 529);
});

Deno.test("streamAnthropic: resposta 2xx sem corpo -> AnthropicApiError", async () => {
  const fetchImpl = (() => Promise.resolve(new Response(null, { status: 200 }))) as typeof fetch;
  const err = await assertThrowsAsync(() =>
    streamAnthropic(request, { anthropicApiKey: "chave", fetchImpl }, () => {})
  );
  assert(err instanceof AnthropicApiError);
});
