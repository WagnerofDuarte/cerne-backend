-- T-023 — RLS de `profiles` (Plano técnico §11.1).
-- Cobre: isolamento positivo, isolamento negativo (zero linhas, não erro),
-- escrita cruzada bloqueada, RLS forçada, anon sem leitura.
--
-- `profiles` usa `id` como dono (não `user_id`). A linha de cada usuário já
-- existe assim que `auth.users` é inserido (trigger on_auth_user_created),
-- então "escrita cruzada" aqui é testada como UPDATE (um INSERT bateria na
-- PK que o trigger já ocupou) — a política de RLS barra silenciosamente
-- (0 linhas afetadas), não lança erro.

set search_path to public, extensions;
begin;
select plan(6);

-- Fixtures: dois usuários de teste fora do namespace do seed.
insert into auth.users (id, email) values
  ('99999999-0000-0000-0000-000000000001', 'pgtap-user-x@cerne.test'),
  ('99999999-0000-0000-0000-000000000002', 'pgtap-user-y@cerne.test');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profiles: RLS habilitada'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profiles: RLS forçada'
);

-- isolamento positivo: user_x vê a própria linha
do $$
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000001', true);
  perform set_config('cerne.tmp',
    (select count(*)::text from public.profiles where id = '99999999-0000-0000-0000-000000000001'),
    false);
  execute 'reset role';
end $$;
select is(current_setting('cerne.tmp')::int, 1, 'profiles: isolamento positivo — user_x vê a própria linha');

-- isolamento negativo: user_y não vê a linha de user_x (zero linhas, não erro)
do $$
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000002', true);
  perform set_config('cerne.tmp',
    (select count(*)::text from public.profiles where id = '99999999-0000-0000-0000-000000000001'),
    false);
  execute 'reset role';
end $$;
select is(current_setting('cerne.tmp')::int, 0, 'profiles: isolamento negativo — user_y não vê a linha de user_x, sem erro');

-- escrita cruzada bloqueada: user_y tenta alterar a linha de user_x (UPDATE — 0 linhas, não erro)
do $$
declare
  v_rows int;
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000002', true);

  update public.profiles set display_name = 'invasao'
  where id = '99999999-0000-0000-0000-000000000001';
  get diagnostics v_rows = row_count;

  execute 'reset role';
  perform set_config('cerne.tmp', v_rows::text, false);
end $$;
select is(current_setting('cerne.tmp')::int, 0, 'profiles: escrita cruzada bloqueada — UPDATE de user_y na linha de user_x afeta 0 linhas');

-- anon sem leitura
do $$
declare
  v_sqlstate text := null;
begin
  execute 'set role anon';
  begin
    perform count(*) from public.profiles;
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  perform set_config('cerne.tmp_sqlstate', coalesce(v_sqlstate, 'NULL'), false);
end $$;
select is(current_setting('cerne.tmp_sqlstate'), '42501', 'profiles: anon sem leitura');

select * from finish();
rollback;
