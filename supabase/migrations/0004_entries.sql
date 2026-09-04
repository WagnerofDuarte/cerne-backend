-- T-014 — Tabela `entries` (Plano técnico §5).

create table public.entries (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references public.profiles (id) on delete cascade,
  content                  text not null check (char_length(content) between 1 and 20000),
  source                   text not null check (source in ('manual', 'audio', 'photo', 'chat')),
  chat_message_id          uuid references public.chat_messages (id) on delete set null,
  occurred_at              timestamptz not null default now(),
  embedding                extensions.vector(1024),
  embedding_model          text,
  embedding_dim            integer,
  embedding_input_type     text,
  embedding_status         text not null default 'pending'
                             check (embedding_status in ('pending', 'ready', 'failed')),
  pii_status               text not null default 'pending'
                             check (pii_status in ('pending', 'clean', 'flagged', 'failed')),
  pii_spans                jsonb not null default '[]'::jsonb,
  media_duration_seconds   integer,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  -- source='chat' <=> chat_message_id presente
  constraint entries_source_chat_message_coherence
    check ((source = 'chat') = (chat_message_id is not null))
);

-- Índice de timeline: GET /entries pagina por (user_id, occurred_at DESC, id ASC).
create index entries_user_occurred_idx
  on public.entries (user_id, occurred_at desc, id asc);

-- Índice único parcial de idempotência do RF10: duas tentativas de POST /entries
-- com o mesmo chatMessageId para o mesmo usuário colidem aqui, nunca em outro
-- lugar. Só se aplica quando chat_message_id não é nulo.
create unique index entries_chat_message_uniq
  on public.entries (user_id, chat_message_id)
  where chat_message_id is not null;

-- Trigger bump_server_revision: após INSERT ou UPDATE em entries, incrementa
-- profiles.server_revision do dono da entrada (usado no X-Data-Version).
create or replace function public.bump_server_revision()
returns trigger
language plpgsql
as $$
begin
  update public.profiles
  set server_revision = server_revision + 1
  where id = new.user_id;
  return new;
end;
$$;

create trigger entries_bump_server_revision
  after insert or update on public.entries
  for each row execute function public.bump_server_revision();
