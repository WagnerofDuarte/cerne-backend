// T-055 — GET /export/:jobId/status (Plano técnico §8.4).
//
// `downloadAvailable` já resolvido pelo servidor: `status IN ('data_ready',
// 'done')` — o app nunca precisa conhecer essa regra. Job de outro usuário
// ou inexistente: mesma resposta (404 NOT_FOUND), nunca 403 (D7).

import { findExportJobById } from "../_shared/export-repo.ts";
import { throwError } from "../_shared/errors.ts";
import type { GatewayContext, HandlerResult } from "../_shared/gateway.ts";
import { buildDataEnvelope } from "../_shared/serialize.ts";

const DOWNLOADABLE_STATUSES = new Set(["data_ready", "done"]);
// Mesmo raciocínio de `entries-get` (T-039, D7): um `jobId` que não é sequer
// um uuid não pode ser de ninguém — mesma resposta 404, nunca um erro de
// sintaxe do banco vazando como 500.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleGetExportStatus(
  ctx: GatewayContext<undefined, undefined>,
): Promise<HandlerResult> {
  const auth = ctx.auth!; // contract.auth === true
  const jobId = ctx.params.jobId;
  if (!jobId || !UUID_RE.test(jobId)) throwError("NOT_FOUND", "job de exportação não encontrado");

  const job = await findExportJobById(auth.db, auth.userId, jobId);
  if (!job) throwError("NOT_FOUND", "job de exportação não encontrado");

  return {
    status: 200,
    envelope: buildDataEnvelope({
      job_id: job.id,
      status: job.status,
      narrative_status: job.narrative_status,
      entry_count: job.entry_count,
      error_code: job.error_code,
      narrative_error_code: job.narrative_error_code,
      download_available: DOWNLOADABLE_STATUSES.has(job.status),
    }),
  };
}
