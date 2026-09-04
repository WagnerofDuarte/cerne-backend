-- T-023 — constraints.sql (Plano técnico §11.1).
-- Cobre: índice de idempotência do RF10; UNIQUE de insight; CHECK de
-- coerência source/chat_message_id; UNIQUE de (session_id, seq).
--
-- Roda inteiramente como o role de conexão do teste (superuser local) —
-- CHECK/UNIQUE constraints não são bypassadas por privilégio, então não
-- precisa da troca de role usada nos arquivos de RLS.

set search_path to public, extensions;
begin;
select plan(5);

insert into auth.users (id, email) values
  ('99999999-0000-0000-0000-000000000001', 'pgtap-user-x@cerne.test');

insert into public.chat_sessions (id, user_id, persona_snapshot) values
  ('99999999-0000-0000-0002-000000000001', '99999999-0000-0000-0000-000000000001', 'empatico');

insert into public.chat_messages (id, session_id, user_id, role, content, seq) values
  ('99999999-0000-0000-0003-000000000001', '99999999-0000-0000-0002-000000000001', '99999999-0000-0000-0000-000000000001', 'user', 'fixture', 1),
  ('99999999-0000-0000-0003-000000000002', '99999999-0000-0000-0002-000000000001', '99999999-0000-0000-0000-000000000001', 'assistant', 'fixture 2', 2);

-- índice de idempotência do RF10: (user_id, chat_message_id) único quando não nulo
insert into public.entries (user_id, content, source, chat_message_id) values
  ('99999999-0000-0000-0000-000000000001', 'via chat', 'chat', '99999999-0000-0000-0003-000000000001');

select throws_ok(
  $$ insert into public.entries (user_id, content, source, chat_message_id)
     values ('99999999-0000-0000-0000-000000000001', 'via chat de novo', 'chat', '99999999-0000-0000-0003-000000000001') $$,
  23505, null,
  'entries_chat_message_uniq recusa o segundo POST com o mesmo chatMessageId (RF10)'
);

-- UNIQUE de insight: (session_id, trigger_type, trigger_key)
insert into public.insights (session_id, user_id, trigger_type, trigger_key, status) values
  ('99999999-0000-0000-0002-000000000001', '99999999-0000-0000-0000-000000000001', 'message_count', '1', 'ready');

select throws_ok(
  $$ insert into public.insights (session_id, user_id, trigger_type, trigger_key, status)
     values ('99999999-0000-0000-0002-000000000001', '99999999-0000-0000-0000-000000000001', 'message_count', '1', 'ready') $$,
  23505, null,
  'insights_session_trigger_uniq recusa o gatilho duplicado'
);

-- CHECK de coerência source/chat_message_id
select throws_ok(
  $$ insert into public.entries (user_id, content, source, chat_message_id)
     values ('99999999-0000-0000-0000-000000000001', 'sem message id', 'chat', null) $$,
  23514, null,
  'CHECK recusa source=chat sem chat_message_id'
);

select throws_ok(
  $$ insert into public.entries (user_id, content, source, chat_message_id)
     values ('99999999-0000-0000-0000-000000000001', 'com message id indevido', 'manual', '99999999-0000-0000-0003-000000000002') $$,
  23514, null,
  'CHECK recusa source=manual com chat_message_id preenchido'
);

-- UNIQUE de (session_id, seq)
select throws_ok(
  $$ insert into public.chat_messages (session_id, user_id, role, content, seq)
     values ('99999999-0000-0000-0002-000000000001', '99999999-0000-0000-0000-000000000001', 'assistant', 'duplicado', 1) $$,
  23505, null,
  'chat_messages_session_seq_uniq recusa seq duplicado na mesma sessão'
);

select * from finish();
rollback;
