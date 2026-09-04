-- T-016 — Tabela `insights` (Plano técnico §5).
--
-- A UNIQUE sobre (session_id, trigger_type, trigger_key) é o mecanismo do
-- RF08: o handler de POST .../insight tenta inserir e trata o conflito como
-- "retornar o insight existente", nunca gera duas vezes para o mesmo gatilho.

create table public.insights (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.chat_sessions (id) on delete cascade,
  -- denormalizado a partir de chat_sessions.user_id, para a RLS filtrar sem join
  user_id        uuid not null,
  trigger_type   text not null check (trigger_type in ('message_count', 'inactivity')),
  trigger_key    text not null,
  status         text not null check (status in ('generating', 'ready', 'failed', 'dismissed')),
  content        text,
  error_code     text,
  dismissed_at   timestamptz,
  created_at     timestamptz not null default now(),
  constraint insights_session_trigger_uniq unique (session_id, trigger_type, trigger_key)
);
