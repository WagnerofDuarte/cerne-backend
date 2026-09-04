-- T-029/T-030 — Funções RPC de `experiment.*` (migração 0010, Plano
-- técnico §7). `authenticated` consegue chamar as 3 funções
-- (log_fault_injection, replay_cache_lookup, replay_cache_store) sem ter
-- SELECT/INSERT direto nas tabelas — isolamento negativo das tabelas em
-- si já é coberto por `rls_experiment.sql` (T-023); este arquivo cobre a
-- superfície nova: as funções em `public.experiment_*` e o comportamento
-- delas (miss/hit/hit_count, primeira gravação vence).

set search_path to public, extensions;
begin;
select plan(10);

-- 1) authenticated consegue chamar log_fault_injection, e a linha é gravada.
do $$
begin
  execute 'set role authenticated';
  perform public.experiment_log_fault_injection('req-pgtap-1', '/entries', 'timeout');
  execute 'reset role';
end $$;
select is(
  (select count(*)::int from experiment.fault_injection_log where request_id = 'req-pgtap-1'),
  1,
  'authenticated: log_fault_injection grava a linha'
);

-- 2) anon não consegue chamar log_fault_injection.
do $$
declare
  v_sqlstate text := null;
begin
  execute 'set role anon';
  begin
    perform public.experiment_log_fault_injection('req-pgtap-2', '/entries', 'timeout');
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  perform set_config('cerne.tmp_1', coalesce(v_sqlstate, 'NULL'), false);
end $$;
select is(current_setting('cerne.tmp_1'), '42501', 'anon: log_fault_injection é negado');

-- 3) replay_cache_lookup em cache_key inexistente: 0 linhas (miss), não erro.
do $$
declare
  v_count int;
begin
  execute 'set role authenticated';
  select count(*) into v_count from public.experiment_replay_cache_lookup('pgtap-miss-key');
  execute 'reset role';
  perform set_config('cerne.tmp_2', v_count::text, false);
end $$;
select is(current_setting('cerne.tmp_2'), '0', 'authenticated: lookup em cache_key inexistente é miss (0 linhas)');

-- 4) replay_cache_store grava; lookup seguinte é hit com hit_count=1 e devolve a resposta gravada.
do $$
declare
  v_response text;
  v_hits int;
begin
  execute 'set role authenticated';
  perform public.experiment_replay_cache_store(
    'pgtap-key-1', 'pii', 'anthropic', 'haiku-4.5', 'v1', '{"text":"x"}'::jsonb, '{"flagged":false}'::jsonb
  );
  select response::text, hit_count into v_response, v_hits
    from public.experiment_replay_cache_lookup('pgtap-key-1');
  execute 'reset role';
  perform set_config('cerne.tmp_3', v_response, false);
  perform set_config('cerne.tmp_4', v_hits::text, false);
end $$;
select is(current_setting('cerne.tmp_3'), '{"flagged": false}', 'authenticated: lookup depois do store devolve a resposta gravada');
select is(current_setting('cerne.tmp_4'), '1', 'authenticated: 1a leitura em hit incrementa hit_count para 1');

-- 5) segunda leitura incrementa hit_count de novo (2) — confirma que é atômico por chamada.
do $$
declare
  v_hits int;
begin
  execute 'set role authenticated';
  select hit_count into v_hits from public.experiment_replay_cache_lookup('pgtap-key-1');
  execute 'reset role';
  perform set_config('cerne.tmp_5', v_hits::text, false);
end $$;
select is(current_setting('cerne.tmp_5'), '2', 'authenticated: 2a leitura incrementa hit_count para 2');

-- 6) segunda gravação com a mesma cache_key não sobrescreve (on conflict do nothing — primeira grava vence).
do $$
begin
  execute 'set role authenticated';
  perform public.experiment_replay_cache_store(
    'pgtap-key-1', 'pii', 'anthropic', 'haiku-4.5', 'v1', '{"text":"x"}'::jsonb, '{"flagged":true}'::jsonb
  );
  execute 'reset role';
end $$;
select is(
  (select response->>'flagged' from experiment.ai_replay_cache where cache_key = 'pgtap-key-1'),
  'false',
  'primeira gravação vence — segunda com a mesma cache_key não sobrescreve'
);

-- 7) anon não consegue chamar replay_cache_lookup.
do $$
declare
  v_sqlstate text := null;
begin
  execute 'set role anon';
  begin
    perform count(*) from public.experiment_replay_cache_lookup('qualquer');
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  perform set_config('cerne.tmp_6', coalesce(v_sqlstate, 'NULL'), false);
end $$;
select is(current_setting('cerne.tmp_6'), '42501', 'anon: replay_cache_lookup é negado');

-- 8) anon não consegue chamar replay_cache_store.
do $$
declare
  v_sqlstate text := null;
begin
  execute 'set role anon';
  begin
    perform public.experiment_replay_cache_store(
      'x', 'pii', 'anthropic', 'haiku-4.5', 'v1', '{}'::jsonb, '{}'::jsonb
    );
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  perform set_config('cerne.tmp_7', coalesce(v_sqlstate, 'NULL'), false);
end $$;
select is(current_setting('cerne.tmp_7'), '42501', 'anon: replay_cache_store é negado');

-- 9) authenticated continua sem SELECT direto na tabela — a 0010 não afrouxou a trava da 0008.
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
  perform set_config('cerne.tmp_8', coalesce(v_sqlstate, 'NULL'), false);
end $$;
select is(current_setting('cerne.tmp_8'), '42501', 'authenticated: ainda sem SELECT direto em ai_replay_cache');

select * from finish();
rollback;
