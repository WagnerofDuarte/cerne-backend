// Teste do módulo `prompts` (T-042).
// Critério de conclusão do checklist: "PROMPT_VERSION entra na cache_key".

import { assert, assertEquals, assertThrowsSync } from "./_test_utils.ts";
import { buildChatEnvelope, computeCacheKey } from "./replay.ts";
import {
  buildChatPrompt,
  buildDashboardNarrativePrompt,
  buildExportNarrativePrompt,
  buildInsightPrompt,
} from "./prompts.ts";

Deno.test("buildChatPrompt: system inclui a voz da persona e os registros recuperados", () => {
  const prompt = buildChatPrompt({
    promptVersion: "v1",
    persona: "empatico",
    history: [{ role: "user", content: "oi" }, { role: "assistant", content: "olá!" }],
    retrievedEntries: [{ id: "e1", content: "fiquei ansioso antes da apresentação" }],
    userMessage: "e hoje, como devo lidar com isso?",
  });
  assert(prompt.system.includes("acolhedora e empática"));
  assert(prompt.system.includes("fiquei ansioso antes da apresentação"));
  assert(prompt.system.includes("(id e1)"));
});

Deno.test("buildChatPrompt: sem registros recuperados, diz explicitamente que não achou nada", () => {
  const prompt = buildChatPrompt({
    promptVersion: "v1",
    persona: "analitico",
    history: [],
    retrievedEntries: [],
    userMessage: "primeira mensagem",
  });
  assert(prompt.system.includes("Nenhum registro anterior relevante"));
});

Deno.test("buildChatPrompt: messages = histórico (na ordem) + mensagem do usuário por último", () => {
  const prompt = buildChatPrompt({
    promptVersion: "v1",
    persona: "socratico",
    history: [
      { role: "user", content: "m1" },
      { role: "assistant", content: "r1" },
      { role: "user", content: "m2" },
      { role: "assistant", content: "r2" },
    ],
    retrievedEntries: [],
    userMessage: "m3",
  });
  assertEquals(prompt.messages, [
    { role: "user", content: "m1" },
    { role: "assistant", content: "r1" },
    { role: "user", content: "m2" },
    { role: "assistant", content: "r2" },
    { role: "user", content: "m3" },
  ]);
});

Deno.test("buildInsightPrompt: termina com uma instrução em turno `user`, mesmo com histórico terminando em assistant", () => {
  const prompt = buildInsightPrompt({
    promptVersion: "v1",
    persona: "analitico",
    triggerType: "message_count",
    history: [
      { role: "user", content: "m1" },
      { role: "assistant", content: "r1" },
    ],
  });
  const last = prompt.messages[prompt.messages.length - 1];
  assertEquals(last?.role, "user");
  assert(prompt.system.includes("múltiplo de 5 mensagens"));
});

Deno.test("buildInsightPrompt: gatilho 'inactivity' produz motivo diferente no system", () => {
  const prompt = buildInsightPrompt({
    promptVersion: "v1",
    persona: "empatico",
    triggerType: "inactivity",
    history: [{ role: "user", content: "m1" }],
  });
  assert(prompt.system.includes("ficou inativa por um tempo"));
});

Deno.test("PROMPT_VERSION desconhecido lança erro em vez de usar template errado silenciosamente", () => {
  assertThrowsSync(() =>
    buildChatPrompt({
      promptVersion: "v999-nao-existe",
      persona: "analitico",
      history: [],
      retrievedEntries: [],
      userMessage: "oi",
    })
  );
});

// --- Critério de conclusão: PROMPT_VERSION entra na cache_key ------------

Deno.test("PROMPT_VERSION entra na cache_key: mesma conversa, versões diferentes, chaves diferentes", async () => {
  const base = {
    provider: "anthropic",
    model: "claude-sonnet-5",
    personaSnapshot: "empatico",
    historyMessages: [{ role: "user" as const, content: "oi", seq: 1 }],
    userMessage: "e agora?",
    retrievedEntryIds: ["e1", "e2"],
  };
  const envelopeV1 = await buildChatEnvelope({ ...base, promptVersion: "v1" });
  const envelopeV2 = await buildChatEnvelope({ ...base, promptVersion: "v2-hipotetica" });

  const keyV1 = await computeCacheKey(envelopeV1);
  const keyV2 = await computeCacheKey(envelopeV2);
  assert(keyV1 !== keyV2, "cache_key deveria mudar quando PROMPT_VERSION muda, tudo mais igual");

  const keyV1Again = await computeCacheKey(
    await buildChatEnvelope({ ...base, promptVersion: "v1" }),
  );
  assertEquals(keyV1, keyV1Again, "mesmo PROMPT_VERSION e mesmo input -> mesma cache_key");
});

// --- T-054/T-057: narrativa de exportação e de dashboard -------------------

Deno.test("buildExportNarrativePrompt: system pede resumo, mensagem lista as entradas", () => {
  const prompt = buildExportNarrativePrompt({
    promptVersion: "v1",
    entries: [{ id: "e1", content: "fui ao parque" }, { id: "e2", content: "dormi cedo" }],
  });
  assert(prompt.system.includes("resumo narrativo"));
  assert(prompt.messages.length === 1 && prompt.messages[0]?.role === "user");
  assert((prompt.messages[0]?.content as string).includes("(id e1) fui ao parque"));
  assert((prompt.messages[0]?.content as string).includes("(id e2) dormi cedo"));
});

Deno.test("buildExportNarrativePrompt: sem entradas, mensagem diz explicitamente que não há registros", () => {
  const prompt = buildExportNarrativePrompt({ promptVersion: "v1", entries: [] });
  assertEquals(prompt.messages[0]?.content, "Nenhum registro no período.");
});

Deno.test("buildDashboardNarrativePrompt: system pede balanço, mensagem lista as entradas", () => {
  const prompt = buildDashboardNarrativePrompt({
    promptVersion: "v1",
    entries: [{ id: "e1", content: "semana puxada" }],
  });
  assert(prompt.system.includes("balanço narrativo"));
  assert((prompt.messages[0]?.content as string).includes("(id e1) semana puxada"));
});

Deno.test("narrativa: nenhum dos dois templates menciona persona (replay.ts: personaSnapshot null)", () => {
  const exportPrompt = buildExportNarrativePrompt({ promptVersion: "v1", entries: [] });
  const dashboardPrompt = buildDashboardNarrativePrompt({ promptVersion: "v1", entries: [] });
  for (const voice of ["acolhedora e empática", "analítica e estruturada", "perguntas abertas"]) {
    assert(!exportPrompt.system.includes(voice));
    assert(!dashboardPrompt.system.includes(voice));
  }
});
