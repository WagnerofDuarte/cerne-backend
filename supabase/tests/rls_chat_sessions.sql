-- T-023 — RLS de `chat_sessions` (Plano técnico §11.1).
-- Cobre: isolamento positivo, isolamento negativo (zero linhas, não erro),
-- escrita cruzada bloqueada, RLS forçada, anon sem leitura.

set search_path to public, extensions;
begin;
select plan(6);

insert into auth.users (id, email) values
  ('99999999-0000-0000-0000-000000000001', 'pgtap-user-x@cerne.test'),
  ('99999999-0000-0000-0000-000000000002', 'pgtap-user-y@cerne.test');

insert into public.chat_sessions (user_id, persona_snapshot) values
  ('99999999-0000-0000-0000-000000000001', 'empatico');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.chat_sessions'::regclass),
  'chat_sessions: RLS habilitada'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.chat_sessions'::regclass),
  'chat_sessions: RLS forçada'
);

do $$
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000001', true);
  perform set_config('cerne.tmp',
    (select count(*)::text from public.chat_sessions where user_id = '99999999-0000-0000-0000-000000000001'),
    false);
  execute 'reset role';
end $$;
select is(current_setting('cerne.tmp')::int, 1, 'chat_sessions: isolamento positivo — user_x vê a própria linha');

do $$
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000002', true);
  perform set_config('cerne.tmp',
    (select count(*)::text from public.chat_sessions where user_id = '99999999-0000-0000-0000-000000000001'),
    false);
  execute 'reset role';
end $$;
select is(current_setting('cerne.tmp')::int, 0, 'chat_sessions: isolamento negativo — user_y não vê a linha de user_x, sem erro');

do $$
declare
  v_sqlstate text := null;
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000002', true);
  begin
    insert into public.chat_sessions (user_id, persona_snapshot)
    values ('99999999-0000-0000-0000-000000000001', 'empatico');
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  perform set_config('cerne.tmp_sqlstate', coalesce(v_sqlstate, 'NULL'), false);
end $$;
select is(current_setting('cerne.tmp_sqlstate'), '42501', 'chat_sessions: escrita cruzada bloqueada pela RLS');

do $$
declare
  v_sqlstate text := null;
begin
  execute 'set role anon';
  begin
    perform count(*) from public.chat_sessions;
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  perform set_config('cerne.tmp_sqlstate', coalesce(v_sqlstate, 'NULL'), false);
end $$;
select is(current_setting('cerne.tmp_sqlstate'), '42501', 'chat_sessions: anon sem leitura');

select * from finish();
rollback;
