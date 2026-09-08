-- T-054 — renomeia `experiment.worker_config.service_role_key` para
-- `shared_secret` (achado real do T-059v, Wagner, rodando contra o
-- Supabase local de verdade).
--
-- `supabase functions serve --env-file` RECUSA carregar do `.env.local` do
-- desenvolvedor qualquer variável cujo nome comece com `SUPABASE_` — a CLI
-- imprime "Env name cannot start with SUPABASE_, skipping:
-- SUPABASE_SERVICE_ROLE_KEY" e injeta, no lugar, o valor interno da própria
-- stack local (fora do controle de quem está desenvolvendo). Isso quebra a
-- premissa original da migração 0014: o valor gravado manualmente nesta
-- coluna (pensado como "a service_role key do ambiente") NUNCA é o mesmo
-- que a função `export-worker`, servida localmente, enxerga via
-- `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")` — a checagem de autorização
-- (`export-worker/index.ts`) rejeitava toda chamada do `pg_net` com 401,
-- mesmo com a URL/rede corretas (`net._http_response.status_code = 401`).
--
-- Correção (ver `_shared/deps.ts`, `WorkerEnv.workerSecret`): o
-- `export-worker` passa a se autenticar com um segredo PRÓPRIO
-- (`EXPORT_WORKER_SECRET`), sem o prefixo `SUPABASE_` — a CLI não mexe
-- nele. A `service_role key` de verdade continua existindo e sendo usada
-- (por outra variável, inalterada) só para o cliente de banco do worker em
-- `worker-db.ts` — isso não muda, e continua sendo o único lugar do
-- projeto com `service_role` (regra nº5). Renomear a coluna evita que o
-- nome antigo continue sugerindo, de forma enganosa, que o valor aqui
-- precisa ser a `service_role key` do projeto: a partir de agora é
-- qualquer segredo compartilhado escolhido pelo próprio ambiente, que deve
-- ser o MESMO valor configurado em `EXPORT_WORKER_SECRET`.
alter table experiment.worker_config
  rename column service_role_key to shared_secret;

-- `create or replace function` com a mesma assinatura preserva os GRANTs
-- já existentes (migração 0014) — o `revoke` abaixo é só defensivo/
-- documentacional, mesmo padrão do restante do projeto.
create or replace function public.export_dispatch_pending_jobs()
returns void
language plpgsql
security definer
set search_path = public, pgmq, experiment, pg_temp
as $$
declare
  cfg record;
  msg record;
begin
  select * into cfg from experiment.worker_config limit 1;
  if cfg is null then
    return;
  end if;

  for msg in select * from pgmq.read('export_jobs_queue', 60, 5) loop
    perform net.http_post(
      url := cfg.functions_base_url || '/export-worker',
      body := jsonb_build_object('jobId', msg.message ->> 'job_id'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || cfg.shared_secret
      ),
      timeout_milliseconds := 30000
    );
    perform pgmq.delete('export_jobs_queue', msg.msg_id);
  end loop;
end;
$$;

revoke execute on function public.export_dispatch_pending_jobs() from public;
