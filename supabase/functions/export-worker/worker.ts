// T-054 — Worker de exportação (Plano técnico §8.4: "consome de pgmq,
// coleta as entradas, grava o arquivo bruto, marca status='data_ready',
// então tenta a narrativa. Sucesso -> gera PDF e marca done. Falha ->
// narrative_status='failed', status permanece data_ready.").
//
// Único módulo do projeto que roda fora do ciclo requisição/resposta do
// app — chamado por `export-worker/index.ts`, que por sua vez só é
// acordado pelo `pg_cron`/`pg_net` da migração 0014 (nunca por um usuário
// final). Por isso recebe um `SupabaseClient` de `service_role`
// (`_shared/worker-db.ts`) em vez do `DbClient` comum: não há JWT de
// usuário aqui, e o worker precisa ler/gravar dados de um dono arbitrário —
// é exatamente a exceção que a regra nº5 prevê ("só em workers de fila").

import { ANTHROPIC_MODELS, callAnthropic } from "../_shared/ai/anthropic.ts";
import type { ReplayDeps, ReplayMode } from "../_shared/replay.ts";
import { buildReplayDeps } from "../_shared/deps.ts";
import {
  type ExportEntryRow,
  fetchEntriesForExport,
  getExportJobForWorker,
  updateExportJob,
} from "../_shared/export-repo.ts";
import { buildExportPdf } from "../_shared/pdf.ts";
import { buildExportNarrativePrompt } from "../_shared/prompts.ts";
import { buildNarrativeEnvelope } from "../_shared/replay.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

/** "3 a 6 frases" (prompts.ts) — generoso o bastante sem abrir espaço para geração descontrolada, mesma natureza pragmática de `INSIGHT_MAX_TOKENS`/`CHAT_MAX_TOKENS` (Fase 4). */
export const EXPORT_NARRATIVE_MAX_TOKENS = 512;

export interface ProcessExportJobDeps {
  readonly client: SupabaseClient;
  readonly anthropicApiKey: string;
  readonly promptVersion: string;
  readonly replayMode: ReplayMode;
  readonly fetchImpl?: typeof fetch;
  /** Injetável para teste — produção usa `new Date()` (o worker não passa por `clock.ts`: não atende requisição HTTP do app, não tem `X-Test-Now` para ler). */
  readonly nowIso?: () => string;
}

function periodLabel(periodStart: string | null, periodEnd: string | null): string {
  return `${periodStart ?? "-"}..${periodEnd ?? "-"}`;
}

function rawPathFor(userId: string, jobId: string): string {
  return `${userId}/${jobId}/raw.json`;
}

function pdfPathFor(userId: string, jobId: string): string {
  return `${userId}/${jobId}/summary.pdf`;
}

function buildRawPayload(
  args: {
    periodStart: string | null;
    periodEnd: string | null;
    entries: readonly ExportEntryRow[];
  },
): Uint8Array {
  const json = JSON.stringify({
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    entries: args.entries,
  });
  return new TextEncoder().encode(json);
}

/**
 * Processa um job de exportação do início ao fim. Nunca lança — uma falha
 * inesperada (fora da narrativa, que já tem seu próprio tratamento) marca o
 * job como `status='error'` em vez de derrubar o worker; não há usuário do
 * outro lado de uma resposta HTTP para receber um 5xx aqui.
 */
