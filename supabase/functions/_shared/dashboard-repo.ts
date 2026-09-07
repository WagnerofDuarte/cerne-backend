// Módulo `dashboard-repo` — gap-fill da Fase 5, compartilhado por
// `dashboard-aggregate-get` (T-056) e `dashboard-narrative-get` (T-057).

import type { DbClient } from "./db.ts";
import type { EntrySource } from "./entries-repo.ts";

// --- Período (compartilhado por T-056 e T-057) -----------------------------

export type DashboardPeriod = "7d" | "30d" | "90d" | "all";

const PERIOD_DAYS: Record<Exclude<DashboardPeriod, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/** `null` para `all` (sem limite inferior). Usa `now` (respeitando `X-Test-Now`, `clock.ts`) em vez de `new Date()` direto — determinismo do roteiro de validação (T-060). */
export function periodStartFor(period: DashboardPeriod, now: Date): string | null {
  if (period === "all") return null;
  const days = PERIOD_DAYS[period];
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

// --- T-056: GET /dashboard/aggregate ---------------------------------------

export interface AggregateCountRow {
  readonly bucket_date: string;
  readonly source: EntrySource;
  readonly entry_count: number;
}

/** RPC `dashboard_aggregate_counts` (migração 0015) — `SECURITY INVOKER`, RLS de `entries` continua valendo, sem `user_id` como parâmetro (mesma postura de `entries_search_by_embedding`, T-040). */
export async function fetchAggregateCounts(
  db: DbClient,
  args: { periodStart: string | null; periodEnd: string | null },
): Promise<AggregateCountRow[]> {
  const { data, error } = await db.rpc("dashboard_aggregate_counts", {
    p_period_start: args.periodStart,
    p_period_end: args.periodEnd,
  });
  if (error) throw error;
  return (data ?? []) as AggregateCountRow[];
}

// --- T-057: GET /dashboard/narrative ----------------------------------------

/** Generoso o bastante para uma narrativa de balanço cobrir um período de 90 entradas sem estourar o prompt — nenhum documento-fonte fixa um teto aqui (mesma natureza pragmática de `CHAT_MAX_TOKENS`/`INSIGHT_MAX_TOKENS`, Fase 4). */
const MAX_ENTRIES_FOR_NARRATIVE = 100;

export interface NarrativeEntryRow {
  readonly id: string;
  readonly content: string;
}

/** Entradas do período, mais recentes primeiro, limitadas a `MAX_ENTRIES_FOR_NARRATIVE` — RLS do usuário autenticado continua valendo (cliente comum, nunca `service_role`). Desempate por `id ASC` (regra nº6). */
export async function fetchEntriesForNarrative(
  db: DbClient,
  args: { periodStart: string | null; periodEnd: string | null },
): Promise<NarrativeEntryRow[]> {
  let query = db.from("entries").select("id, content, occurred_at");
  if (args.periodStart) query = query.gte("occurred_at", args.periodStart);
  if (args.periodEnd) query = query.lt("occurred_at", args.periodEnd);

  const { data, error } = await query
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(MAX_ENTRIES_FOR_NARRATIVE);
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string; content: string }>).map(({ id, content }) => ({
    id,
    content,
  }));
}
