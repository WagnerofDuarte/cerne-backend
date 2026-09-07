-- T-040 — RPC de busca semântica sobre `entries` (Plano técnico §8.2).
--
-- Lacuna de infraestrutura descoberta implementando (não estava no
-- backlog original, registrada em big-plan.md): o PostgREST/supabase-js
-- não deixa ordenar por uma expressão arbitrária (`embedding <=> $1`) via
-- o construtor de query fluente — só por nome de coluna. Uma função RPC é
-- o jeito de expor essa ordenação sem service_role (regra invólavel nº5).
--
-- SECURITY INVOKER de propósito (não DEFINER, diferente das RPCs de
-- `experiment` na migração 0010): rodando com o papel de quem chamou, a
-- política de SELECT de `entries` (auth.uid() = user_id, FORÇADA — Fase 1)
-- continua valendo por baixo. A função nem recebe `user_id` como
-- parâmetro, de propósito — não há como um cliente pedir os dados de
-- outra pessoa nem por engano.
--
-- Varredura exata, sem índice aproximado (regra nº7) — mesma consulta já
-- validada em `scripts/prove-rf06.ts` (T-024, Fase 1), agora exposta via
-- RPC em vez de conexão direta ao Postgres. Tags embutidas (Seção 8.2)
-- via subconsulta correlacionada com `jsonb_agg` — dispensa uma 2ª
-- viagem da Edge Function ao banco; no volume deste projeto (dezenas de
-- entradas) o custo é desprezível.

create or replace function public.entries_search_by_embedding(
  p_query_embedding extensions.vector(1024),
  p_source text default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_limit int default 20
)
returns table (
  id uuid,
  content text,
  source text,
  chat_message_id uuid,
  occurred_at timestamptz,
  embedding_status text,
  pii_status text,
  pii_spans jsonb,
  media_duration_seconds int,
  created_at timestamptz,
  updated_at timestamptz,
  tags jsonb,
  distance float8
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    e.id,
    e.content,
    e.source,
    e.chat_message_id,
    e.occurred_at,
    e.embedding_status,
    e.pii_status,
    e.pii_spans,
    e.media_duration_seconds,
    e.created_at,
    e.updated_at,
    coalesce(
      (
        select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name)
        from entry_tags et
        join tags t on t.id = et.tag_id
        where et.entry_id = e.id
      ),
      '[]'::jsonb
    ) as tags,
    (e.embedding <=> p_query_embedding) as distance
  from entries e
  where e.embedding_status = 'ready'
    and (p_source is null or e.source = p_source)
    and (p_date_from is null or e.occurred_at >= p_date_from)
    and (p_date_to is null or e.occurred_at <= p_date_to)
  order by e.embedding <=> p_query_embedding, e.id asc
  limit p_limit;
$$;

-- Toda função nova é EXECUTE-por-PUBLIC por padrão (mesma pegadinha
-- documentada na migração 0010) — fechar PUBLIC primeiro, abrir só para
-- authenticated.
revoke execute on function public.entries_search_by_embedding(
  extensions.vector, text, timestamptz, timestamptz, int
) from public;
grant execute on function public.entries_search_by_embedding(
  extensions.vector, text, timestamptz, timestamptz, int
) to authenticated;
