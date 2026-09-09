-- T-059 — `DELETE /account`: apagar a própria conta sem `service_role`
-- numa Edge Function de aplicativo (Plano técnico §8.6, regra nº5).
--
-- Decisão tomada com o Wagner antes de implementar (ver `big-plan.md`,
-- Fase 5): a cascata completa (profiles -> entries/tags/entry_tags/
-- chat_sessions/chat_messages/insights/export_jobs) já está provada desde
-- a Fase 1 (`cascade_delete.sql`) a partir de `delete from auth.users` —
-- é de lá que ela desce (`profiles.id references auth.users.id on delete
-- cascade`, migração 0002). Mas não existe endpoint self-service do GoTrue
-- para um usuário apagar a própria conta — só a API administrativa, que
-- exige `service_role`, proibida numa Edge Function que atende requisição
-- do app (regra nº5, sem exceção).
--
-- Saída escolhida (mesmo padrão `SECURITY DEFINER` de superfície mínima
-- das migrações 0010/0014): uma função que só apaga o PRÓPRIO
-- `auth.users.id` de quem chamou — `auth.uid()` embutido, sem parâmetro
-- solto, então não há como pedir a exclusão de outra conta através dela.
--
-- Ressalva registrada, não escondida: isto mexe direto num schema que é do
-- GoTrue, não nosso. `auth.users` tem FKs `on delete cascade` para as
-- próprias tabelas internas do GoTrue (sessions, refresh_tokens,
-- identities, mfa_factors, ...) na versão do Supabase usada por este
-- projeto — um `delete` direto deveria limpar tudo isso pela mesma cascata
-- que a API administrativa também usa por baixo. Mas isso não é
-- garantido por nenhum documento-fonte deste projeto, e pode variar entre
-- versões do GoTrue. `supabase/tests/account_delete.sql` (T-059) inclui um
-- caso explícito verificando que uma sessão/refresh token de teste
-- também desaparece, em vez de assumir que a cascata "deveria" funcionar.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'delete_own_account: sem usuário autenticado';
  end if;

  delete from auth.users where id = auth.uid();
end;
$$;

revoke execute on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;
