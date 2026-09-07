// Entrada Deno da função `export-worker` (T-054) — DIFERENTE de todo o
// resto: não é um dos 23 endpoints do `registry.ts`, não passa por
// `runGateway` (sem X-Test-Fault/X-Test-Now/validação Zod — nada disso se
// aplica a uma chamada interna do próprio banco) e nunca é chamado por um
// app cliente. Só o `pg_cron`/`pg_net` da migração 0014 chama isto, com
// `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` — a checagem abaixo
// (comparar o bearer recebido com a própria `service_role key` do
// ambiente) é o único "gateway" desta função. `verify_jwt = false`
// (`config.toml`) pelo mesmo motivo de sempre: quem decide o que aceitar
// como credencial válida é o próprio código, não o runtime.

import { readWorkerEnv } from "../_shared/deps.ts";
import { createServiceRoleClient } from "../_shared/worker-db.ts";
import { processExportJob } from "./worker.ts";

const env = readWorkerEnv();

function isAuthorized(req: Request): boolean {
  const bearer = req.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  return bearer === env.supabaseServiceRoleKey;
}

Deno.serve(async (req) => {
  if (!isAuthorized(req)) {
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
