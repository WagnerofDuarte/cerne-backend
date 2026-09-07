-- T-052 — Política de Storage do bucket `exports` (migração 0013, Plano
-- técnico §5: "o caminho do objeto começa com o user_id do requisitante").
-- Mesmo roteiro dos `rls_*.sql` de tabela (Fase 1): isolamento positivo,
-- isolamento negativo, escrita cruzada bloqueada, anon sem leitura — só que
-- em `storage.objects`/`storage.buckets`, não numa tabela de `public`.

set search_path to public, extensions;
begin;
select plan(6);

insert into auth.users (id, email) values
  ('99999999-0000-0000-0000-000000000001', 'pgtap-user-x@cerne.test'),
  ('99999999-0000-0000-0000-000000000002', 'pgtap-user-y@cerne.test');

select ok(
  (select public from storage.buckets where id = 'exports') = false,
  'bucket exports existe e é privado'
);

insert into storage.objects (bucket_id, name, owner) values
  ('exports', '99999999-0000-0000-0000-000000000001/job-1/raw.json', '99999999-0000-0000-0000-000000000001');

-- 2) isolamento positivo — dono lê o próprio objeto.
do $$
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000001', true);
  perform set_config('cerne.tmp',
    (select count(*)::text from storage.objects
      where bucket_id = 'exports'
        and name = '99999999-0000-0000-0000-000000000001/job-1/raw.json'),
    false);
  execute 'reset role';
end $$;
select is(current_setting('cerne.tmp')::int, 1, 'exports: dono enxerga o próprio objeto');

-- 3) isolamento negativo — outro usuário não vê, sem erro (0 linhas).
do $$
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000002', true);
  perform set_config('cerne.tmp',
    (select count(*)::text from storage.objects
      where bucket_id = 'exports'
        and name = '99999999-0000-0000-0000-000000000001/job-1/raw.json'),
    false);
  execute 'reset role';
end $$;
select is(current_setting('cerne.tmp')::int, 0, 'exports: outro usuário não enxerga (0 linhas, não erro)');

-- 4) escrita cruzada bloqueada — user_y não consegue inserir sob o prefixo de user_x.
do $$
declare
  v_sqlstate text := null;
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000002', true);
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('exports', '99999999-0000-0000-0000-000000000001/job-2/raw.json', '99999999-0000-0000-0000-000000000002');
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  perform set_config('cerne.tmp_sqlstate', coalesce(v_sqlstate, 'NULL'), false);
end $$;
select is(current_setting('cerne.tmp_sqlstate'), '42501', 'exports: escrita cruzada bloqueada pela política');

-- 5) dono consegue apagar o próprio objeto.
do $$
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000001', true);
  delete from storage.objects
    where bucket_id = 'exports' and name = '99999999-0000-0000-0000-000000000001/job-1/raw.json';
  execute 'reset role';
end $$;
select is(
  (select count(*)::int from storage.objects where bucket_id = 'exports'),
  0,
  'exports: dono consegue apagar o próprio objeto'
);

-- 6) anon sem leitura (sem GRANT de tabela — mesma postura do resto do projeto).
do $$
declare
  v_sqlstate text := null;
begin
  execute 'set role anon';
  begin
    perform count(*) from storage.objects where bucket_id = 'exports';
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  perform set_config('cerne.tmp_sqlstate', coalesce(v_sqlstate, 'NULL'), false);
end $$;
select is(current_setting('cerne.tmp_sqlstate'), '42501', 'exports: anon sem leitura');

select * from finish();
rollback;
