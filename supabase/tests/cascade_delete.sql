-- T-023 — cascade_delete.sql (Plano técnico §11.1).
-- Apagar a linha em auth.users não deixa órfão em nenhuma das 8 tabelas
-- com dono.

set search_path to public, extensions;
begin;
select plan(9);

insert into auth.users (id, email) values
  ('99999999-0000-0000-0000-000000000001', 'pgtap-user-x@cerne.test');

insert into public.tags (id, user_id, name) values
  ('99999999-0000-0000-0001-000000000001', '99999999-0000-0000-0000-000000000001', 'fixture');

insert into public.chat_sessions (id, user_id, persona_snapshot) values
  ('99999999-0000-0000-0002-000000000001', '99999999-0000-0000-0000-000000000001', 'empatico');

insert into public.chat_messages (id, session_id, user_id, role, content, seq) values
  ('99999999-0000-0000-0003-000000000001', '99999999-0000-0000-0002-000000000001', '99999999-0000-0000-0000-000000000001', 'user', 'fixture', 1);

insert into public.entries (id, user_id, content, source, chat_message_id) values
  ('99999999-0000-0000-0004-000000000001', '99999999-0000-0000-0000-000000000001', 'fixture', 'chat', '99999999-0000-0000-0003-000000000001');

insert into public.entry_tags (entry_id, tag_id, user_id) values
  ('99999999-0000-0000-0004-000000000001', '99999999-0000-0000-0001-000000000001', '99999999-0000-0000-0000-000000000001');

insert into public.insights (session_id, user_id, trigger_type, trigger_key, status) values
  ('99999999-0000-0000-0002-000000000001', '99999999-0000-0000-0000-000000000001', 'message_count', '1', 'ready');

insert into public.export_jobs (user_id, status, narrative_status) values
  ('99999999-0000-0000-0000-000000000001', 'pending', 'pending');

-- sanidade: a fixture realmente populou as 8 tabelas antes do delete
select ok(
  (select count(*) from public.profiles where id = '99999999-0000-0000-0000-000000000001') = 1
  and (select count(*) from public.entries where user_id = '99999999-0000-0000-0000-000000000001') = 1
  and (select count(*) from public.tags where user_id = '99999999-0000-0000-0000-000000000001') = 1
  and (select count(*) from public.entry_tags where user_id = '99999999-0000-0000-0000-000000000001') = 1
  and (select count(*) from public.chat_sessions where user_id = '99999999-0000-0000-0000-000000000001') = 1
  and (select count(*) from public.chat_messages where user_id = '99999999-0000-0000-0000-000000000001') = 1
  and (select count(*) from public.insights where user_id = '99999999-0000-0000-0000-000000000001') = 1
  and (select count(*) from public.export_jobs where user_id = '99999999-0000-0000-0000-000000000001') = 1,
  'fixture: as 8 tabelas têm exatamente 1 linha do usuário antes do delete'
);

delete from auth.users where id = '99999999-0000-0000-0000-000000000001';

select is((select count(*) from public.profiles where id = '99999999-0000-0000-0000-000000000001'), 0::bigint, 'profiles sem órfão');
select is((select count(*) from public.entries where user_id = '99999999-0000-0000-0000-000000000001'), 0::bigint, 'entries sem órfão');
select is((select count(*) from public.tags where user_id = '99999999-0000-0000-0000-000000000001'), 0::bigint, 'tags sem órfão');
select is((select count(*) from public.entry_tags where user_id = '99999999-0000-0000-0000-000000000001'), 0::bigint, 'entry_tags sem órfão');
select is((select count(*) from public.chat_sessions where user_id = '99999999-0000-0000-0000-000000000001'), 0::bigint, 'chat_sessions sem órfão');
select is((select count(*) from public.chat_messages where user_id = '99999999-0000-0000-0000-000000000001'), 0::bigint, 'chat_messages sem órfão');
select is((select count(*) from public.insights where user_id = '99999999-0000-0000-0000-000000000001'), 0::bigint, 'insights sem órfão');
select is((select count(*) from public.export_jobs where user_id = '99999999-0000-0000-0000-000000000001'), 0::bigint, 'export_jobs sem órfão');

select * from finish();
rollback;
