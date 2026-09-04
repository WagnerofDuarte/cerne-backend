// T-040 — GET /entries/search (Plano técnico §8.2).
//
// Dois modos:
//   - `q` ausente/vazio -> só filtros, meta.mode='filter_only', NUNCA
//     chama a Voyage (§8.2, literal)
//   - `q` presente -> embedding da consulta (input_type='query', D8),
//     varredura exata por distância de cosseno (RPC da migração 0011),
//     meta.mode='semantic', `similarity` por item
// Filtros (source/dateFrom/dateTo) combinam com AND nos dois modos. Sem
// throttle no servidor — o debounce de 300ms é responsabilidade do app.

import { embed, VOYAGE_MODEL, VOYAGE_OUTPUT_DIMENSION } from "../_shared/ai/voyage.ts";
import { type AiEnv, buildReplayDeps } from "../_shared/deps.ts";
import {
  type EntrySource,
  findEntriesByFilters,
  searchEntriesByEmbedding,
} from "../_shared/entries-repo.ts";
import { throwError } from "../_shared/errors.ts";
import type { GatewayContext, HandlerResult } from "../_shared/gateway.ts";
import { fetchServerRevision } from "../_shared/profiles-repo.ts";
import { buildEmbeddingEnvelope } from "../_shared/replay.ts";
import { buildDataEnvelope } from "../_shared/serialize.ts";

export interface SearchEntriesQuery {
  readonly q?: string;
  readonly source?: EntrySource;
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly limit?: number;
}

const DEFAULT_LIMIT = 20;

export async function handleSearchEntries(
  ctx: GatewayContext<undefined, SearchEntriesQuery>,
  env: AiEnv,
): Promise<HandlerResult> {
  const auth = ctx.auth!; // contract.auth === true
  const limit = ctx.query.limit ?? DEFAULT_LIMIT;
  const { q, source, dateFrom, dateTo } = ctx.query;

  const serverRevisionPromise = fetchServerRevision(auth.db, auth.userId);

  if (!q) {
    // filter_only — "sem chamar Voyage" (§8.2, literal).
    const rows = await findEntriesByFilters(auth.db, {
      userId: auth.userId,
      limit,
      source,
      dateFrom,
      dateTo,
    });
    const serverRevision = await serverRevisionPromise;
    const data = rows.map((row) => ({ ...row, server_revision: serverRevision }));
    return { status: 200, envelope: buildDataEnvelope(data, { mode: "filter_only" }) };
  }

  // semantic — embedding da consulta (input_type='query', D8), varredura
  // exata por cosseno via RPC (filtros aplicados no WHERE antes do
  // ranqueamento, dentro da própria função — migração 0011).
  const envelope = buildEmbeddingEnvelope({
    provider: "voyage",
    model: VOYAGE_MODEL,
    promptVersion: env.promptVersion,
    text: q,
    inputType: "query",
  });
  const replay = buildReplayDeps(auth.db, env.replayMode);

  let queryEmbedding: readonly number[];
  try {
    const result = await embed(
      envelope,
      {
        model: VOYAGE_MODEL,
        text: q,
        inputType: "query",
        outputDimension: VOYAGE_OUTPUT_DIMENSION,
      },
      { voyageApiKey: env.voyageApiKey, fetchImpl: env.fetchImpl, replay },
    );
    queryEmbedding = result.response.embedding;
  } catch (err) {
    throwError("EMBEDDING_FAILED", "não foi possível gerar o embedding da busca", { cause: err });
  }

  const rows = await searchEntriesByEmbedding(auth.db, {
    queryEmbedding,
    limit,
    source,
    dateFrom,
    dateTo,
  });
  const serverRevision = await serverRevisionPromise;
  const data = rows.map(({ distance, ...row }) => ({
    ...row,
    server_revision: serverRevision,
    // pgvector `<=>` = distância de cosseno (0 = idêntico); similarity é o
    // complemento, mesma leitura já validada em scripts/prove-rf06.ts (T-024).
    similarity: 1 - distance,
  }));

  return { status: 200, envelope: buildDataEnvelope(data, { mode: "semantic" }) };
}
