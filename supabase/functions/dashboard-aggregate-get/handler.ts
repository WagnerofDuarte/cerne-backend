// T-056 — GET /dashboard/aggregate (Plano técnico §8.5).
//
// "Sempre 200, inclusive com zero entradas (buckets: [])" — nenhum
// caminho deste handler lança por falta de dado, só por falha real de
// banco (o que já vira 500 genérico no gateway, fora da taxonomia de 13).

import type { EntrySource } from "../_shared/entries-repo.ts";
import {
  type AggregateCountRow,
  type DashboardPeriod,
  fetchAggregateCounts,
  periodStartFor,
} from "../_shared/dashboard-repo.ts";
import type { GatewayContext, HandlerResult } from "../_shared/gateway.ts";
import { fetchServerRevision } from "../_shared/profiles-repo.ts";
import { buildDataEnvelope } from "../_shared/serialize.ts";

export interface DashboardAggregateQuery {
  readonly period: DashboardPeriod;
}

const SOURCES: readonly EntrySource[] = ["manual", "audio", "photo", "chat"];

function emptySourceCounts(): Record<EntrySource, number> {
  return { manual: 0, audio: 0, photo: 0, chat: 0 };
}

function buildBuckets(rows: readonly AggregateCountRow[]) {
  const byDate = new Map<string, Record<EntrySource, number>>();
  for (const row of rows) {
    const counts = byDate.get(row.bucket_date) ?? emptySourceCounts();
    counts[row.source] = row.entry_count;
    byDate.set(row.bucket_date, counts);
  }

  // `fetchAggregateCounts` já devolve as linhas ordenadas por data ASC
  // (RPC, migração 0015) — `Map` preserva a ordem de inserção, então não
  // precisa reordenar aqui.
  const buckets = Array.from(byDate.entries()).map(([date, sources]) => ({
    date,
    count: SOURCES.reduce((sum, s) => sum + sources[s], 0),
    sources,
  }));

  const totals = buckets.reduce(
    (acc, bucket) => {
      acc.count += bucket.count;
      for (const s of SOURCES) acc.sources[s] += bucket.sources[s];
      return acc;
    },
    { count: 0, sources: emptySourceCounts() },
  );

  return { buckets, totals };
}

export async function handleGetDashboardAggregate(
  ctx: GatewayContext<undefined, DashboardAggregateQuery>,
): Promise<HandlerResult> {
  const auth = ctx.auth!; // contract.auth === true
  const periodStart = periodStartFor(ctx.query.period, ctx.now);

  const [rows, serverRevision] = await Promise.all([
    fetchAggregateCounts(auth.db, { periodStart, periodEnd: null }),
    fetchServerRevision(auth.db, auth.userId),
  ]);

  const { buckets, totals } = buildBuckets(rows);

  return {
    status: 200,
    envelope: buildDataEnvelope({ buckets, totals }),
    headers: { "X-Data-Version": String(serverRevision) },
  };
}
