-- T-056 — RPC de agregação do dashboard (Plano técnico §8.5: "buckets:
-- [{ date, count, sources }], totals").
--
-- Mesma descoberta real do T-040 (migração 0011): o PostgREST não faz
-- `GROUP BY` via construtor de query fluente, só filtro/ordenação simples —
-- então a agregação por dia/origem precisa de uma função dedicada.
-- `SECURITY INVOKER` (não `DEFINER`, diferente das RPCs de `experiment`):
-- roda com o papel de quem chamou, a RLS de `entries` (Fase 1) continua
-- valendo por baixo, e a função nem recebe `user_id` como parâmetro — mesma
-- postura de `entries_search_by_embedding` (migração 0011).
--
-- `p_period_start`/`p_period_end` nulos = sem limite inferior/superior
-- (§8.5: período `all`). Devolve uma linha por combinação
-- (dia, origem) que tiver pelo menos 1 entrada — dias/origens sem entrada
-- simplesmente não aparecem; o handler (`dashboard-aggregate-get`) monta
-- `buckets`/`totals` a partir disso, e zero linhas vira `buckets: []`
-- (nunca erro — "sempre 200", §8.5).
create or replace function public.dashboard_aggregate_counts(
  p_period_start timestamptz,
  p_period_end timestamptz
)
returns table (bucket_date date, source text, entry_count bigint)
language sql
security invoker
stable
set search_path = public, extensions
as $$
  select
    occurred_at::date as bucket_date,
    source,
    count(*) as entry_count
  from entries
  where (p_period_start is null or occurred_at >= p_period_start)
    and (p_period_end is null or occurred_at < p_period_end)
  group by 1, 2
  order by 1 asc, 2 asc;
$$;

revoke all on function public.dashboard_aggregate_counts(timestamptz, timestamptz) from public;
grant execute on function public.dashboard_aggregate_counts(timestamptz, timestamptz) to authenticated;
