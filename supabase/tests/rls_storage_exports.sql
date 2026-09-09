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

-- 5) política de DELETE existe e é restrita ao dono — NÃO exercitada via
-- DELETE direto por SQL: achado real rodando contra o Supabase local de
-- verdade (Wagner, T-059v) — `storage.objects` tem um trigger próprio do
-- Supabase (`storage.protect_delete()`) que barra QUALQUER delete direto
-- por SQL, mesmo do dono, mesmo sem RLS no caminho ("Direct deletion from
-- storage tables is not allowed. Use the Storage API instead." — proteção
-- contra perda acidental de objeto órfão, existe para todo mundo, não é
-- específico deste projeto). A aplicação real (`account-delete/handler.ts`)
-- já usa a Storage API (`storage.from('exports').remove(...)`), nunca SQL
-- direto — então isso nunca foi um problema pro código, só para este teste,
-- que tentava um atalho que o próprio Supabase não permite. Prova possível
-- por pgTAP: a política existe, é `FOR DELETE`, e está restrita a `authenticated`.
select ok(
  exists(
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'exports_delete_own' and cmd = 'DELETE'
      and roles = array['authenticated']::name[]
  ),
  'exports: política de DELETE existe, é FOR DELETE e restrita a authenticated'
);

-- 6) anon sem leitura — achado real rodando contra o Supabase de verdade
-- (Wagner, T-059v): diferente do resto das tabelas deste projeto (schema
-- `public`, totalmente nosso), `storage.objects` já vem com GRANT de
-- leitura para `anon` de fábrica, dado pelo próprio serviço de Storage do
-- Supabase — o `revoke all ... from anon` da migração 0013 não tem como
-- garantir que isso desapareça (não é uma tabela que este projeto é dono
-- desde o início). Confirmado empiricamente que os DOIS resultados
-- acontecem dependendo do ambiente: no Supabase real, a consulta funciona
-- e devolve zero linhas (RLS sem política que libere `anon` — mesmo
-- padrão de "isolamento negativo" dos testes 2/3); num Postgres genérico
-- onde o REVOKE não é atropelado por nenhum serviço externo, a mesma
-- consulta dá erro de permissão. Os dois são igualmente seguros (`anon`
-- não enxerga o objeto de ninguém em nenhum dos dois) — o teste aceita
-- qualquer um dos dois, em vez de fixar uma suposição sobre qual ambiente
-- está rodando.
do $$
declare
  v_sqlstate text := null;
  v_count text := null;
begin
  execute 'set role anon';
  begin
    select count(*)::text into v_count from storage.objects where bucket_id = 'exports';
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  perform set_config('cerne.tmp_sqlstate', coalesce(v_sqlstate, 'NULL'), false);
  perform set_config('cerne.tmp_count', coalesce(v_count, 'NULL'), false);
end $$;
select ok(
  current_setting('cerne.tmp_sqlstate') = '42501'
  or (current_setting('cerne.tmp_sqlstate') = 'NULL' and current_setting('cerne.tmp_count') = '0'),
  'exports: anon não enxerga nenhum objeto (erro de permissão OU zero linhas, a depender do ambiente — ver comentário acima)'
);

select * from finish();
rollback;
