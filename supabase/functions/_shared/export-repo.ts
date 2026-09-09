// Módulo `export-repo` — gap-fill da Fase 5, mesmo espírito de
// `entries-repo.ts`/`profiles-repo.ts`: leitura/escrita de `export_jobs` e
// das `entries` que alimentam uma exportação, compartilhada por
// `export-summary-create` (T-053), `export-status-get`/`export-download-get`
// (T-055) e `export-worker` (T-054).
//
// Duas metades bem distintas neste arquivo, nunca confundidas:
//   - Funções "de app" (recebem `DbClient`, o cliente com o JWT do
//     usuário — `_shared/db.ts`) — RLS de `export_jobs`/`entries` (Fase 1)
//     continua valendo por baixo, então nunca filtram `user_id` "na mão".
//   - Funções "de worker" (recebem `SupabaseClient` de `_shared/
//     worker-db.ts`, `service_role`) — ignoram RLS, por isso SEMPRE
//     filtram `user_id` explicitamente (o worker atende jobs de usuários
//     arbitrários, um de cada vez, nunca "todos os usuários").

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbClient } from "./db.ts";

export type ExportJobStatus = "pending" | "processing" | "data_ready" | "done" | "error";
export type ExportNarrativeStatus = "pending" | "processing" | "done" | "failed" | "skipped";

export interface ExportJobRow {
  readonly id: string;
  readonly user_id: string;
  readonly period_start: string | null;
  readonly period_end: string | null;
  readonly status: ExportJobStatus;
  readonly narrative_status: ExportNarrativeStatus;
  readonly entry_count: number | null;
  readonly raw_file_path: string | null;
  readonly pdf_file_path: string | null;
  readonly error_code: string | null;
  readonly narrative_error_code: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly completed_at: string | null;
}

// --- Funções "de app" (T-053, T-055) — sempre atrás da RLS do usuário ------

export interface PeriodArgs {
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
}

/** Contagem síncrona do período (§8.4: "contar entradas... de forma síncrona"). RLS já restringe ao próprio usuário. */
export async function countEntriesInPeriod(db: DbClient, args: PeriodArgs): Promise<number> {
  let query = db.from("entries").select("id", { count: "exact", head: true });
  if (args.periodStart) query = query.gte("occurred_at", args.periodStart);
  if (args.periodEnd) query = query.lt("occurred_at", args.periodEnd);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export interface CreateExportJobArgs extends PeriodArgs {
  readonly userId: string;
  readonly includeNarrative: boolean;
  readonly entryCount: number;
}

/**
 * Cria o job já com `entry_count` preenchido (calculado uma única vez, no
 * mesmo instante da contagem síncrona acima — o worker, T-054, não
 * recalcula; lacuna do documento-fonte quanto a corrida "conta muda entre o
 * pedido e o processamento", preenchida pragmaticamente por simplicidade,
 * já que os documentos-fonte não pedem nenhuma garantia anti-corrida aqui).
 * `narrative_status` nasce `pending` se `includeNarrative`, ou `skipped`
 * direto (nunca tentada) caso contrário.
 */
export async function createExportJob(
  db: DbClient,
  args: CreateExportJobArgs,
): Promise<ExportJobRow> {
  const { data, error } = await db
    .from("export_jobs")
    .insert({
      user_id: args.userId,
      period_start: args.periodStart,
      period_end: args.periodEnd,
      status: "pending",
      narrative_status: args.includeNarrative ? "pending" : "skipped",
      entry_count: args.entryCount,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as ExportJobRow;
}

/** `null` = não existe ou não pertence ao usuário (D7 — nunca 403, sempre NOT_FOUND). */
export async function findExportJobById(
  db: DbClient,
  userId: string,
  jobId: string,
): Promise<ExportJobRow | null> {
  const { data, error } = await db
    .from("export_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as ExportJobRow | null;
}

// --- Funções "de worker" (T-054) — `service_role`, sempre filtram user_id explicitamente ---

/** Sem filtro por dono (o worker não tem sessão de usuário) — usado só internamente, nunca a partir de um id vindo do app sem checagem prévia (quem chama já validou o job via `export_enqueue`/RLS antes de chegar na fila). */
export async function getExportJobForWorker(
  client: SupabaseClient,
  jobId: string,
): Promise<ExportJobRow | null> {
  const { data, error } = await client.from("export_jobs").select("*").eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  return data as ExportJobRow | null;
}

export interface ExportJobPatch {
  readonly status?: ExportJobStatus;
  readonly narrative_status?: ExportNarrativeStatus;
  readonly raw_file_path?: string;
  readonly pdf_file_path?: string;
  readonly error_code?: string | null;
  readonly narrative_error_code?: string | null;
  readonly completed_at?: string;
}

export async function updateExportJob(
  client: SupabaseClient,
  jobId: string,
  patch: ExportJobPatch,
): Promise<void> {
  const { error } = await client.from("export_jobs").update(patch).eq("id", jobId);
  if (error) throw error;
}

export interface ExportEntryRow {
  readonly id: string;
  readonly occurred_at: string;
  readonly source: string;
  readonly content: string;
}

/** Entradas do dono do job no período — `service_role` ignora RLS, por isso filtra `user_id` explicitamente aqui, nunca deixando de fora. Ordenado por `occurred_at ASC, id ASC` (desempate determinístico, regra nº6) — ordem de leitura natural para um resumo/relatório. */
export async function fetchEntriesForExport(
  client: SupabaseClient,
  args: { userId: string } & PeriodArgs,
): Promise<ExportEntryRow[]> {
  let query = client
    .from("entries")
    .select("id, occurred_at, source, content")
    .eq("user_id", args.userId);
  if (args.periodStart) query = query.gte("occurred_at", args.periodStart);
  if (args.periodEnd) query = query.lt("occurred_at", args.periodEnd);

  const { data, error } = await query.order("occurred_at", { ascending: true }).order("id", {
    ascending: true,
  });
  if (error) throw error;
  return (data ?? []) as ExportEntryRow[];
}
