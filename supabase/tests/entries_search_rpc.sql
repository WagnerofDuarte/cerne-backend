-- T-040 — RPC `entries_search_by_embedding` (migração 0011, Plano técnico
-- §8.2). Cobre: ordena por distância de cosseno ASC, desempate por id ASC
-- quando a distância empata, isolamento por RLS (SECURITY INVOKER — a
-- função nem recebe user_id, quem decide é a política de SELECT),
-- embedding_status != 'ready' fica de fora, filtros source/data (AND),
-- tags embutidas, GRANT restrito a authenticated, p_limit respeitado.

set search_path to public, extensions;
begin;
select plan(10);

insert into auth.users (id, email) values
  ('99999999-1000-0000-0000-000000000001', 'pgtap-search-x@cerne.test'),
  ('99999999-1000-0000-0000-000000000002', 'pgtap-search-y@cerne.test');

insert into public.tags (id, user_id, name) values
  ('99999999-1002-0000-0000-000000000001', '99999999-1000-0000-0000-000000000001', 'trabalho');

-- Vetores de 1024 dimensões, deliberadamente sintéticos: `perto` é
-- idêntico ao vetor de busca (distância 0), `longe` é o oposto (distância
-- máxima) — dá uma ordenação previsível sem depender de embeddings reais.
insert into public.entries (
  id, user_id, content, source, occurred_at, embedding,
  embedding_status, embedding_model, embedding_dim, embedding_input_type
) values
  ('99999999-1003-0000-0000-000000000001', '99999999-1000-0000-0000-000000000001',
   'entrada perto do vetor de busca', 'manual', '2026-09-05T00:00:00Z',
   array_fill(1.0::float4, array[1024])::extensions.vector,
   'ready', 'voyage-4', 1024, 'document'),
  ('99999999-1003-0000-0000-000000000002', '99999999-1000-0000-0000-000000000001',
   'entrada longe do vetor de busca', 'audio', '2026-09-06T00:00:00Z',
   array_fill(-1.0::float4, array[1024])::extensions.vector,
   'ready', 'voyage-4', 1024, 'document'),
  ('99999999-1003-0000-0000-000000000003', '99999999-1000-0000-0000-000000000001',
   'empate a (id menor)', 'manual', '2026-09-07T00:00:00Z',
   array_fill(0.5::float4, array[1024])::extensions.vector,
   'ready', 'voyage-4', 1024, 'document'),
  ('99999999-1003-0000-0000-000000000004', '99999999-1000-0000-0000-000000000001',
   'empate b (id maior)', 'manual', '2026-09-07T00:00:00Z',
   array_fill(0.5::float4, array[1024])::extensions.vector,
   'ready', 'voyage-4', 1024, 'document'),
  ('99999999-1003-0000-0000-000000000005', '99999999-1000-0000-0000-000000000001',
   'ainda processando, não deveria aparecer', 'manual', '2026-09-08T00:00:00Z',
   array_fill(1.0::float4, array[1024])::extensions.vector,
   'pending', null, null, null),
  ('99999999-1003-0000-0000-000000000006', '99999999-1000-0000-0000-000000000002',
   'entrada de outro usuário, nunca deveria aparecer pra user x', 'manual', '2026-09-05T00:00:00Z',
   array_fill(1.0::float4, array[1024])::extensions.vector,
   'ready', 'voyage-4', 1024, 'document');

insert into public.entry_tags (entry_id, tag_id, user_id) values
  ('99999999-1003-0000-0000-000000000001', '99999999-1002-0000-0000-000000000001',
   '99999999-1000-0000-0000-000000000001');

-- GRANT/REVOKE (checáveis sem trocar de papel).
select ok(
  not has_function_privilege('public', 'public.entries_search_by_embedding(extensions.vector, text, timestamptz, timestamptz, int)', 'execute'),
  'entries_search_by_embedding: PUBLIC sem EXECUTE'
);
select ok(
  has_function_privilege('authenticated', 'public.entries_search_by_embedding(extensions.vector, text, timestamptz, timestamptz, int)', 'execute'),
  'entries_search_by_embedding: authenticated com EXECUTE'
);

-- As consultas de verdade rodam como `authenticated` (SECURITY INVOKER —
-- a RLS de `entries`/`entry_tags`/`tags` precisa estar valendo). pgTAP
-- fica inacessível depois da troca de papel (mesma pegadinha documentada
-- no T-023) — captura em tabela temporária, troca de volta, só então
-- assevera.
do $$
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', '99999999-1000-0000-0000-000000000001', true);

  create temp table tmp_ordem as
    select id, distance, row_number() over () as rn
    from public.entries_search_by_embedding(
      array_fill(1.0::float4, array[1024])::extensions.vector, null, null, null, 20
    );

  create temp table tmp_filtro_source as
    select id from public.entries_search_by_embedding(
      array_fill(1.0::float4, array[1024])::extensions.vector, 'audio', null, null, 20
    );

  create temp table tmp_filtro_data as
    select id from public.entries_search_by_embedding(
      array_fill(1.0::float4, array[1024])::extensions.vector,
      null, '2026-09-06T00:00:00Z'::timestamptz, '2026-09-06T23:59:59Z'::timestamptz, 20
    );

  create temp table tmp_tags as
    select tags from public.entries_search_by_embedding(
      array_fill(1.0::float4, array[1024])::extensions.vector, null, null, null, 20
    ) where id = '99999999-1003-0000-0000-000000000001';

  create temp table tmp_limit as
    select count(*)::int as n from public.entries_search_by_embedding(
      array_fill(1.0::float4, array[1024])::extensions.vector, null, null, null, 1
    );

  execute 'reset role';
end $$;

select is(
  (select array_agg(id order by rn) from tmp_ordem
   where id in ('99999999-1003-0000-0000-000000000001', '99999999-1003-0000-0000-000000000002')),
  array['99999999-1003-0000-0000-000000000001', '99999999-1003-0000-0000-000000000002']::uuid[],
  'ordena por distância de cosseno ASC — mais perto primeiro'
);

select is(
  (select array_agg(id order by rn) from tmp_ordem
   where id in ('99999999-1003-0000-0000-000000000003', '99999999-1003-0000-0000-000000000004')),
  array['99999999-1003-0000-0000-000000000003', '99999999-1003-0000-0000-000000000004']::uuid[],
  'desempate por id ASC quando a distância empata'
);

select is(
  (select count(*)::int from tmp_ordem where id = '99999999-1003-0000-0000-000000000005'),
  0,
  'embedding_status != ready fica de fora da busca'
);

select is(
  (select count(*)::int from tmp_ordem where id = '99999999-1003-0000-0000-000000000006'),
  0,
  'isolamento por RLS — entrada de outro usuário nunca aparece (SECURITY INVOKER)'
);

select is(
  (select array_agg(id) from tmp_filtro_source),
  array['99999999-1003-0000-0000-000000000002']::uuid[],
  'filtro p_source combina com os demais (AND)'
);

select is(
  (select array_agg(id) from tmp_filtro_data),
  array['99999999-1003-0000-0000-000000000002']::uuid[],
  'filtro p_date_from/p_date_to restringe por occurred_at'
);

select is(
  (select tags from tmp_tags),
  '[{"id": "99999999-1002-0000-0000-000000000001", "name": "trabalho"}]'::jsonb,
  'tags embutidas via jsonb_agg — mesmo formato de {id, name} de GET /entries'
);

select is(
  (select n from tmp_limit),
  1,
  'p_limit é respeitado'
);

select * from finish();
rollback;
