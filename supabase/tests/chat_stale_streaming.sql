-- T-049 — chat_stale_streaming.sql (Plano técnico §8.3): "Job de pg_cron:
-- marcar como failed mensagens em streaming há mais de 60 segundos."
--
-- Testado manipulando created_at diretamente (decisão confirmada com o
-- Wagner, big-plan.md Fase 4) — chamar a função do job de dentro do
-- teste e conferir o resultado é determinístico e roda em milissegundos,
-- ao contrário de esperar 60s reais. O `pg_cron` roda em tempo de parede
-- real do Postgres, alheio ao relógio de teste X-Test-Now da aplicação
-- (`clock.ts`) — por isso este teste não tenta simular X-Test-Now, só
-- manipula `created_at` diretamente.

set search_path to public, extensions;
begin;
select plan(4);

insert into auth.users (id, email) values
  ('99999999-0000-0000-0000-000000000002', 'pgtap-user-stale@cerne.test');

insert into public.chat_sessions (id, user_id, persona_snapshot) values
  ('99999999-0000-0000-0003-000000000001', '99999999-0000-0000-0000-000000000002', 'empatico');

-- presa há mais de 60s -> deve virar failed
insert into public.chat_messages
  (id, session_id, user_id, role, content, seq, status, created_at) values
  ('99999999-0000-0000-0004-000000000001', '99999999-0000-0000-0003-000000000001',
   '99999999-0000-0000-0000-000000000002', 'assistant', '', 2, 'streaming',
   now() - interval '61 seconds');

-- streaming recente (bem dentro dos 60s) -> não deve ser tocada
insert into public.chat_messages
  (id, session_id, user_id, role, content, seq, status, created_at) values
  ('99999999-0000-0000-0004-000000000002', '99999999-0000-0000-0003-000000000001',
   '99999999-0000-0000-0000-000000000002', 'assistant', '', 4, 'streaming', now());

-- complete, mas velha -> não é streaming, nunca deveria ser tocada
insert into public.chat_messages
  (id, session_id, user_id, role, content, seq, status, created_at) values
  ('99999999-0000-0000-0004-000000000003', '99999999-0000-0000-0003-000000000001',
   '99999999-0000-0000-0000-000000000002', 'assistant', 'resposta antiga', 6, 'complete',
   now() - interval '1 hour');

select public.mark_stale_streaming_chat_messages();

select is(
  (select status from public.chat_messages where id = '99999999-0000-0000-0004-000000000001'),
  'failed',
  'mensagem streaming há mais de 60s vira failed'
);

select is(
  (select status from public.chat_messages where id = '99999999-0000-0000-0004-000000000002'),
  'streaming',
  'mensagem streaming recente (dentro dos 60s) não é tocada'
);

select is(
  (select status from public.chat_messages where id = '99999999-0000-0000-0004-000000000003'),
  'complete',
  'mensagem já complete, mesmo antiga, não é tocada (só streaming conta)'
);

select isnt_empty(
  $$select 1 from cron.job where jobname = 'mark-stale-streaming-chat-messages'$$,
  'o job está agendado no pg_cron (a cada minuto)'
);

select * from finish();
rollback;
