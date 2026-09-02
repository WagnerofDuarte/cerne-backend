-- T-011 — Extensões da Fase 1 (Plano técnico §5, "0001_extensions.sql").
--
-- pgcrypto  : funções de hash/criptografia.
-- vector    : tipo vector(1024) usado em entries.embedding. Varredura exata,
--             nunca índice aproximado (HNSW/IVFFlat) — regra invólavel nº7.
-- pgtap     : suíte de testes do banco (`supabase test db`).
-- pg_cron   : jobs agendados (streams de chat abandonados, consumidor da
--             fila de exportação) — usados a partir da Fase 4/5.
-- pgmq      : fila da exportação assíncrona (RF05) — usada a partir da Fase 5.
--
-- pgcrypto, vector e pgtap são instaladas no schema `extensions`, seguindo a
-- convenção do Supabase (config.toml já inclui "extensions" no
-- extra_search_path da API). pg_cron e pgmq gerenciam o próprio schema
-- (`cron` e `pgmq` respectivamente) e não aceitam relocação.

create schema if not exists extensions;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists pg_cron;
create extension if not exists pgmq;
