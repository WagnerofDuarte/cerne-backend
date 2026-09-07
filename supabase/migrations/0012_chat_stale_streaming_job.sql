-- T-049 — Job pg_cron: marca `failed` mensagens presas em `streaming` há
-- mais de 60 segundos (Plano técnico §8.3: "Job de pg_cron: marcar como
-- failed mensagens em streaming há mais de 60 segundos.").
--
-- Cobre o caso em que o produtor SSE (`chat-messages-send`/`.retry`,
-- T-046/T-048) morre no meio do caminho sem chegar a rodar seu próprio
-- `catch`/`finally` — ex.: o isolate da Edge Function é encerrado à força
-- pelo runtime antes de terminar (mesma família de encerramento anômalo
-- já documentada no achado real de T-041/`gateway.ts`). Sem este job, essa
-- mensagem ficaria em `status='streaming'` para sempre, e o app nunca
-- saberia que a geração morreu.
--
-- `chat_messages` não tem `updated_at` (só `created_at`, migração 0003) —
-- "presa há mais de 60s" só pode significar 60s desde a criação da linha,
-- que é o instante em que o passo 3 do §8.3 grava o placeholder streaming.
--
-- SECURITY DEFINER, sem GRANT para nenhum papel de aplicativo (diferente
-- das RPCs de `experiment` na migração 0010): esta função nunca é chamada
-- via PostgREST/`supabase.rpc(...)` por uma Edge Function — só pelo
-- próprio `pg_cron`, que roda como o papel que agendou o job (`postgres`,
-- que ignora GRANT/REVOKE por ser superusuário). Fechar EXECUTE para
-- `PUBLIC` evita que qualquer usuário autenticado dispare isso à toa.
create or replace function public.mark_stale_streaming_chat_messages()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update chat_messages
  set status = 'failed'
  where status = 'streaming'
    and created_at < now() - interval '60 seconds';
$$;

revoke execute on function public.mark_stale_streaming_chat_messages() from public;

-- A cada minuto — granularidade prática (o plano técnico fixa o limiar de
-- 60s de uma mensagem presa, não a frequência de verificação): no pior
-- caso uma mensagem pode ficar até ~119s em `streaming` antes deste job
-- rodar e marcá-la `failed` (presa há 59s quando o minuto anterior já
-- tinha passado, mais os 60s de limiar). Aceitável — é uma rede de
-- segurança para um caso já anômalo (o isolate morreu no meio do
-- caminho), não um SLA de latência.
--
-- `cron.schedule` com um `jobname` é idempotente: uma 2ª chamada com o
-- mesmo nome desagenda a versão anterior antes de recriar — seguro rodar
-- esta migração mais de uma vez na mesma instância (a tabela `cron.job`
-- não é resetada por `supabase db reset`, que só afeta o schema do
-- projeto).
select cron.schedule(
  'mark-stale-streaming-chat-messages',
  '* * * * *',
  $$select public.mark_stale_streaming_chat_messages()$$
);
