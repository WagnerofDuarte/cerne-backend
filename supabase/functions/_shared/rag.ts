// T-043 — Módulo `rag` (Plano técnico §8.3, passo 2): "Gerar embedding da
// pergunta e executar RAG (top 5, ordenação determinística)".
//
// Reaproveita o mesmo mecanismo já validado em T-040 (`GET
// /entries/search`, modo semantic): embedding da pergunta atrás do cache
// de replay (`input_type='query'`, D8) + a RPC `entries_search_by_embedding`
// (migração 0011) — varredura exata, sem índice aproximado (regra nº7),
// desempate por `id ASC`. Este módulo só amarra os dois com `limit=5` e
// sem filtros de `source`/data — o RAG não é uma busca do usuário, é
// contexto para o chat.
//
// Decisão confirmada com o Wagner em 07/09/2026 (registrada em
// big-plan.md, Fase 4): entradas com `pii_status='flagged'` ENTRAM no
// RAG — mesmo comportamento que a RPC já tem hoje (D3, conteúdo original
// nunca censurado, nem para o próprio dono).
//
// Determinismo (critério de conclusão: "mesma pergunta produz sempre os
// mesmos retrievedEntryIds, na mesma ordem") vem inteiro de peças já
// existentes: mesmo modelo de embedding fixado (D8), varredura exata e
// `id ASC` como desempate (já garantidos pela RPC).

import { embed, VOYAGE_MODEL, VOYAGE_OUTPUT_DIMENSION } from "./ai/voyage.ts";
import type { DbClient } from "./db.ts";
import { searchEntriesByEmbedding } from "./entries-repo.ts";
import { throwError } from "./errors.ts";
import { buildEmbeddingEnvelope, type ReplayDeps } from "./replay.ts";

/** "top 5" (§8.3, passo 2) — congelado; mudar isso muda a impressão digital do chat, não é uma opção de configuração. */
export const RAG_TOP_K = 5;

export interface RetrievedEntry {
  readonly id: string;
  readonly content: string;
}

export interface RunRagArgs {
  readonly db: DbClient;
  readonly userMessage: string;
  readonly promptVersion: string;
  readonly voyageApiKey: string;
  /** Injetável para teste — produção usa `fetch` de verdade. */
  readonly fetchImpl?: typeof fetch;
  readonly replay: ReplayDeps;
}

export interface RagResult {
  /** Ordenadas por relevância (distância ASC, `id ASC` no empate — mesma ordem que a RPC já devolve). Esta é a ordem usada no evento SSE `context` (T-044); `buildChatEnvelope` (replay.ts) reordena uma cópia alfabeticamente só para fins de `cache_key`, sem afetar esta lista. */
  readonly retrievedEntries: readonly RetrievedEntry[];
}

/**
 * Executa o RAG para uma pergunta de chat. Lança `EMBEDDING_FAILED` (502,
 * retryable) se a Voyage falhar — mesma conversão já usada em
 * `GET /entries/search` (T-040) para o mesmo tipo de falha. Isso acontece
 * antes de qualquer evento SSE ser emitido (passo 2, antes do passo 3
 * criar a mensagem do assistente) — o handler de `T-046` ainda está numa
 * fase síncrona da requisição, então uma resposta de erro HTTP comum
 * (não um evento `error` dentro do stream) é a forma correta de reportar
 * isso.
 */
export async function runRag(args: RunRagArgs): Promise<RagResult> {
  const envelope = buildEmbeddingEnvelope({
    provider: "voyage",
    model: VOYAGE_MODEL,
    promptVersion: args.promptVersion,
    text: args.userMessage,
    inputType: "query",
  });

  let queryEmbedding: readonly number[];
  try {
    const result = await embed(
      envelope,
      {
        model: VOYAGE_MODEL,
        text: args.userMessage,
        inputType: "query",
        outputDimension: VOYAGE_OUTPUT_DIMENSION,
      },
      { voyageApiKey: args.voyageApiKey, fetchImpl: args.fetchImpl, replay: args.replay },
    );
    queryEmbedding = result.response.embedding;
  } catch (err) {
    throwError("EMBEDDING_FAILED", "não foi possível gerar o embedding do RAG", { cause: err });
  }

  const rows = await searchEntriesByEmbedding(args.db, {
    queryEmbedding,
    limit: RAG_TOP_K,
  });

  return {
    retrievedEntries: rows.map((row) => ({ id: row.id, content: row.content })),
  };
}
