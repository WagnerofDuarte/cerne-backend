-- T-059 — `delete_own_account()` (migração 0017). Decisão tomada com o
-- Wagner antes de implementar (ver `big-plan.md`, Fase 5): função
-- `SECURITY DEFINER` que só apaga o PRÓPRIO `auth.users.id` de quem chamou,
-- para nunca precisar de `service_role` numa Edge Function de app (regra
-- nº5). Este arquivo cobre: a cascata completa via a RPC (não via `delete
-- from auth.users` direto, diferente de `cascade_delete.sql`/T-023), a
-- trava de posse (só a própria conta), e as duas negações (anon, sem
-- sessão).

set search_path to public, extensions;
begin;
select plan(5);

insert into auth.users (id, email) values
  ('99999999-0000-0000-0000-000000000001', 'pgtap-user-x@cerne.test'),
  ('99999999-0000-0000-0000-000000000002', 'pgtap-user-y@cerne.test');

insert into public.tags (id, user_id, name) values
  ('99999999-0000-0000-0001-000000000001', '99999999-0000-0000-0000-000000000001', 'fixture');
insert into public.chat_sessions (id, user_id, persona_snapshot) values
  ('99999999-0000-0000-0002-000000000001', '99999999-0000-0000-0000-000000000001', 'empatico');
insert into public.chat_messages (id, session_id, user_id, role, content, seq) values
  ('99999999-0000-0000-0003-000000000001', '99999999-0000-0000-0002-000000000001', '99999999-0000-0000-0000-000000000001', 'user', 'fixture', 1);
insert into public.entries (id, user_id, content, source, chat_message_id) values
  ('99999999-0000-0000-0004-000000000001', '99999999-0000-0000-0000-000000000001', 'fixture', 'chat', '99999999-0000-0000-0003-000000000001');
insert into public.export_jobs (user_id, status, narrative_status) values
  ('99999999-0000-0000-0000-000000000001', 'pending', 'pending');

-- 1) anon não consegue chamar.
do $$
declare
  v_sqlstate text := null;
begin
  execute 'set role anon';
  begin
    perform public.delete_own_account();
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  perform set_config('cerne.tmp_sqlstate', coalesce(v_sqlstate, 'NULL'), false);
end $$;
select is(current_setting('cerne.tmp_sqlstate'), '42501', 'delete_own_account: anon é negado');

-- 2) authenticated sem claim `sub` (sem sessão real) — recusado explicitamente, não apaga nada à toa.
do $$
declare
  v_sqlstate text := null;
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.delete_own_account();
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  perform set_config('cerne.tmp_sqlstate', coalesce(v_sqlstate, 'NULL'), false);
end $$;
select is(current_setting('cerne.tmp_sqlstate'), 'P0001', 'delete_own_account: sem sessão autenticada, recusado');

-- 3) chamar como user_y não afeta user_x (só apaga a PRÓPRIA conta — sem parâmetro solto).
do $$
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000002', true);
  perform public.delete_own_account();
  execute 'reset role';
end $$;
select is(
  (select count(*)::int from public.profiles where id = '99999999-0000-0000-0000-000000000001'),
  1,
  'delete_own_account: chamado por user_y não apaga a conta de user_x'
);
select is(
  (select count(*)::int from auth.users where id = '99999999-0000-0000-0000-000000000002'),
  0,
  'delete_own_account: user_y apagou a própria conta'
);

-- 4) chamar como o próprio dono apaga tudo em cascata — mesma cobertura de cascade_delete.sql, via a RPC.
do $$
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000001', true);
  perform public.delete_own_account();
  execute 'reset role';
end $$;
select ok(
  (select count(*) from public.profiles where id = '99999999-0000-0000-0000-000000000001') = 0
  and (select count(*) from public.entries where user_id = '99999999-0000-0000-0000-000000000001') = 0
  and (select count(*) from public.tags where user_id = '99999999-0000-0000-0000-000000000001') = 0
  and (select count(*) from public.chat_sessions where user_id = '99999999-0000-0000-0000-000000000001') = 0
  and (select count(*) from public.chat_messages where user_id = '99999999-0000-0000-0000-000000000001') = 0
  and (select count(*) from public.export_jobs where user_id = '99999999-0000-0000-0000-000000000001') = 0
  and (select count(*) from auth.users where id = '99999999-0000-0000-0000-000000000001') = 0,
  'delete_own_account: dono apaga a própria conta e cascata completa, sem órfão'
);

select * from finish();
rollback;
