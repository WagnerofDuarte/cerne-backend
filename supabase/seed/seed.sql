-- T-022 — Seed idempotente (Plano técnico §6).
--
-- Datas sempre relativas à âncora fixa (ver supabase/seed/ancora.md):
--   ANCORA = 2026-09-23T09:41:00Z
--
-- Senha das três contas e mecanismo de embedding real da conta A:
-- documentados em supabase/seed/ancora.md (SQL puro não lê variável de
-- ambiente nem chama HTTP — ver esse arquivo para o motivo).
--
-- Idempotência: todo ID é um literal fixo; toda escrita usa
-- ON CONFLICT (id) DO NOTHING, então rodar este arquivo mais de uma vez
-- nunca duplica linha.

-- =========================================================================
-- Contas (auth.users + auth.identities)
--
-- profiles é criado pelo trigger on_auth_user_created (0002_profiles.sql).
-- Como o INSERT usa ON CONFLICT DO NOTHING, uma reexecução não dispara o
-- trigger de novo (trigger AFTER INSERT só corre para linha realmente
-- inserida) — por isso o UPDATE de display_name/persona vem em separado,
-- sempre idempotente por natureza.
-- =========================================================================

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'cenario-cheio@cerne.test',
   extensions.crypt('Cerne-Teste-2026!', extensions.gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(),
   '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'cenario-uma@cerne.test',
   extensions.crypt('Cerne-Teste-2026!', extensions.gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(),
   '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'cenario-vazio@cerne.test',
   extensions.crypt('Cerne-Teste-2026!', extensions.gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(),
   '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, created_at, updated_at
) values
  ('a0000000-0000-0000-0005-000000000001', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001',
   jsonb_build_object('sub', 'a0000000-0000-0000-0000-000000000001', 'email', 'cenario-cheio@cerne.test'),
   'email', now(), now()),
  ('b0000000-0000-0000-0005-000000000001', 'b0000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000001',
   jsonb_build_object('sub', 'b0000000-0000-0000-0000-000000000001', 'email', 'cenario-uma@cerne.test'),
   'email', now(), now()),
  ('c0000000-0000-0000-0005-000000000001', 'c0000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000001',
   jsonb_build_object('sub', 'c0000000-0000-0000-0000-000000000001', 'email', 'cenario-vazio@cerne.test'),
   'email', now(), now())
on conflict (id) do nothing;

update public.profiles set display_name = 'Cenário Cheio' where id = 'a0000000-0000-0000-0000-000000000001';
update public.profiles set display_name = 'Cenário Uma'   where id = 'b0000000-0000-0000-0000-000000000001';
update public.profiles set display_name = 'Cenário Vazio' where id = 'c0000000-0000-0000-0000-000000000001';

-- =========================================================================
-- Tags da conta A (T-015 — só o seed escreve aqui)
-- =========================================================================

insert into public.tags (id, user_id, name, created_at) values
  ('a0000000-0000-0000-0001-000000000001', 'a0000000-0000-0000-0000-000000000001', 'trabalho', now()),
  ('a0000000-0000-0000-0001-000000000002', 'a0000000-0000-0000-0000-000000000001', 'família',  now()),
  ('a0000000-0000-0000-0001-000000000003', 'a0000000-0000-0000-0000-000000000001', 'sono',     now()),
  ('a0000000-0000-0000-0001-000000000004', 'a0000000-0000-0000-0000-000000000001', 'saúde',    now())
on conflict (id) do nothing;

-- =========================================================================
-- Entradas não-chat da conta A (28: 14 manual + 8 audio + 6 photo)
--
-- Distribuídas em 10 dias distintos anteriores à âncora. Duas entradas
-- carregam os estados de UI exigidos pelo plano (T-022): uma
-- embedding_status='failed' (nunca tocada pelo script de backfill) e uma
-- pii_status='flagged' (nome próprio real no texto, span anotado). As
-- outras 3 manuais são os pares semânticos aprovados pelo Wagner no
-- GATE-09 (fixtures/pares_semanticos.md) — ficam 'pending' até o backfill
-- gerar o embedding de verdade via Voyage (prova do RF06, T-024).
-- =========================================================================

insert into public.entries (
  id, user_id, content, source, occurred_at, media_duration_seconds,
  embedding_status, pii_status, pii_spans, created_at, updated_at
) values
  -- dia 1 (ANCORA - 1 dia)
  ('a0000000-0000-0000-0004-000000000001', 'a0000000-0000-0000-0000-000000000001',
   'Hoje não consegui organizar bem os pensamentos pra escrever muita coisa. Foi só um dia mediano, sem nada que se destacasse.',
   'manual', '2026-09-23T09:41:00Z'::timestamptz - interval '1 day' + interval '8 hours', null,
   'failed', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '1 day' + interval '8 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '1 day' + interval '8 hours'),
  ('a0000000-0000-0000-0004-000000000002', 'a0000000-0000-0000-0000-000000000001',
   'Almocei hoje com a Marina depois de muito tempo sem nos vermos.',
   'manual', '2026-09-23T09:41:00Z'::timestamptz - interval '1 day' + interval '12 hours', null,
   'pending', 'flagged',
   '[{"type":"name","text":"Marina","start":19,"end":25}]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '1 day' + interval '12 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '1 day' + interval '12 hours'),
  ('a0000000-0000-0000-0004-000000000003', 'a0000000-0000-0000-0000-000000000001',
   'Amanhã tenho que apresentar o projeto pra diretoria inteira e não consigo parar de pensar nisso. O coração fica acelerado só de imaginar todo mundo olhando pra mim esperando eu falar. Passei a noite revisando os slides de novo e de novo, mas por dentro sinto um aperto no peito, as mãos ficam geladas e suando ao mesmo tempo. Tentei dormir mais cedo mas fiquei rodando os mesmos pensamentos, imaginando tudo que pode dar errado. Só queria que já fosse depois de amanhã pra essa sensação passar.',
   'manual', '2026-09-23T09:41:00Z'::timestamptz - interval '1 day' + interval '16 hours', null,
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '1 day' + interval '16 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '1 day' + interval '16 hours'),
  ('a0000000-0000-0000-0004-000000000004', 'a0000000-0000-0000-0000-000000000001',
   'Cheguei em casa hoje e simplesmente desabei no sofá sem forças pra fazer mais nada. A semana foi daquelas que parecem não ter fim, um dia emendando no outro sem espaço pra respirar. Meu corpo pesa, os olhos ardem, e até pensar em levantar pra tomar um banho parece um esforço enorme. Só quero ficar aqui parado, sem estímulo nenhum, até o corpo se recuperar um pouco.',
   'manual', '2026-09-23T09:41:00Z'::timestamptz - interval '1 day' + interval '20 hours', null,
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '1 day' + interval '20 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '1 day' + interval '20 hours'),

  -- dia 2 (ANCORA - 2 dias)
  ('a0000000-0000-0000-0004-000000000005', 'a0000000-0000-0000-0000-000000000001',
   'Hoje resolvi parar um minuto antes de dormir pra pensar no que rolou de bom no meu dia. Tive uma conversa gostosa com um amigo que eu não via há tempos, o café da manhã veio na hora certa bem quentinho, e ainda consegui resolver uma pendência que tava me incomodando. São coisas pequenas, mas quando junto tudo isso percebo que o dia não foi tão ruim assim. Fico pensando em como é bom ter essas pausas pra notar o que realmente importa.',
   'manual', '2026-09-23T09:41:00Z'::timestamptz - interval '2 days' + interval '8 hours', null,
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '2 days' + interval '8 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '2 days' + interval '8 hours'),
  ('a0000000-0000-0000-0004-000000000006', 'a0000000-0000-0000-0000-000000000001',
   'Fiz uma caminhada rápida no parque antes do trabalho e o dia já começou bem melhor.',
   'manual', '2026-09-23T09:41:00Z'::timestamptz - interval '2 days' + interval '12 hours', null,
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '2 days' + interval '12 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '2 days' + interval '12 hours'),
  ('a0000000-0000-0000-0004-000000000007', 'a0000000-0000-0000-0000-000000000001',
   'Tive uma discussão boba com meu irmão sobre um assunto qualquer da família, mas já passou.',
   'manual', '2026-09-23T09:41:00Z'::timestamptz - interval '2 days' + interval '16 hours', null,
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '2 days' + interval '16 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '2 days' + interval '16 hours'),
  ('a0000000-0000-0000-0004-000000000008', 'a0000000-0000-0000-0000-000000000001',
   'Consegui terminar aquele relatório que estava atrasado há dias. Alívio.',
   'manual', '2026-09-23T09:41:00Z'::timestamptz - interval '2 days' + interval '20 hours', null,
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '2 days' + interval '20 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '2 days' + interval '20 hours'),

  -- dia 3 (ANCORA - 3 dias)
  ('a0000000-0000-0000-0004-000000000009', 'a0000000-0000-0000-0000-000000000001',
   'Dormi mal de novo essa noite, fiquei virando de um lado pro outro sem motivo aparente.',
   'manual', '2026-09-23T09:41:00Z'::timestamptz - interval '3 days' + interval '8 hours', null,
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '3 days' + interval '8 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '3 days' + interval '8 hours'),
  ('a0000000-0000-0000-0004-000000000010', 'a0000000-0000-0000-0000-000000000001',
   'Separei um tempo pra organizar as contas do mês. Chato, mas necessário.',
   'manual', '2026-09-23T09:41:00Z'::timestamptz - interval '3 days' + interval '12 hours', null,
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '3 days' + interval '12 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '3 days' + interval '12 hours'),
  ('a0000000-0000-0000-0004-000000000011', 'a0000000-0000-0000-0000-000000000001',
   'Fui ao médico fazer um check-up de rotina, tudo dentro do esperado.',
   'manual', '2026-09-23T09:41:00Z'::timestamptz - interval '3 days' + interval '16 hours', null,
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '3 days' + interval '16 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '3 days' + interval '16 hours'),
  ('a0000000-0000-0000-0004-000000000012', 'a0000000-0000-0000-0000-000000000001',
   'Tentei cozinhar uma receita nova hoje e não ficou tão ruim quanto eu esperava.',
   'manual', '2026-09-23T09:41:00Z'::timestamptz - interval '3 days' + interval '20 hours', null,
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '3 days' + interval '20 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '3 days' + interval '20 hours'),

  -- dia 4 (ANCORA - 4 dias)
  ('a0000000-0000-0000-0004-000000000013', 'a0000000-0000-0000-0000-000000000001',
   'O dia no trabalho foi tranquilo, sem grandes sobressaltos.',
   'manual', '2026-09-23T09:41:00Z'::timestamptz - interval '4 days' + interval '8 hours', null,
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '4 days' + interval '8 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '4 days' + interval '8 hours'),
  ('a0000000-0000-0000-0004-000000000014', 'a0000000-0000-0000-0000-000000000001',
   'Passei a tarde lendo um livro que tinha comprado há meses e nunca tinha aberto.',
   'manual', '2026-09-23T09:41:00Z'::timestamptz - interval '4 days' + interval '12 hours', null,
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '4 days' + interval '12 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '4 days' + interval '12 hours'),
  ('a0000000-0000-0000-0004-000000000015', 'a0000000-0000-0000-0000-000000000001',
   'Hoje o trânsito pra voltar do trabalho tava um caos, demorei muito mais que o normal e cheguei super irritado em casa.',
   'audio', '2026-09-23T09:41:00Z'::timestamptz - interval '4 days' + interval '16 hours', 38,
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '4 days' + interval '16 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '4 days' + interval '16 hours'),
  ('a0000000-0000-0000-0004-000000000016', 'a0000000-0000-0000-0000-000000000001',
   'Liguei pra minha mãe só pra saber como ela tava, a gente ficou uma hora no telefone conversando sobre bobagem.',
   'audio', '2026-09-23T09:41:00Z'::timestamptz - interval '4 days' + interval '20 hours', 64,
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '4 days' + interval '20 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '4 days' + interval '20 hours'),

  -- dia 5 (ANCORA - 5 dias)
  ('a0000000-0000-0000-0004-000000000017', 'a0000000-0000-0000-0000-000000000001',
   'Fiz uma sessão de treino hoje que me deixou exausto, mas foi bom pra desopilar a cabeça depois da semana puxada.',
   'audio', '2026-09-23T09:41:00Z'::timestamptz - interval '5 days' + interval '9 hours', 45,
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '5 days' + interval '9 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '5 days' + interval '9 hours'),
  ('a0000000-0000-0000-0004-000000000018', 'a0000000-0000-0000-0000-000000000001',
   'Tava pensando aqui enquanto caminhava sobre como esse mês passou rápido, parece que foi ontem que começou.',
   'audio', '2026-09-23T09:41:00Z'::timestamptz - interval '5 days' + interval '14 hours', 29,
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '5 days' + interval '14 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '5 days' + interval '14 hours'),
  ('a0000000-0000-0000-0004-000000000019', 'a0000000-0000-0000-0000-000000000001',
   'Recebi uma notícia meio inesperada no trabalho hoje, ainda tô processando o que isso significa pra mim.',
   'audio', '2026-09-23T09:41:00Z'::timestamptz - interval '5 days' + interval '19 hours', 52,
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '5 days' + interval '19 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '5 days' + interval '19 hours'),

  -- dia 6 (ANCORA - 6 dias)
  ('a0000000-0000-0000-0004-000000000020', 'a0000000-0000-0000-0000-000000000001',
   'Fui buscar meu filho na escola e ele veio super animado contando sobre um projeto de ciências.',
   'audio', '2026-09-23T09:41:00Z'::timestamptz - interval '6 days' + interval '9 hours', 33,
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '6 days' + interval '9 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '6 days' + interval '9 hours'),
  ('a0000000-0000-0000-0004-000000000021', 'a0000000-0000-0000-0000-000000000001',
   'Tentei meditar um pouco antes de dormir hoje, não sei se ajudou muito mas pelo menos tentei.',
   'audio', '2026-09-23T09:41:00Z'::timestamptz - interval '6 days' + interval '14 hours', 41,
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '6 days' + interval '14 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '6 days' + interval '14 hours'),
  ('a0000000-0000-0000-0004-000000000022', 'a0000000-0000-0000-0000-000000000001',
   'O fim de semana já tá chegando e eu só penso em descansar de verdade, sem compromisso nenhum.',
   'audio', '2026-09-23T09:41:00Z'::timestamptz - interval '6 days' + interval '19 hours', 27,
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '6 days' + interval '19 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '6 days' + interval '19 hours'),

  -- dia 7 (ANCORA - 7 dias)
  ('a0000000-0000-0000-0004-000000000023', 'a0000000-0000-0000-0000-000000000001',
   'Página do caderno de hoje: anotei os planos pra semana que vem, muita coisa pra organizar ainda.',
   'photo', '2026-09-23T09:41:00Z'::timestamptz - interval '7 days' + interval '9 hours', null,
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '7 days' + interval '9 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '7 days' + interval '9 hours'),
  ('a0000000-0000-0000-0004-000000000024', 'a0000000-0000-0000-0000-000000000001',
   'Escrevi um desabafo rápido sobre como me senti sobrecarregado com as demandas dessa semana.',
   'photo', '2026-09-23T09:41:00Z'::timestamptz - interval '7 days' + interval '14 hours', null,
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '7 days' + interval '14 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '7 days' + interval '14 hours'),
  ('a0000000-0000-0000-0004-000000000025', 'a0000000-0000-0000-0000-000000000001',
   'Fiz uma lista das coisas que preciso resolver antes do fim do mês, ficou bem grande.',
   'photo', '2026-09-23T09:41:00Z'::timestamptz - interval '7 days' + interval '19 hours', null,
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '7 days' + interval '19 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '7 days' + interval '19 hours'),

  -- dia 8 (ANCORA - 8 dias)
  ('a0000000-0000-0000-0004-000000000026', 'a0000000-0000-0000-0000-000000000001',
   'Rabisquei algumas ideias pra um projeto pessoal que quero começar em breve.',
   'photo', '2026-09-23T09:41:00Z'::timestamptz - interval '8 days' + interval '9 hours', null,
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '8 days' + interval '9 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '8 days' + interval '9 hours'),
  ('a0000000-0000-0000-0004-000000000027', 'a0000000-0000-0000-0000-000000000001',
   'Anotei os sentimentos que tive durante a reunião difícil de hoje, pra não esquecer depois.',
   'photo', '2026-09-23T09:41:00Z'::timestamptz - interval '8 days' + interval '14 hours', null,
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '8 days' + interval '14 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '8 days' + interval '14 hours'),
  ('a0000000-0000-0000-0004-000000000028', 'a0000000-0000-0000-0000-000000000001',
   'Escrevi sobre a conversa boa que tive com um amigo antigo que reencontrei por acaso.',
   'photo', '2026-09-23T09:41:00Z'::timestamptz - interval '8 days' + interval '19 hours', null,
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '8 days' + interval '19 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '8 days' + interval '19 hours')
on conflict (id) do nothing;

-- =========================================================================
-- Chat da conta A (T-013): 3 sessões.
--
-- Sessão 1 tem exatamente 4 mensagens do usuário (spec T-022 / roteiro
-- Fase 4 dispara o gatilho N=5 na 5ª mensagem real, criada via API depois).
-- Sessões 2 e 3 têm 3 mensagens do usuário cada, e essas 6 mensagens são
-- promovidas a entries (source='chat') mais abaixo — total 6 entradas de
-- chat, como o plano exige.
-- =========================================================================

insert into public.chat_sessions (
  id, user_id, title, persona_snapshot, user_message_count,
  last_user_message_at, created_at, updated_at
) values
  ('a0000000-0000-0000-0002-000000000001', 'a0000000-0000-0000-0000-000000000001',
   'Conversa sobre o dia no trabalho', 'empatico', 0, null,
   '2026-09-23T09:41:00Z'::timestamptz - interval '7 days' + interval '10 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '7 days' + interval '10 hours'),
  ('a0000000-0000-0000-0002-000000000002', 'a0000000-0000-0000-0000-000000000001',
   'Conversa sobre o sono', 'empatico', 0, null,
   '2026-09-23T09:41:00Z'::timestamptz - interval '9 days' + interval '9 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '9 days' + interval '9 hours'),
  ('a0000000-0000-0000-0002-000000000003', 'a0000000-0000-0000-0000-000000000001',
   'Conversa sobre um dia bom', 'empatico', 0, null,
   '2026-09-23T09:41:00Z'::timestamptz - interval '10 days' + interval '18 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '10 days' + interval '18 hours')
on conflict (id) do nothing;

-- user_message_count / last_user_message_at são preenchidos pelo trigger
-- chat_messages_bump_session (0003) conforme as mensagens de role='user'
-- abaixo são inseridas — nada é setado à mão aqui.

insert into public.chat_messages (
  id, session_id, user_id, role, content, seq, status, retry_count, created_at
) values
  -- sessão 1 — 4 mensagens do usuário
  ('a0000000-0000-0000-0003-000000000001', 'a0000000-0000-0000-0002-000000000001', 'a0000000-0000-0000-0000-000000000001',
   'user', 'Oi, queria conversar sobre como foi meu dia hoje.', 1, 'complete', 0,
   '2026-09-23T09:41:00Z'::timestamptz - interval '7 days' + interval '10 hours'),
  ('a0000000-0000-0000-0003-000000000002', 'a0000000-0000-0000-0002-000000000001', 'a0000000-0000-0000-0000-000000000001',
   'assistant', 'Claro, me conta como foi — o que mais chamou sua atenção?', 2, 'complete', 0,
   '2026-09-23T09:41:00Z'::timestamptz - interval '7 days' + interval '10 hours' + interval '5 seconds'),
  ('a0000000-0000-0000-0003-000000000003', 'a0000000-0000-0000-0002-000000000001', 'a0000000-0000-0000-0000-000000000001',
   'user', 'Foi bem estressante no trabalho, tive muita coisa acumulada.', 3, 'complete', 0,
   '2026-09-23T09:41:00Z'::timestamptz - interval '7 days' + interval '11 hours'),
  ('a0000000-0000-0000-0003-000000000004', 'a0000000-0000-0000-0002-000000000001', 'a0000000-0000-0000-0000-000000000001',
   'assistant', 'Entendo, dias assim pesam bastante. Quer falar mais sobre o que gerou esse acúmulo?', 4, 'complete', 0,
   '2026-09-23T09:41:00Z'::timestamptz - interval '7 days' + interval '11 hours' + interval '5 seconds'),
  ('a0000000-0000-0000-0003-000000000005', 'a0000000-0000-0000-0002-000000000001', 'a0000000-0000-0000-0000-000000000001',
   'user', 'Sim, é que meu chefe mudou o prazo de um projeto de última hora.', 5, 'complete', 0,
   '2026-09-23T09:41:00Z'::timestamptz - interval '7 days' + interval '15 hours'),
  ('a0000000-0000-0000-0003-000000000006', 'a0000000-0000-0000-0002-000000000001', 'a0000000-0000-0000-0000-000000000001',
   'assistant', 'Isso realmente é frustrante, mudanças de última hora tiram o controle da gente sobre o próprio tempo.', 6, 'complete', 0,
   '2026-09-23T09:41:00Z'::timestamptz - interval '7 days' + interval '15 hours' + interval '5 seconds'),
  ('a0000000-0000-0000-0003-000000000007', 'a0000000-0000-0000-0002-000000000001', 'a0000000-0000-0000-0000-000000000001',
   'user', 'Exatamente, e ainda tive que remarcar outros compromissos por causa disso.', 7, 'complete', 0,
   '2026-09-23T09:41:00Z'::timestamptz - interval '7 days' + interval '20 hours'),
  ('a0000000-0000-0000-0003-000000000008', 'a0000000-0000-0000-0002-000000000001', 'a0000000-0000-0000-0000-000000000001',
   'assistant', 'Faz sentido você estar cansado então. Como você se sente agora, depois de ter contado isso?', 8, 'complete', 0,
   '2026-09-23T09:41:00Z'::timestamptz - interval '7 days' + interval '20 hours' + interval '5 seconds'),

  -- sessão 2 — 3 mensagens do usuário (todas promovidas a entries abaixo)
  ('a0000000-0000-0000-0003-000000000009', 'a0000000-0000-0000-0002-000000000002', 'a0000000-0000-0000-0000-000000000001',
   'user', 'Hoje percebi que tenho dormido muito mal ultimamente, queria entender por quê.', 1, 'complete', 0,
   '2026-09-23T09:41:00Z'::timestamptz - interval '9 days' + interval '9 hours'),
  ('a0000000-0000-0000-0003-000000000010', 'a0000000-0000-0000-0002-000000000002', 'a0000000-0000-0000-0000-000000000001',
   'assistant', 'Isso é importante notar. Tem alguma coisa diferente na sua rotina antes de dormir?', 2, 'complete', 0,
   '2026-09-23T09:41:00Z'::timestamptz - interval '9 days' + interval '9 hours' + interval '5 seconds'),
  ('a0000000-0000-0000-0003-000000000011', 'a0000000-0000-0000-0002-000000000002', 'a0000000-0000-0000-0000-000000000001',
   'user', 'Acho que é o celular, fico até tarde vendo notificações sem perceber o tempo passando.', 3, 'complete', 0,
   '2026-09-23T09:41:00Z'::timestamptz - interval '9 days' + interval '9 hours' + interval '5 minutes'),
  ('a0000000-0000-0000-0003-000000000012', 'a0000000-0000-0000-0002-000000000002', 'a0000000-0000-0000-0000-000000000001',
   'assistant', 'Faz sentido, a luz da tela e o estímulo constante dificultam relaxar. Já pensou em criar um horário pra desligar?', 4, 'complete', 0,
   '2026-09-23T09:41:00Z'::timestamptz - interval '9 days' + interval '9 hours' + interval '5 minutes' + interval '5 seconds'),
  ('a0000000-0000-0000-0003-000000000013', 'a0000000-0000-0000-0002-000000000002', 'a0000000-0000-0000-0000-000000000001',
   'user', 'Vou tentar isso essa semana e te conto como foi.', 5, 'complete', 0,
   '2026-09-23T09:41:00Z'::timestamptz - interval '9 days' + interval '9 hours' + interval '10 minutes'),
  ('a0000000-0000-0000-0003-000000000014', 'a0000000-0000-0000-0002-000000000002', 'a0000000-0000-0000-0000-000000000001',
   'assistant', 'Combinado, vou adorar saber como foi. Cuide-se essa semana.', 6, 'complete', 0,
   '2026-09-23T09:41:00Z'::timestamptz - interval '9 days' + interval '9 hours' + interval '10 minutes' + interval '5 seconds'),

  -- sessão 3 — 3 mensagens do usuário (todas promovidas a entries abaixo)
  ('a0000000-0000-0000-0003-000000000015', 'a0000000-0000-0000-0002-000000000003', 'a0000000-0000-0000-0000-000000000001',
   'user', 'Queria comentar sobre uma coisa boa que aconteceu hoje, pra variar.', 1, 'complete', 0,
   '2026-09-23T09:41:00Z'::timestamptz - interval '10 days' + interval '18 hours'),
  ('a0000000-0000-0000-0003-000000000016', 'a0000000-0000-0000-0002-000000000003', 'a0000000-0000-0000-0000-000000000001',
   'assistant', 'Adoraria ouvir! O que aconteceu?', 2, 'complete', 0,
   '2026-09-23T09:41:00Z'::timestamptz - interval '10 days' + interval '18 hours' + interval '5 seconds'),
  ('a0000000-0000-0000-0003-000000000017', 'a0000000-0000-0000-0002-000000000003', 'a0000000-0000-0000-0000-000000000001',
   'user', 'Recebi um elogio inesperado de um colega sobre um trabalho que fiz semanas atrás.', 3, 'complete', 0,
   '2026-09-23T09:41:00Z'::timestamptz - interval '10 days' + interval '18 hours' + interval '5 minutes'),
  ('a0000000-0000-0000-0003-000000000018', 'a0000000-0000-0000-0002-000000000003', 'a0000000-0000-0000-0000-000000000001',
   'assistant', 'Que ótimo reconhecimento! Como isso te fez sentir?', 4, 'complete', 0,
   '2026-09-23T09:41:00Z'::timestamptz - interval '10 days' + interval '18 hours' + interval '5 minutes' + interval '5 seconds'),
  ('a0000000-0000-0000-0003-000000000019', 'a0000000-0000-0000-0002-000000000003', 'a0000000-0000-0000-0000-000000000001',
   'user', 'Me senti valorizado, foi um respiro no meio da rotina puxada.', 5, 'complete', 0,
   '2026-09-23T09:41:00Z'::timestamptz - interval '10 days' + interval '18 hours' + interval '10 minutes'),
  ('a0000000-0000-0000-0003-000000000020', 'a0000000-0000-0000-0002-000000000003', 'a0000000-0000-0000-0000-000000000001',
   'assistant', 'Fico feliz por você. Guardar esses momentos também ajuda a equilibrar os dias mais pesados.', 6, 'complete', 0,
   '2026-09-23T09:41:00Z'::timestamptz - interval '10 days' + interval '18 hours' + interval '10 minutes' + interval '5 seconds')
on conflict (id) do nothing;

-- =========================================================================
-- Entradas de chat da conta A (6): promovem as 3 mensagens de usuário da
-- sessão 2 e as 3 da sessão 3 a entries (source='chat'), conteúdo idêntico
-- ao da mensagem de origem. A sessão 1 fica de fora de propósito, para
-- manter seu user_message_count em exatamente 4.
-- =========================================================================

insert into public.entries (
  id, user_id, content, source, chat_message_id, occurred_at,
  embedding_status, pii_status, pii_spans, created_at, updated_at
) values
  ('a0000000-0000-0000-0004-000000000029', 'a0000000-0000-0000-0000-000000000001',
   'Hoje percebi que tenho dormido muito mal ultimamente, queria entender por quê.',
   'chat', 'a0000000-0000-0000-0003-000000000009',
   '2026-09-23T09:41:00Z'::timestamptz - interval '9 days' + interval '9 hours',
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '9 days' + interval '9 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '9 days' + interval '9 hours'),
  ('a0000000-0000-0000-0004-000000000030', 'a0000000-0000-0000-0000-000000000001',
   'Acho que é o celular, fico até tarde vendo notificações sem perceber o tempo passando.',
   'chat', 'a0000000-0000-0000-0003-000000000011',
   '2026-09-23T09:41:00Z'::timestamptz - interval '9 days' + interval '9 hours' + interval '5 minutes',
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '9 days' + interval '9 hours' + interval '5 minutes',
   '2026-09-23T09:41:00Z'::timestamptz - interval '9 days' + interval '9 hours' + interval '5 minutes'),
  ('a0000000-0000-0000-0004-000000000031', 'a0000000-0000-0000-0000-000000000001',
   'Vou tentar isso essa semana e te conto como foi.',
   'chat', 'a0000000-0000-0000-0003-000000000013',
   '2026-09-23T09:41:00Z'::timestamptz - interval '9 days' + interval '9 hours' + interval '10 minutes',
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '9 days' + interval '9 hours' + interval '10 minutes',
   '2026-09-23T09:41:00Z'::timestamptz - interval '9 days' + interval '9 hours' + interval '10 minutes'),
  ('a0000000-0000-0000-0004-000000000032', 'a0000000-0000-0000-0000-000000000001',
   'Queria comentar sobre uma coisa boa que aconteceu hoje, pra variar.',
   'chat', 'a0000000-0000-0000-0003-000000000015',
   '2026-09-23T09:41:00Z'::timestamptz - interval '10 days' + interval '18 hours',
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '10 days' + interval '18 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '10 days' + interval '18 hours'),
  ('a0000000-0000-0000-0004-000000000033', 'a0000000-0000-0000-0000-000000000001',
   'Recebi um elogio inesperado de um colega sobre um trabalho que fiz semanas atrás.',
   'chat', 'a0000000-0000-0000-0003-000000000017',
   '2026-09-23T09:41:00Z'::timestamptz - interval '10 days' + interval '18 hours' + interval '5 minutes',
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '10 days' + interval '18 hours' + interval '5 minutes',
   '2026-09-23T09:41:00Z'::timestamptz - interval '10 days' + interval '18 hours' + interval '5 minutes'),
  ('a0000000-0000-0000-0004-000000000034', 'a0000000-0000-0000-0000-000000000001',
   'Me senti valorizado, foi um respiro no meio da rotina puxada.',
   'chat', 'a0000000-0000-0000-0003-000000000019',
   '2026-09-23T09:41:00Z'::timestamptz - interval '10 days' + interval '18 hours' + interval '10 minutes',
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '10 days' + interval '18 hours' + interval '10 minutes',
   '2026-09-23T09:41:00Z'::timestamptz - interval '10 days' + interval '18 hours' + interval '10 minutes')
on conflict (id) do nothing;

-- =========================================================================
-- entry_tags da conta A (4 tags aplicadas a um subconjunto das entradas)
-- =========================================================================

insert into public.entry_tags (entry_id, tag_id, user_id) values
  -- trabalho
  ('a0000000-0000-0000-0004-000000000008', 'a0000000-0000-0000-0001-000000000001', 'a0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0004-000000000013', 'a0000000-0000-0000-0001-000000000001', 'a0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0004-000000000019', 'a0000000-0000-0000-0001-000000000001', 'a0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0004-000000000024', 'a0000000-0000-0000-0001-000000000001', 'a0000000-0000-0000-0000-000000000001'),
  -- família
  ('a0000000-0000-0000-0004-000000000007', 'a0000000-0000-0000-0001-000000000002', 'a0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0004-000000000016', 'a0000000-0000-0000-0001-000000000002', 'a0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0004-000000000020', 'a0000000-0000-0000-0001-000000000002', 'a0000000-0000-0000-0000-000000000001'),
  -- sono
  ('a0000000-0000-0000-0004-000000000009', 'a0000000-0000-0000-0001-000000000003', 'a0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0004-000000000021', 'a0000000-0000-0000-0001-000000000003', 'a0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0004-000000000029', 'a0000000-0000-0000-0001-000000000003', 'a0000000-0000-0000-0000-000000000001'),
  -- saúde
  ('a0000000-0000-0000-0004-000000000006', 'a0000000-0000-0000-0001-000000000004', 'a0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0004-000000000011', 'a0000000-0000-0000-0001-000000000004', 'a0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0004-000000000017', 'a0000000-0000-0000-0001-000000000004', 'a0000000-0000-0000-0000-000000000001')
on conflict (entry_id, tag_id) do nothing;

-- =========================================================================
-- Conta B — 1 entrada, sem tags, sem chat
-- =========================================================================

insert into public.entries (
  id, user_id, content, source, occurred_at,
  embedding_status, pii_status, pii_spans, created_at, updated_at
) values
  ('b0000000-0000-0000-0004-000000000001', 'b0000000-0000-0000-0000-000000000001',
   'Hoje foi um dia comum, nada de especial pra registrar além do cansaço de sempre.',
   'manual', '2026-09-23T09:41:00Z'::timestamptz - interval '2 days' + interval '10 hours',
   'pending', 'clean', '[]'::jsonb,
   '2026-09-23T09:41:00Z'::timestamptz - interval '2 days' + interval '10 hours',
   '2026-09-23T09:41:00Z'::timestamptz - interval '2 days' + interval '10 hours')
on conflict (id) do nothing;

-- Conta C — nenhuma entrada, nenhuma tag, nenhum chat. Só o cadastro
-- (auth.users + trigger de profiles) acima já basta.
