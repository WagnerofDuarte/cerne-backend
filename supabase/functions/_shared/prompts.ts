// T-042 — Módulo `prompts` (Plano técnico §7, D5).
//
// "Toda montagem de prompt acontece no servidor" (D5) — o app cliente
// nunca vê nem envia o texto de sistema, o histórico formatado ou o
// contexto do RAG; manda só o texto que o usuário digitou. Sem isso, os
// dois ciclos comparativos montariam pacotes de prompt diferentes e o
// cache de replay teria acerto perto de zero (D5, literal).
//
// Versionado por `PROMPT_VERSION`: cada versão de template vive numa
// entrada própria do registro abaixo. Pedir uma versão sem entrada
// registrada lança um erro em vez de silenciosamente cair num template
// qualquer — é isso que torna `PROMPT_VERSION` uma âncora de verdade, não
// só uma etiqueta solta. O que este módulo NÃO consegue impedir sozinho:
// alguém editar a wording de `v1` no lugar, sem criar uma `v2` nova — essa
// disciplina é de quem mexe no código, nenhuma checagem em tempo de
// execução detecta isso (documentado explicitamente, não escondido).
//
// Importante: a `cache_key` (replay.ts, Seção 9.2) NÃO depende do texto
// literal produzido aqui — depende de `promptVersion` como *proxy*. Este
// módulo só é responsável por montar o payload real enviado à Anthropic;
// quem decide o que entra na impressão digital do cache é `replay.ts`
// (`buildChatEnvelope`/`buildInsightEnvelope`, já implementados na Fase 2).

import type { AnthropicMessage } from "./ai/anthropic.ts";

export type Persona = "analitico" | "empatico" | "socratico";

export interface HistoryTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
}

/** Uma entrada recuperada pelo RAG (T-043) — só o suficiente para dar contexto ao prompt. */
export interface RetrievedEntry {
  readonly id: string;
  readonly content: string;
}

export interface AssembledPrompt {
  readonly system: string;
  readonly messages: readonly AnthropicMessage[];
}

export interface ChatPromptArgs {
  readonly promptVersion: string;
  readonly persona: Persona;
  /** Já em ordem de `seq ASC` — não inclui a mensagem que está sendo respondida agora. */
  readonly history: readonly HistoryTurn[];
  /** Já ordenadas por relevância (T-043) — a ordem aqui não afeta a `cache_key` (essa é responsabilidade de `buildChatEnvelope`), só a wording do prompt. */
  readonly retrievedEntries: readonly RetrievedEntry[];
  readonly userMessage: string;
}

export interface InsightPromptArgs {
  readonly promptVersion: string;
  readonly persona: Persona;
  readonly triggerType: "message_count" | "inactivity";
  /** Já em ordem de `seq ASC`. */
  readonly history: readonly HistoryTurn[];
}

// --- Voz de cada persona (D6 nos documentos-fonte não detalha wording, só a existência de 3 personas — texto abaixo é responsabilidade deste módulo) ---

const PERSONA_VOICE: Record<Persona, string> = {
  analitico:
    "Responda de forma analítica e estruturada: organize a resposta em pontos claros e objetivos.",
  empatico:
    "Responda de forma acolhedora e empática: valide o que a pessoa sente antes de qualquer sugestão.",
  socratico:
    "Responda principalmente com perguntas abertas, ajudando a pessoa a chegar às próprias conclusões em vez de dar respostas prontas.",
};

function formatRetrievedEntries(entries: readonly RetrievedEntry[]): string {
  if (entries.length === 0) return "Nenhum registro anterior relevante foi encontrado.";
  return entries.map((e, i) => `[${i + 1}] (id ${e.id}) ${e.content}`).join("\n");
}

/** Mesmo formato de `formatRetrievedEntries` — as duas operações de narrativa (export RF05, dashboard RF09) recebem uma lista de registros, não um histórico de chat. */
function formatEntriesForNarrative(entries: readonly RetrievedEntry[]): string {
  if (entries.length === 0) return "Nenhum registro no período.";
  return entries.map((e, i) => `[${i + 1}] (id ${e.id}) ${e.content}`).join("\n");
}

interface PromptTemplate {
  chatSystem(args: { persona: Persona; retrievedEntries: readonly RetrievedEntry[] }): string;
  insightSystem(
    args: { persona: Persona; triggerType: "message_count" | "inactivity" },
  ): string;
  /** Mensagem final sintética para fechar o histórico do insight num turno `user` — sem ela, uma conversa que termina em `assistant` não pede geração nova de forma confiável. */
  insightClosingInstruction(): string;
  /** Narrativa da exportação (RF05, T-054) — sem persona (`replay.ts`: `personaSnapshot: null` para a operação `narrative`), é um resumo objetivo, não uma fala em personagem. */
  exportNarrativeSystem(): string;
  /** Narrativa do dashboard (RF09, T-057) — mesma natureza sem persona (`replay.ts`, operação `dashboard`). */
  dashboardNarrativeSystem(): string;
}

