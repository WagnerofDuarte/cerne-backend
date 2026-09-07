// T-032 — Cliente `ai/anthropic` (Plano técnico §7): "Cliente Sonnet 5 e
// Haiku 4.5, sempre atrás do cache."
//
// Este módulo é deliberadamente genérico — não sabe se está servindo
// detecção de PII (T-036, Fase 3), geração de insight (T-050, Fase 4) ou
// chat (T-046, Fase 4). Quem monta o `envelope` (via os builders de
// `replay.ts`, T-030) e o `request` (mensagens, prompt de sistema,
// ferramentas) é o módulo de negócio de cada operação — nunca esta camada.
// A única garantia que este módulo dá é estrutural: a chamada real à
// Anthropic *nunca* acontece fora de `withReplay`.

import {
  type CanonicalEnvelope,
  type ReplayDeps,
  type ReplayResult,
  withReplay,
} from "../replay.ts";

/** Os dois modelos que este cliente atende (§7) — nenhum outro é aceito por convenção do projeto. */
export const ANTHROPIC_MODELS = {
  sonnet5: "claude-sonnet-5",
  haiku45: "claude-haiku-4-5-20251001",
} as const;

/** Bloco de conteúdo multimodal (T-041, OCR via visão) — mesmo formato da Messages API. */
export interface AnthropicTextContent {
  readonly type: "text";
  readonly text: string;
}

export interface AnthropicImageContent {
  readonly type: "image";
  readonly source: {
    readonly type: "base64";
    readonly media_type: string;
    readonly data: string;
  };
}

export type AnthropicContentInput = AnthropicTextContent | AnthropicImageContent;

export interface AnthropicMessage {
  readonly role: "user" | "assistant";
  /** String para texto puro (chat, PII) — array de blocos para conteúdo multimodal (OCR, T-041). */
  readonly content: string | readonly AnthropicContentInput[];
}

export interface AnthropicRequest {
  readonly model: string;
  readonly system?: string;
  readonly messages: readonly AnthropicMessage[];
  readonly maxTokens: number;
  /** Definição de ferramenta no formato da Messages API — usado pela detecção de PII (tool use). */
  readonly tools?: readonly unknown[];
  readonly toolChoice?: unknown;
}

export interface AnthropicContentBlock {
  readonly type: string;
  readonly text?: string;
  readonly id?: string;
  readonly name?: string;
  readonly input?: unknown;
}

export interface AnthropicResponse {
  readonly id: string;
  readonly model: string;
  readonly content: readonly AnthropicContentBlock[];
  readonly stopReason: string | null;
}

/**
 * A Anthropic respondeu algo que não é 2xx, ou um corpo que não parece a
 * Messages API. Deliberadamente não é um `CerneError`: qual dos 13
 * códigos isso vira (`PII_CHECK_FAILED`, `AI_GENERATION_TIMEOUT`, ...)
 * depende de qual operação estava chamando — decisão do módulo de
 * negócio (Fase 3/4), não deste cliente genérico.
 */
export class AnthropicApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown) {
    super(`Anthropic API respondeu ${status}`);
    this.name = "AnthropicApiError";
    this.status = status;
    this.body = body;
  }
}

export interface AnthropicEnv {
  readonly anthropicApiKey: string;
  /** Injetável para teste — produção usa `fetch` de verdade. */
  readonly fetchImpl?: typeof fetch;
}

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/**
 * `fetch` não tem timeout próprio — sem um `signal`, uma chamada que trava
 * na rede (DNS, egress bloqueado, conexão que nunca fecha) nunca falha
 * sozinha; ela fica pendurada até o teto externo do runtime matar o
 * isolate inteiro. No `supabase functions serve` local isso aparece nos
 * logs como "wall clock duration warning" seguido de "early termination
 * has been triggered" — não um erro do envelope do projeto (§3.2), e sim
 * o motor de Edge Functions abortando à força. Achado rodando de verdade
 * (`media_ocr.hurl`, T-041): as sub-requisições que nunca chegam a chamar
 * a Anthropic (401 sem token, 413 de imagem grande demais) respondem na
 * hora; só as duas que chegam aqui (imagem ilegível, caminho feliz)
 * travavam. Com o `signal`, uma chamada presa falha em
 * `ANTHROPIC_REQUEST_TIMEOUT_MS` com um erro normal — o `catch` de
 * `performOcr` (media-ocr/ocr.ts) já converte isso em
 * `AI_GENERATION_TIMEOUT`.
 */
export const ANTHROPIC_REQUEST_TIMEOUT_MS = 30_000;

async function callAnthropicRaw(
  request: AnthropicRequest,
  env: AnthropicEnv,
): Promise<AnthropicResponse> {
  const fetchFn = env.fetchImpl ?? fetch;
  const res = await fetchFn(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.anthropicApiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: request.model,
      system: request.system,
      messages: request.messages,
      max_tokens: request.maxTokens,
      tools: request.tools,
      tool_choice: request.toolChoice,
    }),
    signal: AbortSignal.timeout(ANTHROPIC_REQUEST_TIMEOUT_MS),
  });

  const body = await res.json();
  if (!res.ok) throw new AnthropicApiError(res.status, body);

  return {
    id: body.id,
    model: body.model,
    content: Array.isArray(body.content) ? body.content : [],
    stopReason: body.stop_reason ?? null,
  };
}

/**
 * Chama Sonnet 5/Haiku 4.5 atrás do cache de replay. Em `REPLAY_MODE`
 * `record`/`replay`, uma segunda chamada com o mesmo `envelope` nunca
 * bate na rede — devolve `status: 'hit'` a partir do cache.
 */
export function callAnthropic(
  envelope: CanonicalEnvelope,
  request: AnthropicRequest,
  deps: AnthropicEnv & { replay: ReplayDeps },
): Promise<ReplayResult<AnthropicResponse>> {
  return withReplay(envelope, () => callAnthropicRaw(request, deps), deps.replay);
}
