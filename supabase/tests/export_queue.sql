-- T-051 — Fila `pgmq` + consumidor `pg_cron` (migração 0014).
--
-- Nota de ambiente: `pgmq`/`pg_net` não têm extensão real disponível neste
-- sandbox (só na imagem própria do Supabase) — este arquivo foi validado
-- aqui contra um STUB local de ambas (mesmas assinaturas de função,
-- comportamento simplificado), nunca contra a extensão real. Cobre a
-- lógica que é nossa (posse do job, dispatch varrendo a fila, grants) — não
-- prova que `pgmq.send`/`pg_net.http_post` de verdade se comportam como o
-- stub. Validação real fica para o Wagner.

set search_path to public, extensions;
begin;
select plan(8);

insert into auth.users (id, email) values
  ('99999999-0000-0000-0000-000000000001', 'pgtap-user-x@cerne.test'),
  ('99999999-0000-0000-0000-000000000002', 'pgtap-user-y@cerne.test');

insert into public.export_jobs (id, user_id, status, narrative_status) values
  ('88888888-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001', 'pending', 'pending');

-- 1) dono consegue enfileirar o próprio job — mensagem aparece na fila stub.
do $$
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000001', true);
  perform public.export_enqueue('88888888-0000-0000-0000-000000000001');
  execute 'reset role';
end $$;
select is(
  (select count(*)::int from pgmq.messages
    where queue_name = 'export_jobs_queue'
      and message ->> 'job_id' = '88888888-0000-0000-0000-000000000001'),
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
  (select count(*)::int from net.calls),
  0,
  'export_dispatch_pending_jobs: sem worker_config, nenhuma chamada HTTP é feita'
);

-- 6) com worker_config, o dispatch despacha a mensagem pendente (do passo 1) e a remove da fila.
insert into experiment.worker_config (functions_base_url, service_role_key)
values ('http://127.0.0.1:54321/functions/v1', 'fake-service-role-key-for-test');

select public.export_dispatch_pending_jobs();

select is(
  (select count(*)::int from net.calls
    where url = 'http://127.0.0.1:54321/functions/v1/export-worker'
      and body ->> 'jobId' = '88888888-0000-0000-0000-000000000001'
      and headers ->> 'Authorization' = 'Bearer fake-service-role-key-for-test'),
  1,
  'export_dispatch_pending_jobs: despacha a mensagem pendente para export-worker com o bearer certo'
);
select is(
  (select count(*)::int from pgmq.messages where queue_name = 'export_jobs_queue'),
  0,
  'export_dispatch_pending_jobs: remove a mensagem da fila depois de despachar'
);

select * from finish();
rollback;
