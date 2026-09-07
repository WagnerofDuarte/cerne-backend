-- T-054 — Repasse do fault `ai_timeout` pro worker (migração 0018).

set search_path to public, extensions;
begin;
select plan(6);

insert into auth.users (id, email) values
  ('99999999-0000-0000-0000-000000000001', 'pgtap-user-x@cerne.test'),
  ('99999999-0000-0000-0000-000000000002', 'pgtap-user-y@cerne.test');

insert into public.export_jobs (id, user_id, status, narrative_status) values
  ('88888888-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001', 'pending', 'pending');

-- 1) dono consegue marcar o próprio job.
do $$
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000001', true);
  perform public.export_mark_fault('88888888-0000-0000-0000-000000000001', 'ai_timeout');
  execute 'reset role';
end $$;
select is(
  (select fault_type from experiment.export_fault where job_id = '88888888-0000-0000-0000-000000000001'),
  'ai_timeout',
  'export_mark_fault: dono marca o próprio job'
);

-- 2) outro usuário não consegue marcar o job alheio.
do $$
declare
  v_sqlstate text := null;
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000002', true);
  begin
    perform public.export_mark_fault('88888888-0000-0000-0000-000000000001', 'ai_timeout');
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  perform set_config('cerne.tmp_sqlstate', coalesce(v_sqlstate, 'NULL'), false);
end $$;
select is(current_setting('cerne.tmp_sqlstate'), 'P0001', 'export_mark_fault: outro usuário não marca job alheio');

-- 3) anon não consegue chamar export_mark_fault.
do $$
declare
  v_sqlstate text := null;
begin
  execute 'set role anon';
  begin
    perform public.export_mark_fault('88888888-0000-0000-0000-000000000001', 'ai_timeout');
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  perform set_config('cerne.tmp_sqlstate', coalesce(v_sqlstate, 'NULL'), false);
end $$;
select is(current_setting('cerne.tmp_sqlstate'), '42501', 'export_mark_fault: anon é negado');

-- 4) chamar de novo com um job_id já marcado atualiza (on conflict), não duplica.
do $$
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000001', true);
  perform public.export_mark_fault('88888888-0000-0000-0000-000000000001', 'ai_timeout');
  execute 'reset role';
end $$;
select is(
  (select count(*)::int from experiment.export_fault where job_id = '88888888-0000-0000-0000-000000000001'),
  1,
  'export_mark_fault: chamada repetida não duplica (on conflict update)'
);

-- 5) authenticated NÃO consegue chamar export_get_fault (só service_role).
do $$
declare
  v_sqlstate text := null;
begin
  execute 'set role authenticated';
  begin
    perform public.export_get_fault('88888888-0000-0000-0000-000000000001');
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  perform set_config('cerne.tmp_sqlstate', coalesce(v_sqlstate, 'NULL'), false);
end $$;
select is(current_setting('cerne.tmp_sqlstate'), '42501', 'export_get_fault: authenticated é negado (só service_role)');

-- 6) service_role consegue ler a marca.
do $$
begin
  execute 'set role service_role';
  perform set_config('cerne.tmp',
    coalesce(public.export_get_fault('88888888-0000-0000-0000-000000000001'), 'NULL'),
    false);
  execute 'reset role';
end $$;
select is(current_setting('cerne.tmp'), 'ai_timeout', 'export_get_fault: service_role lê a marca gravada');

select * from finish();
rollback;
