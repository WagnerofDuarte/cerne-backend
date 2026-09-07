// Teste do módulo `generation` de insight (T-050, RF08).
// Critério de conclusão: "insight_falha.hurl verde" (com ai_timeout ->
// HTTP 200, status='failed') — a parte de forceFailure é o mecanismo que
// sustenta isso, verificado aqui em nível de unidade.

import { assertEquals } from "../_shared/_test_utils.ts";
import { buildInsightEnvelope, type ReplayDeps } from "../_shared/replay.ts";
import { generateInsightContent } from "./generation.ts";

const envelopePromise = buildInsightEnvelope({
  provider: "anthropic",
  model: "claude-haiku-4-5-20251001",
  promptVersion: "v1",
  personaSnapshot: "empatico",
  sessionId: "s1",
  triggerType: "message_count",
  triggerKey: "1",
  historyMessages: [{ role: "user", content: "oi" }],
});

const PROMPT = { system: "system", messages: [{ role: "user" as const, content: "oi" }] };

function offReplay(): ReplayDeps {
  return { mode: "off", lookup: () => Promise.resolve(null), store: () => Promise.resolve() };
}

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    )) as typeof fetch;
}

Deno.test("forceFailure=true: nunca chama a Anthropic, devolve failed direto", async () => {
  const envelope = await envelopePromise;
  const fetchImpl = (() => {
    throw new Error("não deveria chamar fetch com forceFailure");
  }) as unknown as typeof fetch;

  const result = await generateInsightContent({
    envelope,
    prompt: PROMPT,
    replay: offReplay(),
    anthropicApiKey: "chave",
    fetchImpl,
    forceFailure: true,
  });
  assertEquals(result, { status: "failed" });
});

Deno.test("caminho feliz: extrai o texto do bloco de conteúdo -> ready", async () => {
  const envelope = await envelopePromise;
  const fetchImpl = fakeFetch(200, {
    id: "msg_1",
    model: "claude-haiku-4-5-20251001",
    content: [{ type: "text", text: "Você parece mais animado hoje." }],
    stop_reason: "end_turn",
  });

  const result = await generateInsightContent({
    envelope,
    prompt: PROMPT,
    replay: offReplay(),
    anthropicApiKey: "chave",
    fetchImpl,
    forceFailure: false,
  });
  assertEquals(result, { status: "ready", content: "Você parece mais animado hoje." });
});

Deno.test("resposta sem bloco de texto -> failed", async () => {
  const envelope = await envelopePromise;
  const fetchImpl = fakeFetch(200, {
    id: "msg_1",
    model: "claude-haiku-4-5-20251001",
    content: [],
    stop_reason: "end_turn",
  });

  const result = await generateInsightContent({
    envelope,
    prompt: PROMPT,
    replay: offReplay(),
    anthropicApiKey: "chave",
    fetchImpl,
    forceFailure: false,
  });
  assertEquals(result, { status: "failed" });
});

Deno.test("bloco de texto vazio/só espaços -> failed", async () => {
  const envelope = await envelopePromise;
  const fetchImpl = fakeFetch(200, {
    id: "msg_1",
    model: "claude-haiku-4-5-20251001",
    content: [{ type: "text", text: "   " }],
    stop_reason: "end_turn",
  });

  const result = await generateInsightContent({
    envelope,
    prompt: PROMPT,
    replay: offReplay(),
    anthropicApiKey: "chave",
    fetchImpl,
    forceFailure: false,
  });
  assertEquals(result, { status: "failed" });
});

Deno.test("Anthropic indisponível (não-2xx) -> failed, sem propagar exceção", async () => {
  const envelope = await envelopePromise;
  const fetchImpl = fakeFetch(529, { error: { message: "sobrecarregado" } });

  const result = await generateInsightContent({
    envelope,
    prompt: PROMPT,
    replay: offReplay(),
    anthropicApiKey: "chave",
    fetchImpl,
    forceFailure: false,
  });
  assertEquals(result, { status: "failed" });
});

Deno.test("2ª chamada idêntica atrás do cache: hit, sem bater na rede de novo", async () => {
  const envelope = await envelopePromise;
  let calls = 0;
  const fetchImpl = (() => {
    calls++;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: "msg_1",
          model: "claude-haiku-4-5-20251001",
          content: [{ type: "text", text: "insight" }],
          stop_reason: "end_turn",
        }),
        { status: 200 },
      ),
    );
  }) as typeof fetch;

  const cache = new Map<string, { response: unknown; hitCount: number }>();
  const replay: ReplayDeps = {
    mode: "record",
    lookup: (k) => Promise.resolve(cache.get(k) ?? null),
    store: (a) => {
      cache.set(a.cacheKey, { response: a.response, hitCount: 0 });
      return Promise.resolve();
    },
  };

  await generateInsightContent({
    envelope,
    prompt: PROMPT,
    replay,
    anthropicApiKey: "chave",
    fetchImpl,
    forceFailure: false,
  });
  const second = await generateInsightContent({
    envelope,
    prompt: PROMPT,
    replay,
    anthropicApiKey: "chave",
    fetchImpl,
    forceFailure: false,
  });

  assertEquals(calls, 1, "a 2ª chamada deveria ter vindo do cache");
  assertEquals(second, { status: "ready", content: "insight" });
});
