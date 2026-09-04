// T-035 — POST /entries (Plano técnico §8.2, RF01, RF10/D4).
//
// Sequência obrigatória, ao pé da letra:
//   1. Validar (já feito pelo gateway via Zod, contrato T-026)
//   2. Se chatMessageId presente, checar idempotência (RF10/D4)
//   3. Conflito -> 200 com a entrada existente, meta.idempotentReplay=true. Encerra.
//   4. PII via Haiku (T-036) — falha -> PII_CHECK_FAILED, nada é gravado
//   5. Gravar com embedding_status='pending'
//   6. Embedding via Voyage (T-037) — falha -> 'failed', entrada permanece
//   7. Retornar 200
//
// Nuance registrada em big-plan.md (não reaberta aqui, só documentada): o
// passo 2/3 é uma checagem OTIMISTA (SELECT) para economizar uma chamada
// cara ao Haiku no caso comum de retry — não é ela quem garante D4. A
// garantia de verdade ("pelo banco, não pelo código") é o índice único em
// `insertEntry` (entries-repo.ts): se uma corrida acontecer entre esta
// checagem e a gravação real, a segunda requisição ainda assim recebe de
// volta a linha vencedora, nunca um erro nem uma duplicata.

import type { DbClient } from "../_shared/db.ts";
import { type AiEnv, buildReplayDeps } from "../_shared/deps.ts";
import {
  findEntryByChatMessageId,
  insertEntry,
  markEmbeddingFailed,
  markEmbeddingReady,
} from "../_shared/entries-repo.ts";
import type { GatewayContext, HandlerResult } from "../_shared/gateway.ts";
import { fetchServerRevision } from "../_shared/profiles-repo.ts";
import { buildDataEnvelope } from "../_shared/serialize.ts";
import { generateEntryEmbedding } from "./embedding.ts";
import { detectPii } from "./pii.ts";

export interface CreateEntryBody {
  readonly content: string;
  readonly source: "manual" | "audio" | "photo" | "chat";
  readonly chatMessageId?: string;
  readonly occurredAt?: string;
  readonly mediaDurationSeconds?: number;
}

export async function handleCreateEntry(
  ctx: GatewayContext<CreateEntryBody>,
  env: AiEnv,
): Promise<HandlerResult> {
  const auth = ctx.auth!; // contract.auth === true — gateway garante isto antes do handler rodar.
  const { content, source, chatMessageId, occurredAt, mediaDurationSeconds } = ctx.body;
  const replay = buildReplayDeps(auth.db, env.replayMode);

  // Passos 2/3 — checagem otimista de idempotência (RF10/D4).
  if (chatMessageId) {
    const existing = await findEntryByChatMessageId(auth.db, auth.userId, chatMessageId);
    if (existing) return okResponse(existing, auth.db, auth.userId, true);
  }

  // Passo 4 — PII (T-036). Lança PII_CHECK_FAILED se falhar; nada é gravado.
  const pii = await detectPii(content, env.promptVersion, {
    anthropicApiKey: env.anthropicApiKey,
    fetchImpl: env.fetchImpl,
    replay,
  });

  // Passo 5 — gravar (embedding_status inicia 'pending' dentro de insertEntry).
  const inserted = await insertEntry(auth.db, {
    userId: auth.userId,
    content,
    source,
    chatMessageId: chatMessageId ?? null,
    occurredAt,
    mediaDurationSeconds: mediaDurationSeconds ?? null,
    piiStatus: pii.status,
    piiSpans: pii.spans,
  });

  // Corrida real: outra requisição idêntica venceu entre a checagem
  // otimista (passo 2) e esta gravação. O trabalho de PII feito acima é
  // descartado sem nunca ser gravado — a linha vencedora é a fonte da
  // verdade, exatamente como se essa checagem tivesse pego o conflito.
  if (inserted.idempotentReplay) {
    return okResponse(inserted.entry, auth.db, auth.userId, true);
  }

  // Passo 6 — embedding (T-037), nunca derruba a entrada já gravada.
  const entryId = inserted.entry.id as string;
  const embedding = await generateEntryEmbedding(content, env.promptVersion, {
    voyageApiKey: env.voyageApiKey,
    fetchImpl: env.fetchImpl,
    replay,
  });

  const finalEntry = embedding.status === "ready"
    ? await markEmbeddingReady(auth.db, entryId, {
      embedding: embedding.embedding,
      model: embedding.model,
      dimension: embedding.dimension,
      inputType: embedding.inputType,
    })
    : await markEmbeddingFailed(auth.db, entryId);

  return okResponse(finalEntry, auth.db, auth.userId, false);
}

async function okResponse(
  entry: Record<string, unknown>,
  db: DbClient,
  userId: string,
  idempotentReplay: boolean,
): Promise<HandlerResult> {
  const serverRevision = await fetchServerRevision(db, userId);
  const meta = idempotentReplay ? { idempotentReplay: true } : {};
  return {
    status: 200,
    envelope: buildDataEnvelope({ ...entry, server_revision: serverRevision }, meta),
  };
}
