// T-045 — GET /chat/sessions (Plano técnico §8.3): "lista com cursor,
// limit. Ordenação updated_at DESC, id ASC."

import { listChatSessions } from "../_shared/chat-repo.ts";
import type { GatewayContext, HandlerResult } from "../_shared/gateway.ts";
import { buildDataEnvelope } from "../_shared/serialize.ts";
import { decodeCursor, encodeCursor } from "./cursor.ts";

export interface ListChatSessionsQuery {
  readonly cursor?: string;
  readonly limit?: number;
}

const DEFAULT_LIMIT = 20;

export async function handleListChatSessions(
  ctx: GatewayContext<undefined, ListChatSessionsQuery>,
): Promise<HandlerResult> {
  const auth = ctx.auth!; // contract.auth === true
  const limit = ctx.query.limit ?? DEFAULT_LIMIT;
  const cursor = ctx.query.cursor ? decodeCursor(ctx.query.cursor) : null;

  const rows = await listChatSessions(auth.db, { userId: auth.userId, limit, cursor });

  // Mesmo truque de `listEntries`/`entries-list`: busca `limit + 1` de
  // propósito — se veio a mais, há próxima página.
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && lastRow
    ? encodeCursor({ updatedAt: lastRow.updated_at, id: lastRow.id })
    : null;

  return { status: 200, envelope: buildDataEnvelope(pageRows, { nextCursor }) };
}