const V1_TEMPLATE: PromptTemplate = {
  chatSystem({ persona, retrievedEntries }) {
    return [
      "Você é o assistente de diário do Cerne, um app de registro pessoal.",
      PERSONA_VOICE[persona],
      "Use os registros anteriores abaixo como contexto quando forem relevantes — nunca afirme que existe um registro que não está listado.",
      "",
      "Registros anteriores recuperados (ordenados por relevância):",
      formatRetrievedEntries(retrievedEntries),
    ].join("\n");
  },
  insightSystem({ persona, triggerType }) {
    const motivo = triggerType === "message_count"
      ? "a conversa atingiu um novo múltiplo de 5 mensagens do usuário"
      : "a conversa ficou inativa por um tempo";
    return [
      "Você é o assistente de diário do Cerne. Gere um insight breve (2 a 4 frases) sobre a conversa a seguir.",
      PERSONA_VOICE[persona],
      `Gatilho deste insight: ${motivo}.`,
      "Baseie-se só no que foi dito na conversa — não invente fatos que não apareceram nela.",
    ].join("\n");
  },
  insightClosingInstruction() {
    return "Gere o insight agora, com base na conversa acima.";
  },
  exportNarrativeSystem() {
    return [
      "Você é o assistente de diário do Cerne. Escreva um resumo narrativo breve",
      "(3 a 6 frases) dos registros do usuário no período abaixo, em tom neutro e",
      "acolhedor, falando diretamente com o usuário, em português.",
      "Baseie-se só no que está listado — não invente registros que não apareceram.",
    ].join("\n");
  },
  dashboardNarrativeSystem() {
    return [
      "Você é o assistente de diário do Cerne. Escreva um balanço narrativo breve",
      "(3 a 6 frases) da evolução do usuário no período abaixo, em tom neutro e",
      "acolhedor, falando diretamente com o usuário, em português.",
      "Baseie-se só no que está listado — não invente registros que não apareceram.",
    ].join("\n");
  },
};

/** Registro fechado de versões conhecidas. Adicionar uma versão nova = adicionar uma entrada aqui, nunca editar `v1` no lugar. */
const PROMPT_TEMPLATES: Record<string, PromptTemplate> = { v1: V1_TEMPLATE };

function templateFor(promptVersion: string): PromptTemplate {
  const template = PROMPT_TEMPLATES[promptVersion];
  if (!template) {
    throw new Error(
      `PROMPT_VERSION desconhecido: '${promptVersion}' não tem template registrado em prompts.ts`,
    );
  }
  return template;
}

/** Monta o prompt completo de chat (§8.3, passo 6) — nunca chamado diretamente pelo handler sem passar primeiro pelo `rag` (T-043) para preencher `retrievedEntries`. */
export function buildChatPrompt(args: ChatPromptArgs): AssembledPrompt {
  const template = templateFor(args.promptVersion);
  const system = template.chatSystem({
    persona: args.persona,
    retrievedEntries: args.retrievedEntries,
  });
  const messages: AnthropicMessage[] = [
    ...args.history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: args.userMessage },
  ];
  return { system, messages };
}

/** Monta o prompt de geração de insight (T-050, RF08). */
export function buildInsightPrompt(args: InsightPromptArgs): AssembledPrompt {
  const template = templateFor(args.promptVersion);
  const system = template.insightSystem({
    persona: args.persona,
    triggerType: args.triggerType,
  });
  const messages: AnthropicMessage[] = [
    ...args.history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: template.insightClosingInstruction() },
  ];
  return { system, messages };
}

export interface NarrativePromptArgs {
  readonly promptVersion: string;
  readonly entries: readonly RetrievedEntry[];
}

/** Monta o prompt da narrativa de exportação (T-054, RF05). Sem persona (ver `PromptTemplate.exportNarrativeSystem`). */
export function buildExportNarrativePrompt(args: NarrativePromptArgs): AssembledPrompt {
  const template = templateFor(args.promptVersion);
  return {
    system: template.exportNarrativeSystem(),
    messages: [{ role: "user", content: formatEntriesForNarrative(args.entries) }],
  };
}

/** Monta o prompt da narrativa do dashboard (T-057, RF09). Sem persona (ver `PromptTemplate.dashboardNarrativeSystem`). */
export function buildDashboardNarrativePrompt(args: NarrativePromptArgs): AssembledPrompt {
  const template = templateFor(args.promptVersion);
  return {
    system: template.dashboardNarrativeSystem(),
    messages: [{ role: "user", content: formatEntriesForNarrative(args.entries) }],
  };
}
