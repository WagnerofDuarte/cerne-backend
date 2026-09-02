-- T-019 — Políticas de RLS em todas as tabelas com dono (Plano técnico §5).
--
-- Para cada tabela: ENABLE + FORCE ROW LEVEL SECURITY, uma política por
-- operação (SELECT/INSERT/UPDATE/DELETE) com predicado auth.uid() = dono,
-- GRANT explícito para `authenticated` (necessário porque
-- auto_expose_new_tables=false no config.toml — sem GRANT de tabela, a
-- política de RLS não tem o que restringir) e REVOKE ALL de `anon`.
--
-- `profiles` usa `id` como dono; as demais usam `user_id`.

-- profiles ---------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.profiles force row level security;

create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);
create policy profiles_insert_own on public.profiles
  for insert with check (auth.uid() = id);
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
create policy profiles_delete_own on public.profiles
  for delete using (auth.uid() = id);

grant select, insert, update, delete on public.profiles to authenticated;
revoke all on public.profiles from anon;

-- entries ------------------------------------------------------------------
alter table public.entries enable row level security;
alter table public.entries force row level security;

create policy entries_select_own on public.entries
  for select using (auth.uid() = user_id);
create policy entries_insert_own on public.entries
  for insert with check (auth.uid() = user_id);
create policy entries_update_own on public.entries
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy entries_delete_own on public.entries
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.entries to authenticated;
revoke all on public.entries from anon;

-- tags -----------------------------------------------------------------
alter table public.tags enable row level security;
alter table public.tags force row level security;

create policy tags_select_own on public.tags
  for select using (auth.uid() = user_id);
create policy tags_insert_own on public.tags
  for insert with check (auth.uid() = user_id);
create policy tags_update_own on public.tags
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy tags_delete_own on public.tags
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.tags to authenticated;
revoke all on public.tags from anon;

-- entry_tags -----------------------------------------------------------
alter table public.entry_tags enable row level security;
alter table public.entry_tags force row level security;

create policy entry_tags_select_own on public.entry_tags
  for select using (auth.uid() = user_id);
create policy entry_tags_insert_own on public.entry_tags
  for insert with check (auth.uid() = user_id);
create policy entry_tags_update_own on public.entry_tags
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy entry_tags_delete_own on public.entry_tags
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.entry_tags to authenticated;
revoke all on public.entry_tags from anon;

-- chat_sessions ----------------------------------------------------------
alter table public.chat_sessions enable row level security;
alter table public.chat_sessions force row level security;

create policy chat_sessions_select_own on public.chat_sessions
  for select using (auth.uid() = user_id);
create policy chat_sessions_insert_own on public.chat_sessions
  for insert with check (auth.uid() = user_id);
create policy chat_sessions_update_own on public.chat_sessions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy chat_sessions_delete_own on public.chat_sessions
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.chat_sessions to authenticated;
revoke all on public.chat_sessions from anon;

-- chat_messages ----------------------------------------------------------
alter table public.chat_messages enable row level security;
alter table public.chat_messages force row level security;

create policy chat_messages_select_own on public.chat_messages
  for select using (auth.uid() = user_id);
create policy chat_messages_insert_own on public.chat_messages
  for insert with check (auth.uid() = user_id);
create policy chat_messages_update_own on public.chat_messages
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy chat_messages_delete_own on public.chat_messages
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.chat_messages to authenticated;
revoke all on public.chat_messages from anon;

-- insights -----------------------------------------------------------------
alter table public.insights enable row level security;
alter table public.insights force row level security;

create policy insights_select_own on public.insights
  for select using (auth.uid() = user_id);
create policy insights_insert_own on public.insights
  for insert with check (auth.uid() = user_id);
create policy insights_update_own on public.insights
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy insights_delete_own on public.insights
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.insights to authenticated;
revoke all on public.insights from anon;

-- export_jobs ------------------------------------------------------------
alter table public.export_jobs enable row level security;
alter table public.export_jobs force row level security;

create policy export_jobs_select_own on public.export_jobs
  for select using (auth.uid() = user_id);
create policy export_jobs_insert_own on public.export_jobs
  for insert with check (auth.uid() = user_id);
create policy export_jobs_update_own on public.export_jobs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy export_jobs_delete_own on public.export_jobs
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.export_jobs to authenticated;
revoke all on public.export_jobs from anon;
