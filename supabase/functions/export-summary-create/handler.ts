// T-053 — POST /export/summary (Plano técnico §8.4).
//
// Contagem síncrona (nunca dentro do job — a Seção 8.4 é literal: "contar
// entradas do período de forma síncrona"). Zero entradas -> EXPORT_EMPTY_PERIOD,
// sem criar linha em `export_jobs` nem enfileirar nada (assimetria
// intencional com o dashboard, RF09 — zero entradas lá não é erro).
// Caso contrário: cria o job (já com `entry_count` resolvido) e enfileira
// via `export_enqueue` (RPC SECURITY DEFINER, migração 0014 — nunca
// `service_role` aqui, regra nº5).

import { countEntriesInPeriod, createExportJob } from "../_shared/export-repo.ts";
import type { GatewayContext, HandlerResult } from "../_shared/gateway.ts";
import { buildDataEnvelope } from "../_shared/serialize.ts";
import { throwError } from "../_shared/errors.ts";

export interface CreateExportBody {
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly includeNarrative: boolean;
}

export async function handleCreateExport(
  ctx: GatewayContext<CreateExportBody, undefined>,
): Promise<HandlerResult> {
  const auth = ctx.auth!; // contract.auth === true
  const { periodStart, periodEnd, includeNarrative } = ctx.body;

  const entryCount = await countEntriesInPeriod(auth.db, { periodStart, periodEnd });
  if (entryCount === 0) {
    throwError("EXPORT_EMPTY_PERIOD", "nenhuma entrada no período solicitado");
  }

  const job = await createExportJob(auth.db, {
    userId: auth.userId,
    periodStart,
    periodEnd,
    includeNarrative,
    entryCount,
  });

  const { error: enqueueError } = await auth.db.rpc("export_enqueue", { p_job_id: job.id });
  if (enqueueError) throw enqueueError;

  // Repassa `ai_timeout` para o worker assíncrono (migração 0018) — ver o
  // comentário lá para o porquê. Os outros dois tipos aplicáveis aos 5
  // endpoints congelados (timeout/offline) já se resolvem no próprio
  // gateway, antes do handler rodar (nunca chegam até aqui); `malformed`
  // idem. `ai_timeout` é o único que precisa atravessar para o worker.
  if (ctx.fault?.type === "ai_timeout") {
    const { error: faultError } = await auth.db.rpc("export_mark_fault", {
      p_job_id: job.id,
      p_fault_type: "ai_timeout",
    });
    if (faultError) throw faultError;
  }

  return {
    status: 202,
    envelope: buildDataEnvelope({ job_id: job.id, status: job.status }),
  };
}
