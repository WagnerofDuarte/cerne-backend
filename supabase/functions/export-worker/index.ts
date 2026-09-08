// Entrada Deno da função `export-worker` (T-054) — DIFERENTE de todo o
// resto: não é um dos 23 endpoints do `registry.ts`, não passa por
// `runGateway` (sem X-Test-Fault/X-Test-Now/validação Zod — nada disso se
// aplica a uma chamada interna do próprio banco) e nunca é chamado por um
// app cliente. Só o `pg_cron`/`pg_net` da migração 0014/0019 chama isto,
// com `Authorization: Bearer <EXPORT_WORKER_SECRET>` — a checagem abaixo
// (comparar o bearer recebido com esse segredo próprio do worker) é o
// único "gateway" desta função. `verify_jwt = false` (`config.toml`) pelo
// mesmo motivo de sempre: quem decide o que aceitar como credencial válida
// é o próprio código, não o runtime.
//
// NÃO usa `SUPABASE_SERVICE_ROLE_KEY` para esta checagem — achado real do
// T-059v, Wagner: `supabase functions serve --env-file` recusa carregar
// qualquer variável `SUPABASE_*` do `.env.local` do desenvolvedor (usa
// sempre o valor interno da própria CLI), então essa variável nunca seria
// igual ao que `experiment.worker_config` envia. Ver comentário em
// `_shared/deps.ts` (`WorkerEnv.workerSecret`).

import { readWorkerEnv } from "../_shared/deps.ts";
import { createServiceRoleClient } from "../_shared/worker-db.ts";
import { processExportJob } from "./worker.ts";

const env = readWorkerEnv();

function isAuthorized(req: Request): boolean {
  const bearer = req.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  return bearer === env.workerSecret;
}

Deno.serve(async (req) => {
  if (!isAuthorized(req)) {
    // Nunca loga o bearer recebido nem `env.workerSecret` (seria vazar o
    // próprio segredo no log) — só o fato de ter rejeitado, para dar
    // visibilidade sem comprometer a credencial. Achado real (T-059v):
    // este 401 é exatamente o sintoma de `experiment.worker_config` com um
    // `shared_secret` diferente do `EXPORT_WORKER_SECRET` do `.env.local`
    // (ou do `.env.local` desatualizado — a função precisa ser reiniciada
    // depois de editar o arquivo).
    console.error(
      "export-worker: 401 — bearer recebido não bate com EXPORT_WORKER_SECRET (confira experiment.worker_config.shared_secret e se o .env.local foi recarregado)",
    );
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let jobId: string | undefined;
  try {
    const body = await req.json();
    jobId = typeof body?.jobId === "string" ? body.jobId : undefined;
  } catch {
    // corpo ausente/inválido — tratado abaixo pelo `!jobId`.
  }
  if (!jobId) {
    console.error("export-worker: 400 — jobId ausente/inválido no corpo da requisição");
    return new Response(JSON.stringify({ error: "jobId ausente" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const client = createServiceRoleClient(env);
  await processExportJob(jobId, {
    client,
    anthropicApiKey: env.anthropicApiKey,
    promptVersion: env.promptVersion,
    replayMode: env.replayMode,
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
