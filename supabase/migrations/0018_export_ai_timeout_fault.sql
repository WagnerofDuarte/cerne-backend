-- T-054 — Repasse do fault `ai_timeout` do request síncrono (`POST
-- /export/summary`) para o worker assíncrono (`export-worker`).
--
-- Lacuna real de arquitetura, encontrada implementando (revisar com o
-- Wagner se parecer errado): a Seção 10.2 lista `ai_timeout` como aplicável
-- a RF05 ("Falha apenas a chamada de IA; o resto do endpoint funciona"), e
-- `Contexto Geral.md` nomeia `export_resiliente.hurl` testando exatamente
-- isso. Mas a narrativa da exportação roda no worker (T-054), acordado
-- pelo `pg_cron`/`pg_net` (migração 0014) muito depois da requisição
-- original terminar — o worker nunca vê o cabeçalho `X-Test-Fault` de
-- `POST /export/summary`, não tem como saber que deveria forçar a
-- narrativa a falhar.
--
-- Solução (mesmo padrão `SECURITY DEFINER` de superfície mínima das
-- migrações 0010/0014/0017): quando o gateway já interpretou
-- `X-Test-Fault: ai_timeout` na requisição de `POST /export/summary`
-- (`ctx.fault`, já resolvido no passo 4 do gateway), o handler
-- (`export-summary-create`) grava essa intenção junto do job recém-criado,
-- via `export_mark_fault` — nunca `service_role` aqui, é a Edge Function
-- de app. O worker, rodando com `service_role` (legítimo, regra nº5), lê
-- essa intenção via `export_get_fault` antes de tentar a narrativa.
create table experiment.export_fault (
  job_id     uuid primary key references public.export_jobs (id) on delete cascade,
  fault_type text not null
);

create or replace function public.export_mark_fault(p_job_id uuid, p_fault_type text)
returns void
language plpgsql
security definer
set search_path = experiment, public, pg_temp
as $$
begin
  if not exists (
    select 1 from export_jobs where id = p_job_id and user_id = auth.uid()
  ) then
    raise exception 'export_mark_fault: job % não pertence ao usuário autenticado', p_job_id;
  end if;

  insert into experiment.export_fault (job_id, fault_type)
  values (p_job_id, p_fault_type)
  on conflict (job_id) do update set fault_type = excluded.fault_type;
end;
$$;

revoke execute on function public.export_mark_fault(uuid, text) from public;
grant execute on function public.export_mark_fault(uuid, text) to authenticated;

-- Só o worker (service_role) lê isto — nunca exposto a `authenticated`,
-- que não tem motivo para consultar a falha marcada no job de outro (ou no
-- próprio, já que ele mesmo que gravou).
create or replace function public.export_get_fault(p_job_id uuid)
returns text
language sql
security definer
set search_path = experiment, pg_temp
as $$
  select fault_type from experiment.export_fault where job_id = p_job_id;
$$;

revoke execute on function public.export_get_fault(uuid) from public;
grant execute on function public.export_get_fault(uuid) to service_role;
