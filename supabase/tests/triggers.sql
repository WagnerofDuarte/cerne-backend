-- T-023 — triggers.sql (Plano técnico §11.1).
-- Cobre: server_revision incrementa; user_message_count incrementa (só em
-- mensagem role='user', não em 'assistant').

set search_path to public, extensions;
begin;
select plan(5);

insert into auth.users (id, email) values
  ('99999999-0000-0000-0000-000000000001', 'pgtap-user-x@cerne.test');

select is(
  (select server_revision from public.profiles where id = '99999999-0000-0000-0000-000000000001'),
  0::bigint,
  'server_revision começa em 0'
);

insert into public.entries (user_id, content, source) values
  ('99999999-0000-0000-0000-000000000001', 'primeira entrada', 'manual');

select is(
  (select server_revision from public.profiles where id = '99999999-0000-0000-0000-000000000001'),
  1::bigint,
  'server_revision incrementa após INSERT em entries'
);

update public.entries set content = 'primeira entrada editada'
where user_id = '99999999-0000-0000-0000-000000000001';

select is(
  (select server_revision from public.profiles where id = '99999999-0000-0000-0000-000000000001'),
  2::bigint,
  'server_revision incrementa também após UPDATE em entries'
);

insert into public.chat_sessions (id, user_id, persona_snapshot) values
  ('99999999-0000-0000-0002-000000000001', '99999999-0000-0000-0000-000000000001', 'empatico');

insert into public.chat_messages (session_id, user_id, role, content, seq) values
  ('99999999-0000-0000-0002-000000000001', '99999999-0000-0000-0000-000000000001', 'user', 'oi', 1);

select is(
  (select user_message_count from public.chat_sessions where id = '99999999-0000-0000-0002-000000000001'),
  1,
  'user_message_count incrementa em mensagem role=user'
);

insert into public.chat_messages (session_id, user_id, role, content, seq) values
  ('99999999-0000-0000-0002-000000000001', '99999999-0000-0000-0000-000000000001', 'assistant', 'oi de volta', 2);

select is(
  (select user_message_count from public.chat_sessions where id = '99999999-0000-0000-0002-000000000001'),
  1,
  'user_message_count NÃO incrementa em mensagem role=assistant'
);

select * from finish();
rollback;
