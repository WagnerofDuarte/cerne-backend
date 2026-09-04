-- T-015 — Tabelas `tags` e `entry_tags` (Plano técnico §5).
--
-- Populadas apenas pelo seed (supabase/seed/seed.sql, T-022). Nenhum
-- endpoint da API escreve nelas.

create table public.tags (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  name         text not null,
  created_at   timestamptz not null default now()
);

-- UNIQUE sobre (user_id, lower(name)) é uma expressão — precisa de índice,
-- não de constraint de tabela.
create unique index tags_user_lower_name_uniq
  on public.tags (user_id, lower(name));

create table public.entry_tags (
  entry_id   uuid not null references public.entries (id) on delete cascade,
  tag_id     uuid not null references public.tags (id) on delete cascade,
  -- denormalizado a partir de tags.user_id / entries.user_id, para a RLS filtrar sem join
  user_id    uuid not null,
  primary key (entry_id, tag_id)
);
