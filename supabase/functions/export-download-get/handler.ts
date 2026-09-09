// T-055 — GET /export/:jobId/download (Plano técnico §8.4).
//
// 302 para uma URL assinada do Storage — nunca 4xx/5xx só porque a
// narrativa falhou (§8.4, literal: "Responde com sucesso sempre que
// downloadAvailable — falha de narrativa NUNCA produz 4xx/5xx aqui").
// `format=pdf` (default) cai para `raw` se o PDF não existir (narrativa
// falhada ou pulada); `format=raw` sempre pega o bruto.
//
// Lacuna do documento-fonte, preenchida pragmaticamente (revisar se
// parecer errado): nem o plano técnico nem o `Contexto Geral.md` dizem o
// que devolver se o job ainda não chegou a `downloadAvailable` (pendente/
// processando — diferente de "narrativa falhou", que É coberto). Como não
// existe um código de erro dedicado a "ainda não está pronto" e o arquivo
// literalmente não existe no Storage ainda, a leitura adotada é a mesma de
// qualquer outro recurso que não existe: `NOT_FOUND`.
//
// A URL assinada é criada com o cliente do PRÓPRIO usuário (`auth.db`,
// nunca `service_role` — regra nº5): a política de Storage do bucket
// `exports` (T-052, migração 0013) já concede `select` ao dono do caminho,
// então isso funciona sem elevar privilégio.

import { findExportJobById } from "../_shared/export-repo.ts";
import { throwError } from "../_shared/errors.ts";
import type { GatewayContext, RedirectHandlerResult } from "../_shared/gateway.ts";

const DOWNLOADABLE_STATUSES = new Set(["data_ready", "done"]);
/** Curta de propósito — o app segue o redirect na hora; nenhum documento-fonte fixa um TTL. */
const SIGNED_URL_TTL_SECONDS = 60;
// Mesmo raciocínio de `entries-get` (T-039, D7) — ver `export-status-get/handler.ts`.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DownloadExportQuery {
  readonly format?: "pdf" | "raw";
}

export async function handleDownloadExport(
  ctx: GatewayContext<undefined, DownloadExportQuery>,
): Promise<RedirectHandlerResult> {
  const auth = ctx.auth!; // contract.auth === true
  const jobId = ctx.params.jobId;
  if (!jobId || !UUID_RE.test(jobId)) throwError("NOT_FOUND", "job de exportação não encontrado");
  const format = ctx.query.format ?? "pdf";

  const job = await findExportJobById(auth.db, auth.userId, jobId);
  if (!job) throwError("NOT_FOUND", "job de exportação não encontrado");
  if (!DOWNLOADABLE_STATUSES.has(job.status)) {
    throwError("NOT_FOUND", "exportação ainda não está pronta para download");
  }

  const path = (format === "pdf" && job.pdf_file_path) ? job.pdf_file_path : job.raw_file_path;
  if (!path) throwError("NOT_FOUND", "arquivo de exportação não encontrado");

  const { data, error } = await auth.db.storage.from("exports").createSignedUrl(
    path,
    SIGNED_URL_TTL_SECONDS,
  );
  if (error || !data?.signedUrl) throwError("NOT_FOUND", "não foi possível assinar o arquivo");

  return { location: data.signedUrl };
}
