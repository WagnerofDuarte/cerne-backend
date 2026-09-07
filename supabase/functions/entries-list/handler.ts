// T-038 — GET /entries (Plano técnico §8.2).
//
// Paginação por cursor (keyset, não OFFSET), filtros combinados com AND
// (source/dateFrom/dateTo), **tags embutidas** (evita N+1 — a consulta em
// `entries-repo.ts` já traz `tags[]` via join), ordenação
// `occurred_at DESC, id ASC`, header `X-Data-Version` derivado de
// `profiles.server_revision`.

import { listEntries } from "../_shared/entries-repo.ts";
import type { GatewayContext, HandlerResult } from "../_shared/gateway.ts";
import { fetchServerRevision } from "../_shared/profiles-repo.ts";
import { buildDataEnvelope } from "../_shared/serialize.ts";
import { decodeCursor, encodeCursor } from "./cursor.ts";

export interface ListEntriesQuery {
  readonly cursor?: string;
  readonly limit?: number;
  readonly source?: "manual" | "audio" | "photo" | "chat";
  readonly dateFrom?: string;
  readonly dateTo?: string;
}

const DEFAULT_LIMIT = 20;

export async function handleListEntries(
  ctx: GatewayContext<undefined, ListEntriesQuery>,
): Promise<HandlerResult> {
  const auth = ctx.auth!; // contract.auth === true
  const limit = ctx.query.limit ?? DEFAULT_LIMIT;
  const cursor = ctx.query.cursor ? decodeCursor(ctx.query.cursor) : null;

  const { rows, total } = await listEntries(auth.db, {
    userId: auth.userId,
    limit,
    cursor,
    source: ctx.query.source,
    dateFrom: ctx.query.dateFrom,
    dateTo: ctx.query.dateTo,
  });

  // `listEntries` busca `limit + 1` de propósito — se veio a mais, há
  // próxima página; o cursor é a posição da última linha que FICA nesta
  // página (não a extra, que só serve para detectar "tem mais").
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && lastRow
    ? encodeCursor({ occurredAt: lastRow.occurred_at as string, id: lastRow.id as string })
    : null;

  const serverRevision = await fetchServerRevision(auth.db, auth.userId);
  // `serverRevision` é campo de todo `Entry` (§8.2) mas não é coluna de
  // `entries` (ver nota em profiles-repo.ts) — o mesmo valor do perfil
  // entra em cada item da página.
  const pageRowsWithRevision = pageRows.map((row) => ({ ...row, server_revision: serverRevision }));

  return {
    status: 200,
    envelope: buildDataEnvelope(pageRowsWithRevision, { nextCursor, total }),
    headers: { "X-Data-Version": String(serverRevision) },
  };
}
