-- T-017 — Tabela `export_jobs` (Plano técnico §5).
--
-- `status` (do job) e `narrative_status` (da narrativa em IA) evoluem de
-- forma independente: dados prontos não esperam a narrativa (RF05, Fase 5).
-- Sem DEFAULT em nenhum dos dois — o worker define o valor inicial
-- explicitamente ao criar o job.

create table public.export_jobs (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references public.profiles (id) on delete cascade,
  -- nulo = "todo o período"
  period_start             timestamptz,
  period_end               timestamptz,
  status                   text not null
                             check (status in ('pending', 'processing', 'data_ready', 'done', 'error')),
  narrative_status         text not null
                             check (narrative_status in ('pending', 'processing', 'done', 'failed', 'skipped')),
  entry_count              integer,
  raw_file_path            text,
  pdf_file_path            text,
  error_code               text,
  narrative_error_code     text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  completed_at             timestamptz
);
