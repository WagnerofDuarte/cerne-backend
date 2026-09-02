-- T-018 — Schema `experiment` (Plano técnico §5).
--
-- Fora do alcance da RLS de usuário: acesso só por `service_role` (workers
-- de fila). Nunca acessado por uma Edge Function que atenda requisição do
-- aplicativo (regra invólavel nº5) — o cache de replay e o log de falhas
-- não são dado de usuário, são infraestrutura de experimento.

create schema if not exists experiment;

revoke all on schema experiment from public;
revoke all on schema experiment from anon;
revoke all on schema experiment from authenticated;

-- Cache de replay (Seção 9 do plano técnico): uma linha por cache_key
-- (impressão digital sha256 do envelope canônico de requisição a uma IA).
create table experiment.ai_replay_cache (
  cache_key           text primary key,
  operation           text not null,
  provider            text not null,
  model               text not null,
  prompt_version      text not null,
  request_envelope    jsonb not null,
  response            jsonb not null,
  hit_count           integer not null default 0,
  created_at          timestamptz not null default now()
);

-- Log de injeção de falha (Seção 10 do plano técnico): uma linha por
-- cabeçalho X-Test-Fault interpretado com sucesso.
create table experiment.fault_injection_log (
  id            uuid primary key default gen_random_uuid(),
  request_id    text not null,
  endpoint      text not null,
  fault_type    text not null,
  injected_at   timestamptz not null default now()
);

revoke all on all tables in schema experiment from anon, authenticated;
alter default privileges in schema experiment revoke all on tables from anon, authenticated;
