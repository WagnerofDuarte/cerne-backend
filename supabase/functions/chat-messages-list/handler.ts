// T-045 — GET /chat/sessions/:id/messages (Plano técnico §8.3):
// "ordenação seq ASC."
//
// Mesma leitura de D7 já usada em `entries-get` (T-039): sessão
// inexistente e sessão de outro usuário produzem exatamente a mesma
// resposta (404 NOT_FOUND), nunca 403 — não revela se o recurso existe.

import { findChatSessionById, listChatMessages } from "../_shared/chat-repo.ts";
import { throwError } from "../_shared/errors.ts";
import type { GatewayContext, HandlerResult } from "../_shared/gateway.ts";
import { buildDataEnvelope } from "../_shared/serialize.ts";

// Mesmo raciocínio de `entries-get` (T-039): um `id` que não é sequer um
// uuid não pode ser de ninguém — tratado como "não encontrado" direto,
// sem consultar o banco (evita um erro de sintaxe do Postgres vazando
// como 500 por causa de um `:id` mal formado na URL).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleListChatMessages(ctx: GatewayContext): Promise<HandlerResult> {
  const auth = ctx.auth!; // contract.auth === true
  const sessionId = ctx.params.id;

  if (!sessionId || !UUID_RE.test(sessionId)) {
    throwError("NOT_FOUND", "sessão de chat não encontrada");
  }

  const session = await findChatSessionById(auth.db, { userId: auth.userId, sessionId });
  if (!session) throwError("NOT_FOUND", "sessão de chat não encontrada");

  const rows = await listChatMessages(auth.db, { sessionId: session.id });
  return { status: 200, envelope: buildDataEnvelope(rows) };
}
