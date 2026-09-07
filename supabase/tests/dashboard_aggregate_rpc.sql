-- T-056 — RPC `dashboard_aggregate_counts` (migração 0015, Plano técnico
-- §8.5). Cobre: agregação correta por dia/origem, filtro de período (nulo =
-- sem limite), isolamento por RLS (SECURITY INVOKER, sem parâmetro user_id
-- — mesma postura de `entries_search_by_embedding`, migração 0011),
-- desempate determinístico (`order by 1 asc, 2 asc`), zero entradas = zero
-- linhas (nunca erro).

set search_path to public, extensions;
begin;
select plan(6);

insert into auth.users (id, email) values
  ('99999999-0000-0000-0000-000000000001', 'pgtap-user-x@cerne.test'),
  ('99999999-0000-0000-0000-000000000002', 'pgtap-user-y@cerne.test');

insert into public.entries (id, user_id, content, source, occurred_at) values
  ('77777777-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001', 'a', 'manual', '2026-09-01T10:00:00Z'),
  ('77777777-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000001', 'b', 'manual', '2026-09-01T11:00:00Z'),
  ('77777777-0000-0000-0000-000000000003', '99999999-0000-0000-0000-000000000001', 'c', 'audio',  '2026-09-01T12:00:00Z'),
  ('77777777-0000-0000-0000-000000000004', '99999999-0000-0000-0000-000000000001', 'd', 'photo',  '2026-09-03T09:00:00Z'),
  ('77777777-0000-0000-0000-000000000005', '99999999-0000-0000-0000-000000000002', 'e', 'manual', '2026-09-01T10:00:00Z');

-- 1) agregação correta: dia 1 tem manual=2, audio=1; dia 3 tem photo=1 — só da conta X.
do $$
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000001', true);
  perform set_config('cerne.tmp',
    (select count(*)::text from public.dashboard_aggregate_counts(null, null)),
    false);
  execute 'reset role';
end $$;
select is(current_setting('cerne.tmp')::int, 3, 'dashboard_aggregate_counts: 3 linhas (2026-09-01/manual, 2026-09-01/audio, 2026-09-03/photo)');

do $$
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000001', true);
  perform set_config('cerne.tmp',
    (select entry_count::text from public.dashboard_aggregate_counts(null, null)
      where bucket_date = '2026-09-01' and source = 'manual'),
    false);
  execute 'reset role';
end $$;
select is(current_setting('cerne.tmp')::int, 2, 'dashboard_aggregate_counts: 2 entradas manual em 2026-09-01');

-- 2) isolamento — RLS ainda vale, sem user_id como parâmetro (a função não recebe nenhum).
do $$
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000002', true);
  perform set_config('cerne.tmp',
    (select count(*)::text from public.dashboard_aggregate_counts(null, null)),
    false);
  execute 'reset role';
end $$;
select is(current_setting('cerne.tmp')::int, 1, 'dashboard_aggregate_counts: conta Y só vê a própria linha');

-- 3) filtro de período — só o dia 3 em diante.
do $$
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000001', true);
  perform set_config('cerne.tmp',
    (select count(*)::text from public.dashboard_aggregate_counts('2026-09-02T00:00:00Z', null)),
    false);
  execute 'reset role';
end $$;
select is(current_setting('cerne.tmp')::int, 1, 'dashboard_aggregate_counts: period_start filtra corretamente');

-- 4) zero entradas no período — zero linhas, não erro.
do $$
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000001', true);
  perform set_config('cerne.tmp',
    (select count(*)::text from public.dashboard_aggregate_counts('2030-01-01T00:00:00Z', null)),
    false);
  execute 'reset role';
end $$;
select is(current_setting('cerne.tmp')::int, 0, 'dashboard_aggregate_counts: período vazio devolve zero linhas, sem erro');

-- 5) anon não consegue chamar.
do $$
declare
  v_sqlstate text := null;
begin
  execute 'set role anon';
  begin
    perform count(*) from public.dashboard_aggregate_counts(null, null);
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  perform set_config('cerne.tmp_sqlstate', coalesce(v_sqlstate, 'NULL'), false);
end $$;
select is(current_setting('cerne.tmp_sqlstate'), '42501', 'dashboard_aggregate_counts: anon é negado');

select * from finish();
rollback;
