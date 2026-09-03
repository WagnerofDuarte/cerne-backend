-- T-023 — Trava do schema `experiment` (Plano técnico §11.1).
-- authenticated e anon não têm acesso a nenhuma tabela do schema experiment.

set search_path to public, extensions;
begin;
select plan(4);

do $$
declare
  v_sqlstate text := null;
begin
  execute 'set role authenticated';
  begin
    perform count(*) from experiment.ai_replay_cache;
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  perform set_config('cerne.tmp_sqlstate', coalesce(v_sqlstate, 'NULL'), false);
end $$;
select is(current_setting('cerne.tmp_sqlstate'), '42501', 'experiment.ai_replay_cache: authenticated sem acesso');

do $$
declare
  v_sqlstate text := null;
begin
  execute 'set role authenticated';
  begin
    perform count(*) from experiment.fault_injection_log;
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  perform set_config('cerne.tmp_sqlstate', coalesce(v_sqlstate, 'NULL'), false);
end $$;
select is(current_setting('cerne.tmp_sqlstate'), '42501', 'experiment.fault_injection_log: authenticated sem acesso');

do $$
declare
  v_sqlstate text := null;
begin
  execute 'set role anon';
  begin
    perform count(*) from experiment.ai_replay_cache;
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  perform set_config('cerne.tmp_sqlstate', coalesce(v_sqlstate, 'NULL'), false);
end $$;
select is(current_setting('cerne.tmp_sqlstate'), '42501', 'experiment.ai_replay_cache: anon sem acesso');

do $$
declare
  v_sqlstate text := null;
begin
  execute 'set role anon';
  begin
    perform count(*) from experiment.fault_injection_log;
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  perform set_config('cerne.tmp_sqlstate', coalesce(v_sqlstate, 'NULL'), false);
end $$;
select is(current_setting('cerne.tmp_sqlstate'), '42501', 'experiment.fault_injection_log: anon sem acesso');

select * from finish();
rollback;
