// T-030 — Módulo `replay` (Plano técnico §7, §9).
//
// Impressão digital determinística de toda chamada a IA (Anthropic ou
// Voyage), consulta/gravação no cache (`experiment.ai_replay_cache`, via
// as RPCs de db.ts — migração 0010) e os 4 modos de operação. `ai/
// anthropic` e `ai/voyage` (T-032) sempre chamam o provedor *através*
// deste módulo — nunca direto.

// --- Envelope canônico (Seção 9.1) ------------------------------------

export type ReplayOperation =
  | "chat"
  | "insight"
  | "pii"
  | "ocr"
  | "embedding"
  | "narrative"
  | "dashboard";

export interface CanonicalEnvelope {
  readonly operation: ReplayOperation;
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  /** `null` para operações sem persona (ocr, embedding, narrative, dashboard). */
  readonly personaSnapshot: string | null;
  readonly input: Record<string, unknown>;
}

// Ordena chaves recursivamente (objetos e dentro de arrays de objetos) —
// "chaves ordenadas alfabeticamente e serialização JSON estável" (§9.1).
// Sem isso, `JSON.stringify` segue a ordem de inserção das propriedades e
// duas montagens do "mesmo" envelope, com campos preenchidos em ordem
// diferente por dois handlers diferentes, produziriam `cache_key`s
// diferentes para um input idêntico — exatamente o que este módulo existe
// para impedir.
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** `cache_key = sha256(json_canonico)`, hexadecimal (§9.1). */
export function computeCacheKey(envelope: CanonicalEnvelope): Promise<string> {
  return sha256Hex(canonicalJsonStringify(envelope));
}

// --- Hashes auxiliares usados pela normalização de `input` (Seção 9.2) -----

export interface HashableChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

/**
 * "SHA-256 da concatenação de role + ':' + content de todas as mensagens
 * da sessão, em ordem de seq" (§9.2, literal — sem separador entre
 * mensagens). O chamador é responsável por já passar `messages` em ordem
 * de `seq ASC`; esta função não reordena.
 */
export function computeHistoryHash(messages: readonly HashableChatMessage[]): Promise<string> {
  const concatenated = messages.map((m) => `${m.role}:${m.content}`).join("");
  return sha256Hex(concatenated);
}

/**
 * Hash auxiliar para `narrative`/`dashboard` (`entryIdsHash`, §9.2) — não
 * detalhado no plano técnico além do nome. Ordenamos antes de concatenar
 * pelo mesmo motivo do `retrievedEntryIds` do chat: o hash precisa
 * independer da ordem em que o SQL devolveu as linhas.
 */
export function computeEntryIdsHash(entryIds: readonly string[]): Promise<string> {
  return sha256Hex([...entryIds].sort().join(","));
}

// --- Normalização de `input` por operação (tabela da Seção 9.2) -----------

export function buildChatEnvelope(args: {
  provider: string;
  model: string;
  promptVersion: string;
  personaSnapshot: string;
  /** Já em ordem de `seq ASC`. */
  historyMessages: readonly (HashableChatMessage & { seq: number })[];
  userMessage: string;
  retrievedEntryIds: readonly string[];
}): Promise<CanonicalEnvelope> {
  return computeHistoryHash(args.historyMessages).then((historyHash) => ({
    operation: "chat" as const,
    provider: args.provider,
    model: args.model,
    promptVersion: args.promptVersion,
    personaSnapshot: args.personaSnapshot,
    input: {
      historySeqs: args.historyMessages.map((m) => m.seq),
      historyHash,
      userMessage: args.userMessage,
      // "retrievedEntryIds deve estar ordenado antes de entrar no
      // envelope" (§9.2) — reordenado aqui, não confiando que o chamador
      // (o módulo `rag`, Fase 4) já tenha feito isso.
      retrievedEntryIds: [...args.retrievedEntryIds].sort(),
    },
  }));
}

export function buildInsightEnvelope(args: {
  provider: string;
  model: string;
  promptVersion: string;
  personaSnapshot: string;
  sessionId: string;
  triggerType: "message_count" | "inactivity";
  triggerKey: string;
  historyMessages: readonly HashableChatMessage[];
}): Promise<CanonicalEnvelope> {
  return computeHistoryHash(args.historyMessages).then((historyHash) => ({
    operation: "insight" as const,
    provider: args.provider,
    model: args.model,
    promptVersion: args.promptVersion,
    personaSnapshot: args.personaSnapshot,
    input: {
      sessionId: args.sessionId,
      triggerType: args.triggerType,
      triggerKey: args.triggerKey,
      historyHash,
    },
  }));
}

export function buildPiiEnvelope(
  args: { provider: string; model: string; promptVersion: string; text: string },
): CanonicalEnvelope {
  return {
    operation: "pii",
    provider: args.provider,
    model: args.model,
    promptVersion: args.promptVersion,
    personaSnapshot: null,
    input: { text: args.text },
  };
}