export async function processExportJob(jobId: string, deps: ProcessExportJobDeps): Promise<void> {
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());

  try {
    const job = await getExportJobForWorker(deps.client, jobId);
    if (!job) return; // job desapareceu (ex.: conta apagada entre o enfileiramento e o despacho) — nada a fazer.

    await updateExportJob(deps.client, jobId, { status: "processing" });

    const entries = await fetchEntriesForExport(deps.client, {
      userId: job.user_id,
      periodStart: job.period_start,
      periodEnd: job.period_end,
    });

    const rawPath = rawPathFor(job.user_id, job.id);
    const rawBytes = buildRawPayload({
      periodStart: job.period_start,
      periodEnd: job.period_end,
      entries,
    });
    const upload = await deps.client.storage.from("exports").upload(rawPath, rawBytes, {
      contentType: "application/json",
      upsert: true,
    });
    if (upload.error) throw upload.error;

    await updateExportJob(deps.client, jobId, {
      status: "data_ready",
      raw_file_path: rawPath,
    });

    if (job.narrative_status === "skipped") {
      await updateExportJob(deps.client, jobId, { status: "done", completed_at: nowIso() });
      return;
    }

    await tryGenerateNarrative(
      job.id,
      job.user_id,
      job.period_start,
      job.period_end,
      entries,
      deps,
      nowIso,
    );
  } catch {
    // Falha fora do trecho de narrativa (ex.: Storage indisponível no
    // upload do bruto) — marca o job como erro; diferente da narrativa,
    // não há um "meio termo" aqui porque o dado bruto nem chegou a existir.
    await updateExportJob(deps.client, jobId, { status: "error", completed_at: nowIso() }).catch(
      () => {},
    );
  }
}

async function tryGenerateNarrative(
  jobId: string,
  userId: string,
  periodStart: string | null,
  periodEnd: string | null,
  entries: readonly ExportEntryRow[],
  deps: ProcessExportJobDeps,
  nowIso: () => string,
): Promise<void> {
  const replay: ReplayDeps = buildReplayDeps(deps.client, deps.replayMode);
  const prompt = buildExportNarrativePrompt({
    promptVersion: deps.promptVersion,
    entries: entries.map((e) => ({ id: e.id, content: e.content })),
  });

  try {
    // `ai_timeout` marcado por `export-summary-create` (migração 0018) —
    // ver o comentário lá. Falha a chamada de IA sem bater na rede, mesmo
    // espírito de `chat-insight-create/generation.ts` (`forceFailure`).
    const { data: forcedFault } = await deps.client.rpc("export_get_fault", { p_job_id: jobId });
    if (forcedFault === "ai_timeout") throw new Error("ai_timeout forçado por X-Test-Fault");

    const envelope = await buildNarrativeEnvelope({
      provider: "anthropic",
      model: ANTHROPIC_MODELS.haiku45,
      promptVersion: deps.promptVersion,
      period: periodLabel(periodStart, periodEnd),
      entryIds: entries.map((e) => e.id),
    });

    const result = await callAnthropic(
      envelope,
      {
        model: ANTHROPIC_MODELS.haiku45,
        system: prompt.system,
        messages: prompt.messages,
        maxTokens: EXPORT_NARRATIVE_MAX_TOKENS,
      },
      { anthropicApiKey: deps.anthropicApiKey, fetchImpl: deps.fetchImpl, replay },
    );

    const textBlock = result.response.content.find(
      (block) => block.type === "text" && typeof block.text === "string",
    );
    const narrativeText = textBlock?.text?.trim();
    if (!narrativeText) throw new Error("narrativa vazia");

    const pdfPath = pdfPathFor(userId, jobId);
    const pdfBytes = buildExportPdf({
      title: "Resumo pessoal — Cerne",
      metaLines: [
        `Período: ${periodStart ?? "início"} até ${periodEnd ?? "hoje"}`,
        `Entradas consideradas: ${entries.length}`,
        `Gerado em: ${nowIso()}`,
      ],
      paragraphs: [narrativeText],
    });
    const upload = await deps.client.storage.from("exports").upload(pdfPath, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (upload.error) throw upload.error;

    await updateExportJob(deps.client, jobId, {
      status: "done",
      narrative_status: "done",
      pdf_file_path: pdfPath,
      completed_at: nowIso(),
    });
  } catch {
    // "Falha -> narrative_status='failed', status permanece data_ready"
    // (§8.4, literal) — nunca propaga, o bruto já está disponível.
    await updateExportJob(deps.client, jobId, {
      narrative_status: "failed",
      narrative_error_code: "AI_GENERATION_TIMEOUT",
      completed_at: nowIso(),
    }).catch(() => {});
  }
}
