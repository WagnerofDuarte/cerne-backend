-- T-051 — Fila `pgmq` + consumidor `pg_cron` (Plano técnico §8.4: "Zero
-- entradas -> erro; caso contrário -> criar job, enfileirar em pgmq".
-- "Worker da fila: consome de pgmq...").
--
-- Lacuna real do documento-fonte, encontrada implementando (revisar com o
-- Wagner se parecer errado): nem o plano técnico nem o `Contexto Geral.md`
-- dizem COMO o "consumidor pg_cron" roda de fato. `pg_cron` sozinho só
-- executa SQL/PL-pgSQL dentro do próprio Postgres — não tem como chamar a
-- Anthropic ou gravar um arquivo no Storage (isso exige uma chamada HTTP de
-- fora do banco). A saída adotada é o padrão já documentado pelo próprio
-- Supabase para "cron job que aciona uma Edge Function": `pg_cron` agenda
-- uma função que usa a extensão `pg_net` (chamadas HTTP assíncronas de
-- dentro do Postgres) para acordar a Edge Function `export-worker` (T-054,
-- que aí sim tem `fetch` de verdade e pode falar com Anthropic/Storage).
-- Isso significa uma extensão nova, `pg_net`, não listada em
-- `0001_extensions.sql` — adicionada aqui porque o mecanismo pedido
-- ("consumidor pg_cron" de uma fila que alimenta uma Edge Function) não é
-- possível sem ela dentro do Postgres puro.
--
-- Duas peças de infraestrutura só aqui, nunca em Edge Function de app
-- (regra nº5 — `service_role` só em worker de fila):
--   1. `export_jobs_queue` (pgmq): a fila propriamente dita.
--   2. `experiment.worker_config`: linha única com a URL base das Edge
--      Functions e a `service_role key` do próprio ambiente — é o que
--      permite ao SQL disparar a chamada HTTP autenticada. Nasce vazia;
--      precisa de um INSERT manual por ambiente (dev/ciclo-a/ciclo-b) —
--      ver nota de fechamento da Fase 5 no `big-plan.md`. Sem essa linha,
--      `export_dispatch_pending_jobs()` simplesmente não despacha nada (não
--      é um erro, só um `return` cedo) — jobs ficam presos em `pending` até
--      a configuração existir.
--
-- Nota de ambiente: nem `pgmq` nem `pg_net` têm pacote `apt` disponível
-- neste sandbox (só existem na imagem Postgres própria do Supabase) — esta
-- migração não pôde ser exercitada contra uma instância real de nenhum dos
-- dois aqui. Validação real fica inteiramente para o Wagner, via
-- `supabase db reset`/`supabase test db` locais.

create extension if not exists pg_net;

select pgmq.create('export_jobs_queue');

-- Singleton (D-like: só uma linha, travada por `check (id)` com PK boolean)
-- — não é dado de usuário, só configuração do próprio ambiente. Fora do
-- alcance de qualquer role de aplicativo, igual ao resto do schema
-- `experiment` (migração 0008).
create table experiment.worker_config (
  id                  boolean primary key default true,
  functions_base_url  text not null,
  service_role_key    text not null,
  constraint worker_config_singleton check (id)
);

-- --- Enfileirar (chamado por `export-summary-create`, T-053) ---------------
--
-- Mesmo padrão `SECURITY DEFINER` de superfície mínima da migração 0010:
-- a Edge Function que atende `POST /export/summary` roda com o JWT do
-- usuário (nunca `service_role`, regra nº5), mas `pgmq.send` vive num
-- schema que o PostgREST não expõe e que `authenticated` não tem GRANT
-- para tocar diretamente. A checagem de posse (`user_id = auth.uid()`)
-- dentro da própria função é o que impede um usuário autenticado de
-- enfileirar o job de outro usuário mesmo chamando esta RPC direto, fora
-- do gateway.
create or replace function public.export_enqueue(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pgmq, pg_temp
as $$
begin
  if not exists (
    select 1 from export_jobs where id = p_job_id and user_id = auth.uid()
  ) then
    raise exception 'export_enqueue: job % não pertence ao usuário autenticado', p_job_id;
  end if;

  perform pgmq.send('export_jobs_queue', jsonb_build_object('job_id', p_job_id));
end;
$$;

revoke execute on function public.export_enqueue(uuid) from public;
grant execute on function public.export_enqueue(uuid) to authenticated;

-- --- Consumidor (agendado por pg_cron, nunca chamado via RPC) --------------
--
-- Sem GRANT para nenhum papel de aplicativo — mesmo raciocínio de
-- `mark_stale_streaming_chat_messages` (migração 0012): só o próprio
-- `pg_cron` chama isto, como o papel que agendou o job (superusuário,
-- ignora GRANT/REVOKE).
--
-- `pgmq.read(fila, vt, qty)`: lê até `qty` mensagens, tornando-as invisíveis
-- por `vt` segundos (evita que duas execuções concorrentes do job peguem a
-- mesma mensagem). Cada mensagem é despachada para a Edge Function
-- `export-worker` via `net.http_post` (assíncrono — não espera a resposta;
-- ver nota abaixo) e removida da fila logo em seguida: este projeto não
-- implementa retry automático de despacho (fora do que os documentos-fonte
-- pedem) — se o despacho falhar de verdade, o job fica visivelmente preso
-- em `pending`/`processing` em `export_jobs`, auditável, sem mecanismo de
-- nova tentativa. Registrado como trade-off aceito, não escondido.
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
        'Authorization', 'Bearer ' || cfg.service_role_key
      ),
      timeout_milliseconds := 30000
    );
    perform pgmq.delete('export_jobs_queue', msg.msg_id);
  end loop;
end;
$$;

revoke execute on function public.export_dispatch_pending_jobs() from public;

-- A cada 15s — escolha prática (nenhum documento-fonte fixa a frequência de
-- consumo, só o limiar de 60s da mensagem presa do T-049, que é um caso
-- diferente). `cron.schedule` com `jobname` é idempotente (mesmo
-- raciocínio já registrado na migração 0012).
select cron.schedule(
  'export-dispatch-pending-jobs',
  '15 seconds',
  $$select public.export_dispatch_pending_jobs()$$
);