export function buildOcrEnvelope(
  args: {
    provider: string;
    model: string;
    promptVersion: string;
    imageSha256: string;
    mimeType: string;
  },
): CanonicalEnvelope {
  return {
    operation: "ocr",
    provider: args.provider,
    model: args.model,
    promptVersion: args.promptVersion,
    personaSnapshot: null,
    input: { imageSha256: args.imageSha256, mimeType: args.mimeType },
  };
}

export function buildEmbeddingEnvelope(
  args: {
    provider: string;
    model: string;
    promptVersion: string;
    text: string;
    inputType: "document" | "query";
  },
): CanonicalEnvelope {
  return {
    operation: "embedding",
    provider: args.provider,
    model: args.model,
    promptVersion: args.promptVersion,
    personaSnapshot: null,
    input: { text: args.text, inputType: args.inputType },
  };
}

async function buildPeriodEntriesEnvelope(
  operation: "narrative" | "dashboard",
  args: {
    provider: string;
    model: string;
    promptVersion: string;
    period: string;
    entryIds: readonly string[];
  },
): Promise<CanonicalEnvelope> {
  const entryIdsHash = await computeEntryIdsHash(args.entryIds);
  return {
    operation,
    provider: args.provider,
    model: args.model,
    promptVersion: args.promptVersion,
    personaSnapshot: null,
    input: { period: args.period, entryIdsHash },
  };
}

export function buildNarrativeEnvelope(
  args: {
    provider: string;
    model: string;
    promptVersion: string;
    period: string;
    entryIds: readonly string[];
  },
): Promise<CanonicalEnvelope> {
  return buildPeriodEntriesEnvelope("narrative", args);
}

export function buildDashboardEnvelope(
  args: {
    provider: string;
    model: string;
    promptVersion: string;
    period: string;
    entryIds: readonly string[];
  },
): Promise<CanonicalEnvelope> {
  return buildPeriodEntriesEnvelope("dashboard", args);
}

// --- Modos e orquestração (Seção 9.3) --------------------------------

export type ReplayMode = "off" | "record" | "replay" | "replay_strict";
export type ReplayStatus = "hit" | "miss" | "off";

/**
 * `REPLAY_MISS`: "não está na taxonomia de 13 códigos — é erro de
 * infraestrutura de experimento, retorna HTTP 500 e só ocorre em
 * replay_strict" (§9.3). Por isso não é um `CerneError` — não pertence à
 * lista fechada de `errors.ts`.
 */
export class ReplayMissError extends Error {
  readonly cacheKey: string;
  readonly operation: ReplayOperation;

  constructor(cacheKey: string, operation: ReplayOperation) {
    super(
      `REPLAY_MISS: nenhuma entrada em cache para operation=${operation} cache_key=${cacheKey}`,
    );
    this.name = "ReplayMissError";
    this.cacheKey = cacheKey;
    this.operation = operation;
  }
}

export interface ReplayCacheEntry {
  readonly response: unknown;
  readonly hitCount: number;
}

export interface ReplayDeps {
  readonly mode: ReplayMode;
  readonly lookup: (cacheKey: string) => Promise<ReplayCacheEntry | null>;
  readonly store: (args: {
    cacheKey: string;
    operation: ReplayOperation;
    provider: string;
    model: string;
    promptVersion: string;
    requestEnvelope: CanonicalEnvelope;
    response: unknown;
  }) => Promise<void>;
}

export interface ReplayResult<T> {
  readonly response: T;
  readonly status: ReplayStatus;
  readonly cacheKey: string;
}

/**
 * Executa `callProvider` atrás do cache de replay, seguindo a tabela da
 * Seção 9.3. `off` nunca consulta nem grava o cache — chama o provedor
 * sempre. `record`/`replay` servem do cache em hit e chamam-e-gravam em
 * miss (comportamento idêntico entre os dois, por desenho — a diferença
 * entre eles é de processo/quando são usados, não de código).
 * `replay_strict` nunca chama o provedor: um miss vira `ReplayMissError`.
 */
export async function withReplay<T>(
  envelope: CanonicalEnvelope,
  callProvider: () => Promise<T>,
  deps: ReplayDeps,
): Promise<ReplayResult<T>> {
  const cacheKey = await computeCacheKey(envelope);

  if (deps.mode === "off") {
    const response = await callProvider();
    return { response, status: "off", cacheKey };
  }

  const hit = await deps.lookup(cacheKey);
  if (hit !== null) {
    return { response: hit.response as T, status: "hit", cacheKey };
  }

  if (deps.mode === "replay_strict") {
    throw new ReplayMissError(cacheKey, envelope.operation);
  }

  const response = await callProvider();
  await deps.store({
    cacheKey,
    operation: envelope.operation,
    provider: envelope.provider,
    model: envelope.model,
    promptVersion: envelope.promptVersion,
    requestEnvelope: envelope,
    response,
  });
  return { response, status: "miss", cacheKey };
}
