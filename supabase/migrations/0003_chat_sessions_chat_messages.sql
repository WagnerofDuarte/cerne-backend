-- T-013 — Tabelas `chat_sessions` e `chat_messages` (Plano técnico §5).
--
-- Criadas antes de `entries` porque `entries.chat_message_id` referencia
-- `chat_messages` (nota de reordenação do plano técnico §5, resolvida no
-- big-plan.md).

create table public.chat_sessions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references public.profiles (id) on delete cascade,
  title                  text not null default '',
  persona_snapshot       text not null
                           check (persona_snapshot in ('analitico', 'empatico', 'socratico')),
  user_message_count     integer not null default 0,
  last_user_message_at   timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table public.chat_messages (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.chat_sessions (id) on delete cascade,
  -- denormalizado a partir de chat_sessions.user_id, para a RLS filtrar sem join
  user_id       uuid not null,
  role          text not null check (role in ('user', 'assistant')),
  content       text not null default '',
  seq           integer not null,
  status        text not null default 'complete'
                  check (status in ('streaming', 'complete', 'failed')),
  retry_count   integer not null default 0,
  created_at    timestamptz not null default now(),
  constraint chat_messages_session_seq_uniq unique (session_id, seq)
);

-- Trigger: ao inserir mensagem do usuário, incrementa o contador da sessão
-- e atualiza o timestamp da última mensagem do usuário. Só mexe nesses dois
-- campos — o resto da sessão (título, updated_at) é responsabilidade do
-- endpoint (Fase 4).
create or replace function public.bump_chat_session_on_user_message()
returns trigger
language plpgsql
as $$
begin
  if new.role = 'user' then
    update public.chat_sessions
    set user_message_count = user_message_count + 1,
        last_user_message_at = new.created_at
    where id = new.session_id;
  end if;
  return new;
end;
$$;

create trigger chat_messages_bump_session
  after insert on public.chat_messages
  for each row execute function public.bump_chat_session_on_user_message();
