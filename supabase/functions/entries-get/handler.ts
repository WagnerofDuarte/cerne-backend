// T-039 — GET /entries/:id (Plano técnico §8.2, D7).
//
// "Se não existir ou for de outro usuário: 404 NOT_FOUND" — `findEntryById`
// já filtra por `user_id` (RLS reforça isso de qualquer forma, mas o
// filtro explícito evita depender só dela), então as duas causas (não
// existe / é de outro usuário) produzem exatamente o mesmo resultado aqui:
// nenhuma linha. Nunca 403 (D7 — vazaria a existência do recurso alheio).

import { findEntryById } from "../_shared/entries-repo.ts";
import { throwError } from "../_shared/errors.ts";
import type { GatewayContext, HandlerResult } from "../_shared/gateway.ts";
import { fetchServerRevision } from "../_shared/profiles-repo.ts";
import { buildDataEnvelope } from "../_shared/serialize.ts";

// Um `id` que não é sequer um uuid não pode ser de ninguém — tratado igual
// a "não encontrado" (mesma resposta 404, nunca um erro de sintaxe do
// banco vazando como 500).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleGetEntry(ctx: GatewayContext): Promise<HandlerResult> {
  const auth = ctx.auth!; // contract.auth === true
  const entryId = ctx.params.id;

  if (!entryId || !UUID_RE.test(entryId)) {
    throwError("NOT_FOUND", "entrada não encontrada");
  }

  const entry = await findEntryById(auth.db, auth.userId, entryId);
  if (!entry) throwError("NOT_FOUND", "entrada não encontrada");

  const serverRevision = await fetchServerRevision(auth.db, auth.userId);
  return {
    status: 200,
    envelope: buildDataEnvelope({ ...entry, server_revision: serverRevision }),
  };
}
