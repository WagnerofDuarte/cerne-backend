// T-037 — Geração de embedding com fallback (Plano técnico §8.2 passo 6,
// D8).
//
// "Sucesso -> ready. Falha -> failed, mas a entrada permanece" — este
// módulo nunca lança: uma falha da Voyage vira um resultado com
// `status: 'failed'`, nunca uma exceção. Perder a entrada do usuário
// porque a Voyage caiu está na lista de armadilhas a evitar (Seção 14:
// "Falhar POST /entries quando o embedding falha").

import {
  embed,
  VOYAGE_MODEL,
  VOYAGE_OUTPUT_DIMENSION,
  type VoyageEnv,
} from "../_shared/ai/voyage.ts";
import { buildEmbeddingEnvelope, type ReplayDeps } from "../_shared/replay.ts";

export type EmbeddingResult =
  | {
    readonly status: "ready";
    readonly embedding: readonly number[];
    readonly model: string;
    readonly dimension: number;
    readonly inputType: "document";
  }
  | { readonly status: "failed" };

/** `inputType` sempre `'document'` aqui — "documento ao salvar, consulta ao buscar" (D8); a busca (T-040) usa `'query'`, fora deste módulo. */
export async function generateEntryEmbedding(
  text: string,
  promptVersion: string,
  deps: VoyageEnv & { replay: ReplayDeps },
): Promise<EmbeddingResult> {
  const envelope = buildEmbeddingEnvelope({
    provider: "voyage",
    model: VOYAGE_MODEL,
    promptVersion,
    text,
    inputType: "document",
  });

  try {
    const result = await embed(
      envelope,
      {
        model: VOYAGE_MODEL,
        text,
        inputType: "document",
        outputDimension: VOYAGE_OUTPUT_DIMENSION,
      },
      deps,
    );
    return {
      status: "ready",
      embedding: result.response.embedding,
      model: VOYAGE_MODEL,
      dimension: VOYAGE_OUTPUT_DIMENSION,
      inputType: "document",
    };
  } catch {
    // Motivo do erro deliberadamente não propagado — o handler não expõe
    // detalhe de falha da Voyage na resposta (a entrada é gravada com
    // sucesso mesmo assim; `embeddingStatus: 'failed'` já é o sinal).
    return { status: "failed" };
  }
}
