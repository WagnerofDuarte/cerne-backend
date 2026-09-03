-- T-023 — RLS de `entry_tags` (Plano técnico §11.1).
-- Cobre: isolamento positivo, isolamento negativo (zero linhas, não erro),
-- escrita cruzada bloqueada, RLS forçada, anon sem leitura.
--
-- entry_tags tem PK composta (entry_id, tag_id) — a fixture cria duas
-- entradas para user_x (uma já associada à tag na linha de base, outra
-- livre para a tentativa de escrita cruzada não colidir com a PK).

set search_path to public, extensions;
begin;
select plan(6);

insert into auth.users (id, email) values
  ('99999999-0000-0000-0000-000000000001', 'pgtap-user-x@cerne.test'),
  ('99999999-0000-0000-0000-000000000002', 'pgtap-user-y@cerne.test');

insert into public.tags (id, user_id, name) values
  ('99999999-0000-0000-0001-000000000001', '99999999-0000-0000-0000-000000000001', 'fixture-pgtap');

insert into public.entries (id, user_id, content, source) values
  ('99999999-0000-0000-0004-000000000001', '99999999-0000-0000-0000-000000000001', 'entrada 1', 'manual'),
  ('99999999-0000-0000-0004-000000000002', '99999999-0000-0000-0000-000000000001', 'entrada 2', 'manual');

insert into public.entry_tags (entry_id, tag_id, user_id) values
  ('99999999-0000-0000-0004-000000000001', '99999999-0000-0000-0001-000000000001', '99999999-0000-0000-0000-000000000001');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.entry_tags'::regclass),
  'entry_tags: RLS habilitada'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.entry_tags'::regclass),
  'entry_tags: RLS forçada'
);

do $$
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000001', true);
  perform set_config('cerne.tmp',
    (select count(*)::text from public.entry_tags where user_id = '99999999-0000-0000-0000-000000000001'),
    false);
  execute 'reset role';
end $$;
select is(current_setting('cerne.tmp')::int, 1, 'entry_tags: isolamento positivo — user_x vê a própria linha');

do $$
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000002', true);
  perform set_config('cerne.tmp',
    (select count(*)::text from public.entry_tags where user_id = '99999999-0000-0000-0000-000000000001'),
    false);
  execute 'reset role';
end $$;
select is(current_setting('cerne.tmp')::int, 0, 'entry_tags: isolamento negativo — user_y não vê a linha de user_x, sem erro');

do $$
declare
  v_sqlstate text := null;
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000002', true);
  begin
    insert into public.entry_tags (entry_id, tag_id, user_id)
    values ('99999999-0000-0000-0004-000000000002', '99999999-0000-0000-0001-000000000001', '99999999-0000-0000-0000-000000000001');
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  perform set_config('cerne.tmp_sqlstate', coalesce(v_sqlstate, 'NULL'), false);
end $$;
select is(current_setting('cerne.tmp_sqlstate'), '42501', 'entry_tags: escrita cruzada bloqueada pela RLS');

do $$
declare
  v_sqlstate text := null;
begin
  execute 'set role anon';
  begin
    perform count(*) from public.entry_tags;
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  perform set_config('cerne.tmp_sqlstate', coalesce(v_sqlstate, 'NULL'), false);
end $$;
select is(current_setting('cerne.tmp_sqlstate'), '42501', 'entry_tags: anon sem leitura');

select * from finish();
rollback;
