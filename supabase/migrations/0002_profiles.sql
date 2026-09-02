-- T-012 — Tabela `profiles` (Plano técnico §5, "0002_profiles.sql").
--
-- Uma linha por usuário do GoTrue (`auth.users`), criada automaticamente
-- pelo trigger `on_auth_user_created` no momento do cadastro.

create table public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  email              text not null,
  display_name       text not null default '',
  biometric_enabled  boolean not null default false,
  persona            text not null default 'empatico'
                       check (persona in ('analitico', 'empatico', 'socratico')),
  server_revision    bigint not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Trigger de criação: ao surgir uma linha em auth.users, copia o e-mail e
-- cria a linha correspondente em profiles.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
