-- T-051 — Fila `pgmq` + consumidor `pg_cron` (migração 0014).
--
-- Nota de ambiente: `pgmq`/`pg_net` não têm extensão real disponível neste
-- sandbox (só na imagem própria do Supabase) — este arquivo foi ESCRITO e
-- validado aqui contra um STUB local de ambas (mesmas assinaturas de
-- função exportadas por `public.export_enqueue`/`export_dispatch_pending_
-- jobs`, comportamento simplificado por trás delas). O stub usava uma
-- única tabela `pgmq.messages` para todas as filas — achado real do
-- Wagner rodando contra o `pgmq` de verdade (T-059v): não existe
-- `pgmq.messages`, o `pgmq` real cria uma tabela POR FILA
-- (`pgmq.q_<nome_da_fila>`, aqui `pgmq.q_export_jobs_queue`) — corrigido
-- abaixo para o nome real. `net.calls` (stub de `pg_net`) segue sem
-- equivalente real verificado — `net_http_request_queue`/similar não foi
-- conferido; se os testes 5/6 também falharem, é a próxima correção.

set search_path to public, extensions;
begin;
select plan(7);

insert into auth.users (id, email) values
  ('99999999-0000-0000-0000-000000000001', 'pgtap-user-x@cerne.test'),
  ('99999999-0000-0000-0000-000000000002', 'pgtap-user-y@cerne.test');

insert into public.export_jobs (id, user_id, status, narrative_status) values
  ('88888888-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001', 'pending', 'pending');

-- 1) dono consegue enfileirar o próprio job — mensagem aparece na fila real
-- (`pgmq.q_export_jobs_queue` — uma tabela por fila, não `pgmq.messages`).
do $$
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000001', true);
  perform public.export_enqueue('88888888-0000-0000-0000-000000000001');
  execute 'reset role';
end $$;
select is(
  (select count(*)::int from pgmq.q_export_jobs_queue
    where message ->> 'job_id' = '88888888-0000-0000-0000-000000000001'),
  1,
  'export_enqueue: dono enfileira o próprio job'
);

-- 2) outro usuário não consegue enfileirar o job alheio — exceção (checagem de posse).
do $$
declare
  v_sqlstate text := null;
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000002', true);
  begin
    perform public.export_enqueue('88888888-0000-0000-0000-000000000001');
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  perform set_config('cerne.tmp_sqlstate', coalesce(v_sqlstate, 'NULL'), false);
end $$;
select is(current_setting('cerne.tmp_sqlstate'), 'P0001', 'export_enqueue: outro usuário não consegue enfileirar job alheio');

-- 3) job inexistente também é recusado (mesmo caminho de código — sem distinguir "não existe" de "não é seu").
do $$
declare
  v_sqlstate text := null;
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000001', true);
  begin
    perform public.export_enqueue('88888888-0000-0000-0000-000000000099');
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  perform set_config('cerne.tmp_sqlstate', coalesce(v_sqlstate, 'NULL'), false);
end $$;
select is(current_setting('cerne.tmp_sqlstate'), 'P0001', 'export_enqueue: job inexistente é recusado');

-- 4) anon não consegue chamar export_enqueue.
do $$
declare
  v_sqlstate text := null;
begin
  execute 'set role anon';
  begin
    perform public.export_enqueue('88888888-0000-0000-0000-000000000001');
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  perform set_config('cerne.tmp_sqlstate', coalesce(v_sqlstate, 'NULL'), false);
end $$;
select is(current_setting('cerne.tmp_sqlstate'), '42501', 'export_enqueue: anon é negado');

-- 5) sem `experiment.worker_config` configurado, o dispatch não erra — só não despacha nada.
select lives_ok(
  $$select public.export_dispatch_pending_jobs()$$,
  'export_dispatch_pending_jobs: sem worker_config, sai em silêncio (sem erro)'
);
select is(
  (select count(*)::int from pgmq.q_export_jobs_queue
    where message ->> 'job_id' = '88888888-0000-0000-0000-000000000001'),
  1,
  'export_dispatch_pending_jobs: sem worker_config, a mensagem continua na fila (nada foi lido/removido)'
);

-- 6) com worker_config, o dispatch lê a mensagem pendente (do passo 1) e a
-- remove da fila — isso é síncrono na nossa função (o `pgmq.delete` roda
-- logo depois do `net.http_post`, que só ENFILEIRA a chamada HTTP de
-- verdade e devolve na hora — quem processa de fato é um worker interno do
-- `pg_net`, fora do nosso controle e do escopo deste teste). O CONTEÚDO
-- exato da chamada HTTP (URL/corpo/bearer) não é verificado aqui por
-- pgTAP — a tabela interna do `pg_net` não foi conferida com confiança
-- contra a extensão real (só documentação, não testada de verdade neste
-- sandbox) e a checagem seria assíncrona/instável de qualquer forma; quem
-- prova isso de ponta a ponta é a suíte Hurl (`export_download.hurl`/
-- `export_resiliente.hurl` — se o job chega a `done`/`data_ready`, o
-- despacho funcionou de verdade).
insert into experiment.worker_config (functions_base_url, shared_secret)
values ('http://127.0.0.1:54321/functions/v1', 'fake-shared-secret-for-test');

select public.export_dispatch_pending_jobs();

select is(
  (select count(*)::int from pgmq.q_export_jobs_queue
    where message ->> 'job_id' = '88888888-0000-0000-0000-000000000001'),
  0,
  'export_dispatch_pending_jobs: remove a mensagem da fila depois de despachar'
);

select * from finish();
rollback;
