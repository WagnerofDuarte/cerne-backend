// T-032 — Cliente `ai/voyage` (Plano técnico §7): "Cliente de embeddings,
// sempre atrás do cache." Mesma postura do `ai/anthropic.ts`: genérico,
// nunca decide taxonomia de erro (isso é `EMBEDDING_FAILED`, decidido por
// quem chama — `POST /entries`, T-037, Fase 3), só garante que a chamada
// real à Voyage nunca acontece fora de `withReplay`.

import {
  type CanonicalEnvelope,
  type ReplayDeps,
  type ReplayResult,
  withReplay,
} from "../replay.ts";

/** D8: modelo e dimensão fixados — qualquer troca é uma decisão fora deste módulo, nunca implícita aqui. */
export const VOYAGE_MODEL = "voyage-4";
export const VOYAGE_OUTPUT_DIMENSION = 1024;

export interface VoyageRequest {
  readonly model: string;
  readonly text: string;
  /** "documento" ao salvar, "consulta" ao buscar (D8). */
  readonly inputType: "document" | "query";
  readonly outputDimension: number;
}

export interface VoyageResponse {
  readonly embedding: readonly number[];
}

/**
 * A Voyage respondeu algo que não é 2xx, ou um corpo sem o embedding
 * esperado. Não é `CerneError` pelo mesmo motivo do `AnthropicApiError` —
 * a conversão para `EMBEDDING_FAILED` é decisão de quem chama.
 */
export class VoyageApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `Voyage API respondeu ${status}`);
    this.name = "VoyageApiError";
    this.status = status;
    this.body = body;
  }
}

export interface VoyageEnv {
  readonly voyageApiKey: string;
  /** Injetável para teste — produção usa `fetch` de verdade. */
  readonly fetchImpl?: typeof fetch;
}

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";

/** Mesmo raciocínio do `ANTHROPIC_REQUEST_TIMEOUT_MS` (ai/anthropic.ts) — ver o comentário lá.
 * Aqui importa ainda mais: `entries-create/embedding.ts` conta com uma falha *rápida* da Voyage
 * para cair no fallback `status: 'failed'` (D8, "falha -> failed, mas a entrada permanece") sem
 * segurar `POST /entries` até o teto externo do runtime. */
export const VOYAGE_REQUEST_TIMEOUT_MS = 30_000;

async function callVoyageRaw(request: VoyageRequest, env: VoyageEnv): Promise<VoyageResponse> {
  const fetchFn = env.fetchImpl ?? fetch;
  const res = await fetchFn(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.voyageApiKey}`,
    },
    body: JSON.stringify({
      input: [request.text],
      model: request.model,
      input_type: request.inputType,
      output_dimension: request.outputDimension,
    }),
    signal: AbortSignal.timeout(VOYAGE_REQUEST_TIMEOUT_MS),
  });

  const body = await res.json();
  if (!res.ok) throw new VoyageApiError(res.status, body);

  const embedding = body?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length !== request.outputDimension) {
    throw new VoyageApiError(
      res.status,
      body,
      `resposta da Voyage não tem ${request.outputDimension} floats`,
    );
  }

  return { embedding };
}

/**
 * Gera o embedding atrás do cache de replay. Em `record`/`replay`, uma
 * segunda chamada com o mesmo `envelope` (mesmo texto + inputType) nunca
 * bate na rede — devolve `status: 'hit'`.
 */
export function embed(
  envelope: CanonicalEnvelope,
  request: VoyageRequest,
  deps: VoyageEnv & { replay: ReplayDeps },
): Promise<ReplayResult<VoyageResponse>> {
  return withReplay(envelope, () => callVoyageRaw(request, deps), deps.replay);
}
