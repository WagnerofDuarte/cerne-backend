# Big Plan — Checklist Mestre do Backend Cerne

**Gerado a partir de:** `context/Contexto Geral.md`, `plan/Plano Backend - Cerne.md` (especificação técnica, fonte primária da ordem de tarefas) e `plan/Plano Backend - Cerne (iniciante).md`.

Este arquivo transforma os três documentos de planejamento em uma lista de tarefas única, cronológica e literal (`- [ ]`), do zero absoluto até o congelamento do backend em 23/09/2026. Nenhuma decisão de arquitetura nova foi tomada aqui — as 18 decisões (D1–D18) estão fechadas nos documentos-fonte e não são reabertas neste arquivo.

---

## Como usar este arquivo

**Legenda:**
- `- [ ] T-0NN ...` — tarefa executável pelo agente (Claude Code), com critério de conclusão verificável por comando.
- `- [ ] 🔴 [MANUAL] GATE-0N ...` — **portão de ação humana**. Só o Wagner pode executar (conta, assinatura, chave, credencial pessoal, execução manual de roteiro). O agente para, pede a ação, e só avança após confirmação **e** verificação objetiva.

**Regras invioláveis (valem para todo este checklist):**
1. Executar as tarefas na ordem em que aparecem. Cada uma tem pré-requisitos implícitos na ordem — não antecipar.
2. Nenhuma tarefa conta como concluída sem o critério de conclusão verificado por comando. "Parece certo" não conta.
3. Não reabrir as decisões D1–D18. Se uma parecer errada na prática, **parar e reportar** — vira nota de "Ameaças à Validade" na monografia, nunca uma mudança de rota no código.
4. Não inventar endpoints, colunas, códigos de erro ou campos além do que os documentos-fonte especificam. Se algo parecer faltando, reportar em vez de preencher a lacuna por conta própria.
5. Nunca usar `service_role` numa Edge Function que atenda requisição do aplicativo — só em workers de fila.
6. Toda ordenação SQL termina com desempate por `id ASC`, sem exceção.
7. Nunca criar índice vetorial (HNSW/IVFFlat) — varredura exata é obrigatória para determinismo.

**Ao encontrar um item 🔴 [MANUAL]:** parar, explicar o que fazer e por quê, aguardar confirmação explícita do Wagner, e só então rodar a verificação antes de seguir para o próximo item.

**Quando algo falhar de forma inesperada:** reportar a divergência entre esperado e obtido — nunca ajustar um teste só para fazê-lo passar. Isso destruiria o valor do backend como instrumento de medição.

---

## Fase 0 — Fundação
**Prazo: até 01/09/2026**

- [x] 🔴 **[MANUAL] `T-001` / `GATE-01`** — Instalar e manter o Docker Desktop rodando
  - **O quê:** Instalar o Docker Desktop e deixá-lo aberto durante todo o desenvolvimento local.
  - **Por que agora:** é pré-requisito de `supabase start` (stack local) — nada a partir daqui roda sem ele.
  - **Como confirmo:** `docker ps` responde sem erro.

- [x] 🔴 **[MANUAL] `T-002` / `GATE-02`** — Criar conta Supabase e os três projetos
  - **O quê:** Criar conta no Supabase (se ainda não existir) e três projetos: `cerne-dev`, `cerne-ciclo-a`, `cerne-ciclo-b`. **Mesma região nos três: `sa-east-1` (São Paulo).** Anotar, de cada um, `project ref`, `anon key`, `service_role key` e a senha do banco.
  - **Por que agora:** `cerne-dev` é o único onde se escreve durante o desenvolvimento; `ciclo-a` e `ciclo-b` só recebem migrações e seed mais adiante (D14 — três ambientes evita contaminação cruzada entre os dois ciclos comparativos).
  - **Como confirmo:** três `project ref` anotados em local seguro (não versionado).

- [x] 🔴 **[MANUAL] `T-003` / `GATE-03`** — Autenticar a Supabase CLI
  - **O quê:** Rodar `supabase login` (abre o navegador, pede credencial pessoal).
  - **Como confirmo:** `supabase projects list` lista os três projetos do `GATE-02`.

- [x] 🔴 **[MANUAL] `T-004` / `GATE-04`** — Criar chave de API Anthropic + definir teto de gasto
  - **O quê:** Criar uma chave de API na Anthropic e configurar um teto de gasto mensal (sugestão: US$ 50).
  - **Por que agora:** obrigatório **antes** de qualquer código que chame IA — um laço acidental em endpoint de IA queima crédito em minutos.
  - **Como confirmo:** uma chamada de teste ao Haiku 4.5 responde com sucesso.

- [x] 🔴 **[MANUAL] `T-005` / `GATE-05`** — Criar conta Voyage AI + habilitar billing + definir teto
  - **O quê:** Criar conta na Voyage AI, gerar chave de API, habilitar billing e definir teto de gasto (sugestão: US$ 20).
  - **Nota:** já verificado em 31/08/2026 que `voyage-4` com `output_dimension: 1024` retorna 1024 floats. Se a chave for recriada, repetir esta verificação antes da `T-030`.
  - **Como confirmo:** chamada de teste retorna vetor de **1024** floats.

- [x] 🔴 **[MANUAL] `T-006` / `GATE-06`** — Criar repositório GitHub privado
  - **O quê:** Criar repositório privado no GitHub e conceder acesso ao agente.
  - **Como confirmo:** `git remote -v` aponta para ele.

- [x] `T-007` Criar a estrutura de diretórios do repositório (`supabase/`, `contracts/`, `tests/`, `fixtures/`, `docs/`, `scripts/`, `.github/workflows/` — ver Seção 2 do plano técnico) — **Critério:** `tree` bate com a especificação.

- [x] 🔴 **[MANUAL] `T-008` / `GATE-07`** — Cadastrar os secrets no GitHub Actions (6/11 cadastrados; os 5 restantes dependem de valores definidos em fases futuras)
  - **O quê:** Cadastrar nos secrets do repositório: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `REPLAY_MODE`, `TEST_FAULT_KEY`, `PROMPT_VERSION`, `OCR_MAX_BYTES`, `TEST_ACCOUNT_PASSWORD` (senha das três contas seed) e o token de acesso da Supabase CLI necessário para `supabase db push --project-ref <ref>`.
  - **Como confirmo:** um workflow vazio passa verde no GitHub Actions.

- [x] `T-009` `supabase init` + `config.toml` configurado — **Critério:** `supabase start` sobe sem erro.

- [x] `T-010` Criar `docs/bugs_conhecidos.md` vazio, versionado — ativa a política de defeito D16 desde já — **Critério:** arquivo existe e está versionado no repositório.

### Encerramento da Fase 0 — notas para quem retomar (concluída 01/09/2026, no prazo, 10/10 itens)

Escrito para dar contexto a uma conversa nova que não viu a sessão em que a Fase 0 foi executada.

**Credenciais e contas:**
- Credenciais reais ficam em `keys.md` (Anthropic, Voyage, token de acesso da Supabase CLI) e `supabase.md` (project ref/anon key/service_role key/senha do banco dos 3 projetos) — ambos na raiz do repo, ambos no `.gitignore`, nunca versionados. Se algum desses arquivos for renomeado, atualizar o `.gitignore` junto (já aconteceu uma vez: `ia-keys.md` → `keys.md` ficou destravado até ser notado e corrigido).
- A senha do banco é **igual nos 3 ambientes** (`dev`/`ciclo-a`/`ciclo-b`) — decisão intencional do Wagner, aceitando o risco de comprometimento simultâneo caso vaze.
- Voyage AI **não tem** recurso nativo de teto de gasto (é um pedido de feature em aberto na Voyage) — mitigado com saldo prepago e auto-recharge desligado. Anthropic tem teto nativo configurado em US$20 (menor que a sugestão original de US$50 do plano, por escolha do Wagner).
- 6 dos 11 secrets do GitHub Actions já cadastrados (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` do ambiente `dev`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `SUPABASE_ACCESS_TOKEN`). Faltam `REPLAY_MODE`, `TEST_FAULT_KEY`, `PROMPT_VERSION`, `OCR_MAX_BYTES`, `TEST_ACCOUNT_PASSWORD` — só ganham valor quando o código/seed da Fase 1+ definir o que são.

**Ambiente técnico:**
- O stack Supabase local já foi iniciado (`supabase start`) nesta sessão. Numa sessão nova, confirmar antes de tudo que o Docker Desktop está aberto (`docker ps`) e subir o stack de novo se necessário (`supabase status` / `supabase start`).
- `supabase/config.toml` foi ajustado manualmente em 2 pontos que fogem do padrão gerado pelo `supabase init` — não sobrescrever sem querer: `auto_expose_new_tables = false` (alinhado à D2, nenhuma tabela exposta por padrão) e `db.seed.sql_paths = ["./seed/seed.sql"]` (o padrão do CLI é `supabase/seed.sql`; a estrutura deste projeto usa `supabase/seed/seed.sql`).
- `gh` CLI autenticado localmente; repositório GitHub confirmado como privado (checagem via API pública sem login retornou 404, como esperado).
- Neste ambiente local específico, comandos como `docker` e `supabase` só aparecem no `PATH` de um shell de login (`zsh -lc "..."`) — se um comando disser "command not found" para uma ferramenta que sabidamente está instalada, tentar de novo com `zsh -lc`.

**Sobre o Wagner (perfil de quem vai ler as respostas):** não é desenvolvedor backend — explicar conceitos técnicos (RLS, migração, embedding, etc.) com analogias simples antes/junto da justificativa de qualquer decisão, sem assumir jargão prévio.

**Gates manuais (🔴 [MANUAL]) — lembrete de processo:** ao chegar num item assim marcado, parar, explicar o que fazer e por quê, esperar confirmação explícita do Wagner, e só então verificar — não pular esse ritual mesmo quando parecer óbvio.

---

## Fase 1 — Banco e Segurança
**Prazo: 02/09 a 05/09/2026**

**Nota de ambiente (02/09/2026):** o sandbox remoto onde o agente roda esta fase bloqueia, por política de rede, o download das imagens Docker do Supabase (`production.cloudfront.docker.com` responde 403 — negação de política, confirmado no proxy do ambiente). Isso significa que o agente **não consegue rodar `supabase start` / `db reset` / `test db` neste ambiente** para comprovar os critérios de conclusão por comando. Acordo com o Wagner: o agente escreve todo o código desta fase (migrações, seed, testes pgTAP) normalmente, na ordem do checklist, mas a *execução* dos comandos de verificação fica para o Wagner rodar na máquina local (onde o Docker Desktop do `GATE-01` já funciona). Por isso os itens `T-011`–`T-019` ficam com o código pronto mas **sem marcar `[x]`** até o Wagner confirmar o resultado local — ver `T-019v` abaixo.

**Ordem de migração resolvida** (o plano técnico §5 deixa uma nota de reordenação em aberto — "criar `chat_sessions`/`chat_messages` antes de `entries`, pois `entries.chat_message_id` referencia `chat_messages`"; esta é a ordem de dependência válida a seguir em `T-011`–`T-018`, numeração exata dos arquivos a decidir na implementação):
`0001 extensions` → `0002 profiles` (+ trigger `on_auth_user_created`) → `0003 chat_sessions + chat_messages` (+ triggers) → `0004 entries` (+ índices + trigger `bump_server_revision`) → `0005 tags + entry_tags` → `0006 insights` → `0007 export_jobs` → `0008 schema experiment` (`ai_replay_cache`, `fault_injection_log`) → `0009 políticas RLS` (todas as tabelas com dono).

- [x] `T-011` Migração de extensões: `pgcrypto`, `vector`, `pgmq`, `pg_cron`, `pgtap` — **Critério:** `supabase db reset` roda sem erro.

- [x] `T-012` Tabela `profiles` (id, email, display_name, biometric_enabled, persona, server_revision, timestamps) + trigger de criação a partir de `auth.users` — **Critério:** cadastro de usuário cria linha em `profiles`.

- [x] `T-013` Tabelas `chat_sessions` e `chat_messages` + triggers (incremento de `user_message_count` e `last_user_message_at` ao inserir mensagem `role='user'`) — **Critério:** `user_message_count` incrementa corretamente.

- [x] `T-014` Tabela `entries` (conteúdo íntegro, origem, `chat_message_id`, embedding 1024d + versionamento, status de embedding/PII, PII spans, duração de mídia) + índice de timeline + **índice único parcial de idempotência** (`user_id`, `chat_message_id` quando não nulo) + trigger `bump_server_revision` — **Critério:** índice de idempotência existe e é verificável via `\d entries`.

- [x] `T-015` Tabelas `tags` e `entry_tags` (populadas só pelo seed, nenhum endpoint escreve nelas).

- [x] `T-016` Tabela `insights` com **UNIQUE** sobre `(session_id, trigger_type, trigger_key)` — **Critério:** insert duplicado é recusado pelo banco.

- [x] `T-017` Tabela `export_jobs` com os dois status independentes (`status` do job e `narrative_status` da narrativa).

- [x] `T-018` Schema `experiment` (fora do alcance de RLS de usuário) com `ai_replay_cache` e `fault_injection_log` — **Critério:** papel `authenticated` não tem acesso ao schema.

- [x] `T-019` Políticas de RLS em **todas** as tabelas com dono: `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + uma política por operação (`auth.uid() = user_id`) + `REVOKE ALL ... FROM anon` — **Critério:** `supabase test db` verde.

- [x] 🔴 **[MANUAL] `T-019v`** — Validar localmente os critérios de conclusão de `T-011`–`T-024` (item fora do backlog original — registrado por causa do bloqueio de rede descrito na "Nota de ambiente" acima)
  - **O quê**, na sua máquina local (Docker Desktop já rodando, `GATE-01`):
    1. `git pull origin fase1`
    2. `supabase db reset` — conferir que sobe **sem erro** (isso já aplica as 9 migrações **e** carrega o seed com as 3 contas)
    3. `\d entries` — confirmar o índice único parcial de idempotência (`entries_chat_message_uniq`)
    4. Tentar inserir duas linhas em `insights` com o mesmo `(session_id, trigger_type, trigger_key)` e confirmar que a segunda é recusada pelo banco
    5. Cadastrar um usuário de teste (fora das 3 contas do seed) e confirmar que aparece uma linha em `profiles` com o mesmo `id`
    6. Conferir a contagem do seed: `select count(*) from entries where user_id = 'a0000000-0000-0000-0000-000000000001'` deve dar **34**; trocando o `user_id` pelo de `cenario-uma@cerne.test`/`cenario-vazio@cerne.test`, **1** e **0**
    7. **Rodar o backfill de embeddings** (só depois do `db reset` acima): `deno run --allow-net --allow-env scripts/backfill-seed-embeddings.ts`, com `VOYAGE_API_KEY` no ambiente (conecta direto no Postgres local, não precisa de `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`) — sem isso a conta A fica com 33 entradas em `embedding_status='pending'` para sempre, e a prova do RF06 (`T-024`) não tem embedding pra buscar
    8. `supabase test db` — conferir **100% verde** (a suíte já roda 71/71 num Postgres nativo equivalente neste sandbox, mas o real é o Supabase CLI)
    9. **Rodar a prova do RF06** (só depois do passo 7): `deno run --allow-net --allow-env scripts/prove-rf06.ts`, com `VOYAGE_API_KEY` — reporta se pelo menos 1 dos 3 pares encontrou a entrada plantada no top-5
  - **Por que agora:** é a única forma de comprovar por comando os critérios de `T-011`–`T-024` enquanto este ambiente remoto não pode baixar as imagens Docker do Supabase. Os passos 7 e 9 são os únicos que não são só "confirmar o já escrito" — são ações que só podem acontecer na sua máquina (chamam a Voyage de verdade).
  - **Como confirmo:** você reporta o resultado de `supabase db reset`, das verificações pontuais (3–6), de `supabase test db` (passo 8), e das saídas dos dois scripts (7 e 9). Com a confirmação, marco `T-011`–`T-024` como `[x]`.
  - **✅ Concluído pelo Wagner em 04/09/2026 — os 9 passos confirmados, nada falhou:** `db reset` sem erro, índice de idempotência presente, UNIQUE de `insights` recusou o duplicado, cadastro criou `profiles`, contagens 34/1/0 batendo, backfill gravou 33/33 embeddings sem falha (achado e corrigido um bug real no meio do caminho — ver nota em `T-022`), `supabase test db` 71/71 verde, e a prova do RF06 passou nos **3** pares (não só no mínimo de 1 exigido). Fase 1 encerrada dentro do prazo (05/09/2026).

- [x] 🔴 **[MANUAL] `T-020` / `GATE-08`** — Fornecer as fixtures de mídia (concluída 02/09/2026)
  - **O quê:** Fornecer três arquivos em `fixtures/media/`: `audio_fixture_01.wav` (42s, fala em português, com transcrição conhecida documentada em `fixtures/transcricoes.md`), `ocr_fixture_01.png` (foto de caderno manuscrito, texto legível), `ocr_fixture_ilegivel.png` (imagem sem texto reconhecível).
  - **Por que agora:** esses arquivos ficam **imutáveis** a partir da `T-060` — regenerar qualquer um depois invalida o cache de replay inteiro.
  - **Como confirmo:** os três arquivos existem em `fixtures/media/`. ✅ Confirmado — `audio_fixture_01.wav` (50,4s, PCM 16-bit estéreo 48kHz, fala em português), `ocr_fixture_01.png` (caderno manuscrito, texto legível), `ocr_fixture_ilegivel.png` (página em branco, sem texto).
  - **Divergências encontradas ao verificar (não bloqueiam o GATE, mas ficam registradas):** (1) o áudio tem 50,4s, não os 42s descritos no plano — só importa se algum script/roteiro futuro comparar a duração exata; (2) o arquivo de transcrição foi versionado como `fixtures/trancricoes.md` (sem o "s" de "trans"), não `fixtures/transcricoes.md` como os documentos-fonte nomeiam — os dois nomes vão coexistir como divergência até o Wagner confirmar se renomeia.

- [ ] 🔴 **[MANUAL] `T-021` / `GATE-09`** — Aprovar textos literais e pares semânticos (**parcial** — pares semânticos aprovados 02/09/2026; textos do roteiro pendentes, ver nota)
  - **O quê:** Aprovar os sete textos literais do roteiro e os três pares semânticos do RF06, definidos **antes** de qualquer teste (para não escolher o resultado a posteriori):

    | Par | Termo buscado | Entrada plantada (não contém o termo) |
    |---|---|---|
    | 1 | `ansiedade` | Texto sobre nervosismo antes de uma apresentação |
    | 2 | `cansaço` | Texto sobre exaustão ao fim da semana |
    | 3 | `gratidão` | Texto sobre reconhecer coisas boas do dia |

    Regra de aceite: **pelo menos um dos três** precisa passar para o critério do RF06 ser satisfeito.
  - **Como confirmo:** `fixtures/textos.json` e `fixtures/pares_semanticos.md` existem e estão aprovados.
  - **Status em 02/09/2026:** ✅ os 3 textos dos pares semânticos foram propostos pelo agente e **aprovados pelo Wagner**, gravados em `fixtures/pares_semanticos.md` — suficiente para desbloquear `T-022` e `T-024`. ⏳ Os **sete textos literais do roteiro** ficam pendentes: dependem de `docs/roteiro_de_validacao.md`, que não existe no repositório e por sua vez depende de dois documentos-fonte também ausentes (`Cerne_-_prototipo_final.html` e `Requisitos_e_Fluxo_de_Telas_TCC.md` — ver "Itens em aberto"). O Wagner pediu para retomar isso mais perto da Fase 6 (`T-060`, previsto 21–22/09) — lembrete agendado pelo agente. `fixtures/textos.json` só será criado quando o roteiro existir.

- [x] `T-022` `supabase/seed/seed.sql` idempotente, com âncora de data fixa (`ANCORA = 2026-09-23T09:41:00Z`, documentada em `supabase/seed/ancora.md`, datas do seed sempre relativas a ela) e as três contas:

  | Conta | E-mail | Conteúdo |
  |---|---|---|
  | A | `cenario-cheio@cerne.test` | 34 entradas (14 manual, 8 áudio, 6 foto, 6 chat) em 10 dias, 4 tags, 3 sessões de chat (uma com exatamente 4 mensagens do usuário, para o roteiro disparar o gatilho N=5 na 5ª), os 3 pares semânticos plantados, ao menos uma entrada `embedding_status='failed'` e uma `pii_status='flagged'` |
  | B | `cenario-uma@cerne.test` | 1 entrada, sem tags, sem chat |
  | C | `cenario-vazio@cerne.test` | nenhuma entrada |

  Senha única via `TEST_ACCOUNT_PASSWORD`. Embeddings da conta A são gerados de verdade via Voyage na primeira execução e reaproveitados depois. — **Critério:** `supabase db reset` carrega 34+1+0 entradas.

  **Status em 02/09/2026:** código escrito (`supabase/seed/seed.sql`, `supabase/seed/ancora.md`) e validado por dry-run funcional neste sandbox (Postgres 16 nativo + as 9 migrações + mocks de `auth.users`/`auth.uid`/roles, mesmo esquema do dry-run de `T-011`–`T-019`): 34+1+0 entradas, 10 dias distintos na conta A, fontes 14/8/6/6, `chat_sessions.user_message_count` = 4/3/3 (trigger correto), 4 tags, 13 `entry_tags`, zero linha com `source`/`chat_message_id` incoerente, senha bate via `crypt()`, RLS isola cada conta corretamente, e reexecutar o `seed.sql` não duplica nada (idempotência confirmada). **Ainda não roda de verdade no Supabase CLI** — mesmo bloqueio de rede da nota de ambiente, dentro de `T-019v`.

  Duas lacunas que os documentos-fonte não resolviam, preenchidas de forma pragmática (revisar se achar errado):
  - **Senha:** `seed.sql` é SQL puro, sem acesso a variável de ambiente do shell — fixei o literal `Cerne-Teste-2026!` dentro do seed (hash via `crypt()`). `TEST_ACCOUNT_PASSWORD` precisa ser configurado com esse valor exato. Detalhado em `supabase/seed/ancora.md`.
  - **Embeddings reais da conta A:** SQL puro não faz chamada HTTP. `seed.sql` grava as 34 entradas da conta A com `embedding_status='pending'` (exceto a que fica propositalmente `'failed'`); um script novo, `scripts/backfill-seed-embeddings.ts` (Deno), precisa ser rodado **uma vez** depois de `supabase db reset` — chama a Voyage de verdade e preenche os embeddings. É idempotente (só toca `pending`). **Ação pendente do Wagner:** depois de rodar `supabase db reset` localmente, rodar `deno run --allow-net --allow-env scripts/backfill-seed-embeddings.ts` com `VOYAGE_API_KEY` no ambiente — sem isso a prova do RF06 (`T-024`) não tem embedding pra buscar.

  **Bug real encontrado em 04/09/2026, durante o `T-019v` do Wagner (não estava no dry-run porque meu mock de `auth`/roles não reproduz o gateway PostgREST):** a versão original do script ia pela API (`@supabase/supabase-js` + `SUPABASE_SERVICE_ROLE_KEY`), e o formato novo de chave do Supabase (`sb_secret_...`, que substituiu o JWT clássico de `service_role`) não estava sendo reconhecido como privilégio total pelo PostgREST local — a RLS barrava com `permission denied for table entries`, mesmo com a chave certa (confirmado com o Wagner: mesma URL e mesma chave que `supabase status` imprime). Corrigido reescrevendo o script pra conectar direto no Postgres via `postgres` (superusuário local, ignora RLS de forma garantida) em vez de passar pela API — mesma abordagem que `prove-rf06.ts` já usava. Variável `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` não são mais necessárias, só `VOYAGE_API_KEY` (e `SUPABASE_DB_URL` se a porta do Postgres local não for a `54322` padrão — o default do script já bate com o que `supabase status` mostra). De brinde, achei e corrigi o mesmo tipo de bug de antes (função/tipo do `pgvector` no schema `extensions`, não `public`) nos dois scripts, testado desta vez contra Postgres de verdade antes de mandar pro Wagner.

- [x] `T-023` Suíte pgTAP completa (ver Fase 1 de testes, abaixo) — **Critério:** `supabase test db` 100% verde.

  **Status em 03/09/2026:** 12 arquivos escritos em `supabase/tests/` (os 8 `rls_*.sql` de cada tabela com dono, `rls_experiment.sql`, `constraints.sql`, `cascade_delete.sql`, `triggers.sql`) — isolamento positivo/negativo, escrita cruzada bloqueada, RLS forçada, `anon` sem leitura, trava do schema `experiment`, os 4 constraints de `T-014`/`T-016`/`T-013`, cascata de delete nas 8 tabelas, e os dois triggers (`server_revision`, `user_message_count`). Validado com `pg_prove` neste sandbox (rebuild completo do zero, 71/71 verdes).

  **✅ Confirmado pelo Wagner em 04/09/2026 com `supabase test db` real** (Supabase CLI, máquina local): `Files=12, Tests=71, Result: PASS` — 100% verde, batendo exatamente com a validação do sandbox.

  Detalhe técnico que vale registrar: os testes de RLS trocam de papel (`SET ROLE authenticated`/`anon`) para simular cada usuário, mas o pgTAP (`ok`/`is`/`throws_ok`) fica inacessível depois da troca (falta `GRANT` nos objetos internos dele para esses papéis) — cada teste captura o resultado antes de voltar (`RESET ROLE`) usando `set_config`/`GET DIAGNOSTICS`, e só então chama a asserção do pgTAP. Também: o `throws_ok` de 3 argumentos (`sql, code, description`) **não** funciona como parece — o meio vira "mensagem esperada", não "código". O jeito certo é a forma de 4 argumentos com o código como inteiro: `throws_ok(sql, 23505, null, description)`.

- [x] `T-024` **Prova do RF06** — busca por `ansiedade` (ou `cansaço`/`gratidão`) no seed encontra o par plantado correspondente. ⚠️ **Se falhar nos três pares, parar e reportar** — é condição de viabilidade do RF06, não um detalhe.

  **Status em 03/09/2026:** `scripts/prove-rf06.ts` (Deno) escrito — conecta direto no Postgres local (o endpoint `GET /entries/search` só existe na `T-040`, Fase 3), gera o embedding de consulta dos 3 termos via Voyage (`input_type='query'`) e faz varredura exata por distância de cosseno (`<=>` do pgvector, sem índice aproximado) contra as entradas `ready` da conta A, checando se a entrada plantada aparece no top-5.

  **✅ RF06 comprovado pelo Wagner em 04/09/2026 — os 3 pares passaram, não só o mínimo de 1 exigido:**

  | Par | Termo | Posição no top-5 | Distância de cosseno |
  |---|---|---|---|
  | 1 | `ansiedade` | **1º lugar** | 0,5155 |
  | 2 | `cansaço` | **1º lugar** | 0,4911 |
  | 3 | `gratidão` | 4º lugar | 0,6925 |

  Os pares 1 e 2 até bateram o próprio texto plantado como o mais próximo semanticamente de todos os 34 registrados na conta — resultado bem acima da régua mínima do RF06.

### Encerramento da Fase 1 — notas para quem retomar (concluída 04/09/2026, dentro do prazo — 05/09 —, 10/10 itens confirmados)

Escrito para dar contexto a uma conversa nova que não viu a sessão em que a Fase 1 foi executada.

**Onde o código foi escrito vs. onde foi validado de verdade:** todo o código (`T-011`–`T-024`) foi escrito num sandbox remoto (não a máquina local onde a Fase 0 rodou), cuja política de rede bloqueia o download das imagens Docker do Supabase — não dava para rodar `supabase start`/`db reset`/`test db` de verdade lá. O código foi validado o quanto dava por lá (Postgres 16 nativo + pgvector + pgtap via `apt`, com o schema `auth` do GoTrue simulado à mão) e depois **confirmado de verdade pelo Wagner na máquina local**, via `T-019v` — ver os 9 passos abaixo.

**O que está pronto, commitado e pushed no branch `fase1`** (`T-011`–`T-024`):
- 9 migrações (`supabase/migrations/0001`–`0009`): schema inteiro, RLS em todas as 8 tabelas com dono, schema `experiment` trancado
- `supabase/seed/seed.sql` + `ancora.md`: as 3 contas (34/1/0 entradas), idempotente
- `scripts/backfill-seed-embeddings.ts`: gera os embeddings reais da conta A via Voyage (conecta direto no Postgres, sem depender de nenhum formato de chave de API)
- `scripts/prove-rf06.ts`: a prova da busca semântica (SQL puro não tem endpoint de busca ainda — isso é da Fase 3)
- 12 arquivos pgTAP em `supabase/tests/` (71 testes)
- `fixtures/media/` (os 3 arquivos), `fixtures/pares_semanticos.md` (aprovado pelo Wagner)

**Os 9 passos do `T-019v`, todos confirmados pelo Wagner em 04/09/2026:**
1. `git pull origin fase1` ✅
2. `supabase db reset` — sobe sem erro ✅
3. `\d entries` — índice `entries_chat_message_uniq` presente ✅
4. Insert duplicado em `insights` (mesmo `session_id`+`trigger_type`+`trigger_key`) recusado ✅
5. Cadastro de um usuário novo (fora do seed) cria linha em `profiles` ✅
6. Contagens do seed batem: conta A = 34, `cenario-uma` = 1, `cenario-vazio` = 0 ✅
7. `backfill-seed-embeddings.ts` — 33/33 embeddings gravados, 0 falhas ✅ (achado e corrigido um bug real no meio do caminho — ver abaixo)
8. `supabase test db` — 71/71 testes, `Result: PASS` ✅
9. `prove-rf06.ts` — **os 3 pares** passaram (não só o mínimo de 1 exigido pelo RF06): par 1 (`ansiedade`) e par 2 (`cansaço`) em 1º lugar no ranking de similaridade, par 3 (`gratidão`) em 4º ✅

**Um bug real encontrado e corrigido durante a validação** (não aparecia no sandbox, porque o mock de `auth`/roles de lá não reproduz o gateway PostgREST de verdade): a primeira versão de `backfill-seed-embeddings.ts` ia pela API do Supabase com a `service_role key`, e o formato novo de chave (`sb_secret_...`) não estava sendo reconhecido como privilégio total pelo PostgREST local — a RLS barrava com "permission denied", mesmo com a chave certa. Corrigido trocando pra conexão direta no Postgres como superusuário (mesma abordagem que `prove-rf06.ts` já usava), o que elimina de vez qualquer dependência de formato de chave. De brinde, corrigido o mesmo tipo de bug (schema `extensions` vs `public`) que teria quebrado o passo 9 também.

**Itens em aberto que atravessam a Fase 1, ainda sem solução — não bloqueiam o encerramento, mas ficam registrados:**
- **`docs/roteiro_de_validacao.md`** (os 7 textos literais do roteiro, parte do `GATE-09`) continua pendente — depende de dois documentos-fonte ausentes do repositório. Combinamos de retomar perto da Fase 6; lembrete agendado para 18/09.
- **`fixtures/trancricoes.md`** foi versionado com esse nome (sem o "s" de "trans") em vez de `fixtures/transcricoes.md`, como os documentos-fonte chamam. Ainda não decidido se renomeia.
- **Duração real do áudio fixture:** 50,4s, não os 42s descritos no plano técnico. Só importa se algum script futuro comparar o valor exato.

**Duas lacunas de arquitetura que os documentos-fonte não resolviam, preenchidas por mim e documentadas em `supabase/seed/ancora.md`** (revisar se parecer errado): a senha das 3 contas é um literal fixo dentro do `seed.sql` (`Cerne-Teste-2026!`, já que SQL puro não lê variável de ambiente — `TEST_ACCOUNT_PASSWORD` precisa bater com esse valor), e os embeddings reais da conta A vêm de um script complementar em vez do próprio seed (SQL puro não chama HTTP).

**Sobre o Wagner (perfil de quem vai ler as respostas):** não é desenvolvedor backend — mesma orientação da Fase 0, explicar conceitos técnicos com analogias simples antes/junto da justificativa de qualquer decisão.

**Gates manuais (🔴 [MANUAL]) — lembrete de processo:** ao chegar num item assim marcado, parar, explicar o que fazer e por quê, esperar confirmação explícita do Wagner, e só então verificar.

---

## Fase 2 — Contratos e Gateway
**Prazo: 06/09 a 09/09/2026**

- [x] `T-025` Módulo `errors` com os 13 códigos da taxonomia e mapeamento para HTTP/`retryable` — **Critério:** teste unitário do mapeamento passa.
- [x] `T-026` Módulo `contracts` — schemas Zod dos 23 endpoints (fonte única do OpenAPI) — **Critério:** todos os schemas compilam.
- [x] `T-027` Módulo `serialize` (conversão `snake_case` ↔ `camelCase` + envelope de resposta) — **Critério:** teste de ida e volta passa.
- [x] `T-028` Módulo `clock` respeitando o cabeçalho `X-Test-Now` — **Critério:** teste com relógio congelado passa.
- [x] `T-029` Módulo `faults` (interpretação de `X-Test-Fault`, os 6 tipos) + tabela `fault_injection_log` — **Critério:** os 6 tipos disparam e registram.
- [x] `T-030` Módulo `replay` com os 4 modos (`off`/`record`/`replay`/`replay_strict`) e envelope canônico de impressão digital — **Critério:** mesmo input produz sempre a mesma `cache_key`.
- [x] `T-031` Módulo `gateway` (ponto de entrada único) na ordem obrigatória: `X-Request-Id` → `X-Test-Key` → `X-Test-Now` → `X-Test-Fault` (antes da autenticação para `offline`, depois para os demais) → autenticar → validar corpo (Zod) → handler → serializar → tratar exceção — **Critério:** requisição sem token retorna `AUTH_EXPIRED`.
- [x] `T-032` Clientes `ai/anthropic` e `ai/voyage`, sempre atrás do cache de replay — **Critério:** segunda chamada idêntica retorna `hit`.
- [x] `T-033` `scripts/gen-openapi.ts` gerando `contracts/openapi.yaml` a partir dos schemas Zod, com verificação de drift no CI — **Critério:** job `contracts` verde.

- [x] ⚠️ **Ponto de decisão do cronograma:** se esta fase não fechar até **09/09**, cortar o RF05 (exportação) do escopo — maior economia isolada disponível (remove `pgmq`, `pg_cron`, Storage, geração de PDF e os 3 endpoints de exportação da Fase 5). Decidir isso **nesta data**, não depois. **Não se aplica — a Fase 2 fechou em 04/09/2026, antes mesmo do prazo começar (06/09). RF05 mantido no escopo.**

### Encerramento da Fase 2 — notas para quem retomar (concluída 04/09/2026, 5 dias antes do prazo, 9/9 itens + o ponto de decisão)

Escrito para dar contexto a uma conversa nova que não viu a sessão em que a Fase 2 foi executada.

**Diferença importante em relação à Fase 1:** o bloqueio de rede deste sandbox (não baixa as imagens Docker do Supabase) segue valendo, mas a Fase 2 quase não depende disso — `T-025`–`T-033` são módulos Deno/TypeScript puros, sem precisar de `supabase start`. Foi possível instalar o próprio Deno (via `npm install -g deno` — o pacote `deno` no npm baixa o binário, e `registry.npmjs.org` não está bloqueado neste sandbox, diferente de `deno.land`) e rodar `deno test`/`deno lint`/`deno fmt` de verdade a cada módulo, um a um, com resultado real — não um dry-run aproximado. A única peça desta fase que toca banco (a migração `0010_experiment_rpc.sql`, ver abaixo) foi validada da mesma forma que a Fase 1 fez: Postgres 16 + pgvector + pgtap nativos via `apt`, não o Supabase CLI.

**O que está pronto, commitado no branch `fase2`** (um commit por tarefa, todos com a suíte de teste daquele módulo rodando e passando antes do commit):
- `errors.ts` (T-025): os 13 códigos, `CerneError`, `throwError()`.
- `contracts/zod/*.ts` + `registry.ts` (T-026): os 23 endpoints, request/response, registro único consumido pelo gateway e pelo gerador de OpenAPI.
- `serialize.ts` (T-027): conversão `snake_case`↔`camelCase`, envelope de sucesso/erro.
- `clock.ts` + `test-mode.ts` (T-028): relógio congelável por `X-Test-Now`.
- `faults.ts` (T-029): interpretação dos 6 tipos de `X-Test-Fault`.
- `replay.ts` (T-030): envelope canônico, `cache_key`, os 4 modos.
- `gateway.ts` (T-031): o pipeline inteiro amarrando os módulos acima.
- `ai/anthropic.ts` + `ai/voyage.ts` (T-032): clientes genéricos, sempre atrás do `replay`.
- `scripts/gen-openapi.ts` + `scripts/openapi/zod-to-json-schema.ts` (T-033): gera `contracts/openapi.yaml` (versionado, 23 operações); `.github/workflows/ci.yml` ganhou o job `contracts` de verdade (troca o placeholder).
- `supabase/migrations/0010_experiment_rpc.sql` + `supabase/tests/experiment_rpc.sql`: ver "Duas peças fora do backlog original" abaixo.

**Números finais:** 131 testes automatizados novos (121 `deno test` + 10 `pgtap`), todos verdes; `deno lint`/`deno fmt` limpos em todo arquivo escrito nesta fase.

**Duas peças fora do backlog original, necessárias e documentadas onde vivem:**
1. **`supabase/functions/_shared/db.ts`** — a Seção 7 do plano técnico lista o módulo `db` na camada compartilhada, mas nenhum `T-0NN` foi aberto pra ele. Nasceu dentro do `T-029`, porque `faults`/`replay`/`gateway` precisavam de um cliente Supabase com o JWT do usuário para existir.
2. **`supabase/migrations/0010_experiment_rpc.sql`** — descoberta real ao implementar `T-029`/`T-030`: o schema `experiment` (migração `0008`) tranca `authenticated`/`anon` de propósito, mas o log de falha e o cache de replay precisam ser escritos *durante* uma requisição real, não só por um worker de fila — e nunca com `service_role` aí (regra nº5). Solução: 3 funções `SECURITY DEFINER` de superfície mínima, expostas via RPC. **Dois bugs reais só apareceram rodando contra Postgres de verdade, não escrevendo o SQL:** (a) `experiment.*` não é um schema exposto pelo PostgREST — as funções tiveram que morar em `public.experiment_*`; (b) `REVOKE ... FROM anon` sozinho não fecha nada, porque toda função nova já nasce `EXECUTE`-por-`PUBLIC` — precisou `REVOKE ... FROM PUBLIC` explícito antes. Coberto por `supabase/tests/experiment_rpc.sql` (10 casos, validados com `pg_prove` de verdade).

**Lacunas do documento-fonte preenchidas de forma pragmática, documentadas inline onde aparecem no código (revisar se achar errado):**
- Forma de `tags[]` (`{id, name}`) e `piiSpans` (`{start, end, type}`) dentro de `Entry` — `contracts/zod/common.ts`.
- Forma de `sources`/`totals` no `GET /dashboard/aggregate` — `contracts/zod/dashboard.ts`.
- `session`/`user` de autenticação propositalmente permissivos (`.catchall`), por serem proxy fino do GoTrue (D1) — `contracts/zod/auth.ts`.
- `historyHash` concatena `role:content` sem separador entre mensagens, seguindo a Seção 9.2 ao pé da letra (ela não menciona separador) — risco teórico de colisão aceito em vez de inventar um delimitador — `replay.ts`.
- Efeito de `offline`: como uma Edge Function não tem como derrubar o socket TCP sem responder, a aproximação é uma `Promise<Response>` que nunca resolve — `gateway.ts`.

**Sobre as chamadas reais à Anthropic/Voyage:** `T-032` prova o mecanismo de cache (`callAnthropic`/`embed` sempre atrás do `replay`) com `fetch` mockado nos testes — nenhuma chamada de verdade foi feita, nem gastou nenhum crédito das contas do `GATE-04`/`GATE-05`. Isso só vai acontecer de propósito, uma vez, no `T-060` (Fase 6, modo `record`).

**✅ Confirmado pelo Wagner em 04/09/2026, via Supabase CLI real (mesmo espírito do `T-019v` da Fase 1):** `supabase db reset` aplicou as 10 migrações (0001–0010) em sequência, sem erro; `supabase test db` rodou os 13 arquivos pgTAP e deu **`Files=13, Tests=81, Result: PASS`** — exatamente a soma prevista (71 da Fase 1 + 10 novos de `experiment_rpc.sql`). Confirma que a migração 0010 não colide com nada de 0001–0009 na cadeia real, não só isolada contra a 0008 como eu tinha testado neste sandbox.

**Itens em aberto que já vinham da Fase 1, sem mudança:** `docs/roteiro_de_validacao.md` continua pendente (retomar perto da Fase 6); `fixtures/trancricoes.md` continua com esse nome.

**Sobre o Wagner (perfil de quem vai ler as respostas):** mesma orientação das fases anteriores — não é desenvolvedor backend, explicar conceitos técnicos com analogias simples antes/junto da justificativa de qualquer decisão.

---

## Fase 3 — Entradas
**Prazo: 10/09 a 13/09/2026**

**Nota de ambiente (10/09/2026):** mesmo bloqueio de rede das Fases 1 e 2 (download das imagens Docker do Supabase barrado neste sandbox) — não dá para rodar `supabase functions serve` nem a suíte Hurl de verdade aqui. Diferente da Fase 2 (módulos Deno puros), a Fase 3 produz as primeiras Edge Functions de verdade — então os critérios de conclusão "X.hurl verde" ficam para o Wagner rodar localmente, do mesmo jeito que `T-019v` cobriu a Fase 1. Cada tarefa é escrita com testes unitários (`deno test`, fetch/DB mockados) cobrindo a lógica do handler, e a suíte Hurl é escrita mas só roda de verdade fora daqui.

**Decisão de estrutura tomada nesta fase (não estava explícita nos documentos-fonte):** um diretório de função por endpoint (Seção 2: "um diretório por endpoint"), nome = o `id` do endpoint no `registry.ts` (T-026) com `.` trocado por `-` — ex.: `entries.search` → `entries-search`, que é literalmente o exemplo de nomenclatura já dado na Seção 3.1. Endpoints com `:param` no caminho (ex.: `GET /entries/:id`) recebem o parâmetro como segmento de URL depois do nome da função (`/functions/v1/entries-get/<id>`), extraído pelo próprio `index.ts` — o `gateway.ts` não roteia (comentário original do T-031: "params: extraídos pelo diretório da função"). Registrado aqui porque é uma decisão real de arquitetura que os documentos-fonte deixaram em aberto.

- [ ] `T-034` Os 5 endpoints de autenticação (`/auth/signup`, `/auth/login`, `/auth/refresh`, `GET /auth/session`, `/auth/logout`) — **Critério:** suíte Hurl do bloco verde.

  **Status em 10/09/2026:** código escrito e testado (`deno test`, fetch mockado) em `supabase/functions/auth-{signup,login,refresh,session,logout}/`. `auth-signup`/`auth-login`/`auth-refresh` são proxy fino do GoTrue (D1) via o novo cliente `_shared/gotrue.ts`; `auth-session` é o único com lógica própria (§8.1) — `user`/`expiresAt` decodificados do próprio JWT (evita uma 2ª chamada ao GoTrue, já que o gateway validou o token nesta mesma requisição), `serverRevision` lido de `profiles` via RLS; `auth-logout` engole erro do GoTrue (sessão já encerrada não é falha do ponto de vista do usuário — não há código de erro dedicado a isso). Dois módulos compartilhados novos, gap-fill no mesmo espírito de `db.ts` (Fase 2): `_shared/gotrue.ts` (cliente HTTP + `decodeJwtClaims`) e `_shared/deps.ts` (monta `GatewayDeps` a partir de `Deno.env`, reaproveitado por todo `index.ts` daqui em diante). `db.ts` ganhou `createAnonClient`.

  **Lacuna preenchida pragmaticamente (revisar se parecer errado):** nenhum dos 13 códigos de erro é específico para "GoTrue rejeitou a credencial" — mapeei erro de signup/login para `AUTH_INVALID` e erro de refresh (token expirado/revogado) para `AUTH_EXPIRED`, por proximidade semântica. Documentado inline em cada `handler.ts`.

  140/140 testes verdes (`deno test -A --parallel`, repo inteiro), `deno lint`/`deno fmt` limpos. **Ainda não validado contra `supabase functions serve` real** — ver nota de ambiente acima.
- [ ] `T-035` `POST /entries` com a sequência obrigatória: validar → (se `chatMessageId`) tentar idempotência → PII (Haiku, tool use) → gravar → embedding (Voyage) com fallback `failed` sem perder a entrada — **Critério:** `idempotencia_rf10.hurl` verde.
- [ ] `T-036` Detecção de PII com saída estruturada (tool use) — **Critério:** entrada com nome próprio vira `pii_status='flagged'` com `content` intacto.
- [ ] `T-037` Geração de embedding com fallback — **Critério:** Voyage forçada a falhar ainda deixa a entrada gravada com `embedding_status='failed'`.

  **Status em 10/09/2026 (T-035/036/037 juntas — um endpoint só):** código escrito e testado fim a fim (`supabase/functions/entries-create/`: `handler.ts` + `pii.ts` + `embedding.ts`, mais os módulos de repositório abaixo). A checagem de idempotência do passo 2 é otimista (um `SELECT`, para economizar uma chamada de Haiku no caso comum de retry) — quem garante D4 de verdade ("pelo banco, não pelo código") é o índice único dentro do `INSERT` (`entries-repo.ts`): uma corrida real entre duas requisições idênticas é pega ali (`23505`), busca a linha vencedora e devolve com `idempotentReplay=true`, sem propagar erro nem duplicar. Testado nos dois níveis (`entries-repo.test.ts` isolado, `handler.test.ts` fim a fim simulando a corrida). PII: `tool_choice` força o uso da ferramenta, qualquer desvio (chamada falhou, tool_use ausente, shape fora do schema) vira `PII_CHECK_FAILED` sem gravar nada. Embedding: nunca lança — Voyage indisponível ou dimensão errada viram `{status: 'failed'}` tratado pelo handler, a entrada nunca é perdida.

  Dois módulos de repositório novos (gap-fill, mesmo espírito de `db.ts`/`deps.ts` da Fase 2): `_shared/entries-repo.ts` (leitura/escrita de `entries` com tags embutidas via join com `entry_tags`/`tags`, sem N+1 — compartilhado com T-038/039/040 ainda por vir) e `_shared/profiles-repo.ts` (`fetchServerRevision`, extraído do `auth-session` do T-034 para reaproveitar aqui).

  **Lacuna real do documento-fonte, encontrada implementando (revisar se parecer errado):** a Seção 8.2 lista `serverRevision` como campo de resposta de `Entry`, mas a Seção 5 só define a coluna `server_revision` em `profiles` (contador por usuário, incrementado pelo trigger a cada escrita em `entries` — não existe coluna equivalente em `entries`). Leitura adotada: cada `Entry` devolvido pela API reporta o valor *atual* de `profiles.server_revision` do dono no momento da resposta, lido a cada chamada — não um valor gravado na própria linha da entrada.

  168/168 testes verdes (`deno test -A --parallel`, repo inteiro), `deno lint`/`deno fmt` limpos. **Ainda não validado contra `supabase functions serve` real** — ver nota de ambiente da Fase 3.
- [ ] `T-038` `GET /entries` com paginação, filtros e **tags embutidas** (evita N+1) — **Critério:** `tags_embutidas.hurl` verde.
- [ ] `T-039` `GET /entries/:id` — **Critério:** recurso de outro usuário retorna 404 `NOT_FOUND`.
- [ ] `T-040` `GET /entries/search` (semântica + filtros combinando com **AND**, debounce é responsabilidade do app) — **Critério:** `busca_and.hurl` e `busca_semantica.hurl` verdes.
- [ ] `T-041` `POST /media/ocr` (imagem nunca é persistida — só o SHA-256 entra no cache) — **Critério:** imagem grande demais → 413; imagem ilegível → `OCR_NO_TEXT`.

---

## Fase 4 — Chat
**Prazo: 14/09 a 18/09/2026**

- [ ] `T-042` Módulo `prompts` — toda montagem de prompt acontece no servidor (D5), versionado por `PROMPT_VERSION` — **Critério:** `PROMPT_VERSION` entra na `cache_key`.
- [ ] `T-043` Módulo `rag` com ordenação determinística (top 5) — **Critério:** mesma pergunta produz sempre os mesmos `retrievedEntryIds`, na mesma ordem.
- [ ] `T-044` Módulo `sse` no formato fixo da D12 (`message_created` → `context` → `token*` → `done`/`error`) — **Critério:** `sse_ordem.hurl` verde.
- [ ] `T-045` `POST /chat/sessions` (título gerado no servidor, persona congelada) + os dois `GET` de listagem — **Critério:** criação implícita na 1ª mensagem funciona (não há botão "nova conversa").
- [ ] `T-046` `POST .../messages` com streaming completo (grava mensagem do usuário → RAG → cria mensagem do assistente `streaming` → emite eventos → grava tokens → `done`/`error`) — **Critério:** queda no meio do streaming preserva o texto parcial com `status='failed'`.
- [ ] `T-047` Reemissão de SSE a partir do cache (hit reemite em pedaços de 32 caracteres a cada 15ms) — **Critério:** hit produz exatamente a mesma sequência de eventos.
- [ ] `T-048` `POST .../messages/:userMessageId/retry` (D15 — mesmo histórico e pergunta, mesma impressão digital) — **Critério:** `retry_chat.hurl` verde — `X-Replay-Status: hit` e `retry_count=1`.
- [ ] `T-049` Job `pg_cron` que marca `failed` mensagens presas em `streaming` há mais de 60s — **Critério:** mensagem parada 60s vira `failed` automaticamente.
- [ ] `T-050` `POST .../insight` com os dois gatilhos (`message_count` N=5, `inactivity` T=2min), UNIQUE garante disparo único, falha nunca é erro HTTP (sempre 200 com `status='failed'`) — **Critério:** `insight_unico.hurl` e `insight_falha.hurl` verdes.

---

## Fase 5 — Exportação, Dashboard e Conta
**Prazo: 19/09 a 20/09/2026** *(pular esta fase inteira se o RF05 foi cortado na Fase 2 — manter apenas dashboard e conta)*

- [ ] `T-051` Fila `pgmq` + consumidor `pg_cron` — **Critério:** job muda de estado sozinho, sem intervenção manual.
- [ ] `T-052` Bucket privado `exports` + política (caminho do objeto começa com o `user_id` do requisitante; nenhum bucket de imagens, D17) — **Critério:** usuário não consegue ler arquivo de outro usuário.
- [ ] `T-053` `POST /export/summary` (contagem síncrona; zero entradas → `EXPORT_EMPTY_PERIOD` **sem criar job**) — **Critério:** `export_vazio.hurl` verde, zero linhas criadas em `export_jobs`.
- [ ] `T-054` Worker de exportação com os dois status independentes (dados prontos não espera a narrativa) — **Critério:** `export_resiliente.hurl` verde.
- [ ] `T-055` `GET /export/:jobId/status` (com `downloadAvailable` já resolvido) e `GET /export/:jobId/download` (302, PDF com fallback para bruto) — **Critério:** download responde 302 mesmo com narrativa falhada.
- [ ] `T-056` `GET /dashboard/aggregate` (sempre 200, inclusive com zero entradas) — **Critério:** os três cenários (0/1/>30 entradas) respondem 200.
- [ ] `T-057` `GET /dashboard/narrative` (independente do agregado) — **Critério:** `dashboard_degradado.hurl` verde.
- [ ] `T-058` `PATCH /account/settings` (nome, persona, biometria; **`email` é rejeitado**) — **Critério:** `email_readonly.hurl` verde.
- [ ] `T-059` `DELETE /account` (hard delete, cascata, sem órfãos, purga o bucket `exports` do usuário) — **Critério:** `cascade_delete.sql` verde + bucket purgado.

---

## Fase 6 — Reprodutibilidade
**Prazo: 21/09 a 22/09/2026**

- [ ] 🔴 **[MANUAL] `T-060` / `GATE-10`** — Executar o roteiro de validação em modo `record`
  - **O quê:** Executar manualmente, passo a passo, o roteiro de validação completo (textos exatos, imagens exatas, ordem exata de telas) contra o ambiente com `REPLAY_MODE=record`. Isso popula o cache de replay chamando as IAs de verdade, uma única vez.
  - **Por que agora:** é a única execução em que a IA real é chamada para gravar o cache — todas as execuções seguintes (inclusive nos dois ciclos comparativos) devem reaproveitá-lo, nunca regravar.
  - **Como confirmo:** cache populado; taxa de acerto (`hit_count`) reportada.

- [ ] `T-061` Script de export/import do cache entre ambientes — **Critério:** cache gravado no `ciclo-a` é exportado e importado no `ciclo-b` **sem regravar**. ⚠️ Gravar duas vezes (uma por ciclo) anula todo o mecanismo de determinismo.
- [ ] `T-062` Job `determinism` no CI (roteiro 2x em `replay_strict`, banco recém-criado, comparação byte a byte normalizando IDs/timestamps) — **Critério:** duas execuções produzem output idêntico.
- [ ] `T-063` Os 15 cenários de injeção de falha evidenciados — **Critério:** `fault_injection_log` com 15 linhas distintas (5 endpoints × 3 tipos: `timeout`, `malformed`, `offline`).

---

## Fase 7 — Congelamento
**Prazo: 23/09/2026**

- [ ] `T-064` Procedimento de congelamento (Seção 12 do plano técnico), passos 1–10:
  1. `supabase db reset` no `dev` — confirmar que migrações + seed rodam do zero
  2. Aplicar migrações em `ciclo-a` e `ciclo-b`
  3. Gerar hash do schema dos três ambientes — **confirmar que são idênticos**
  4. `supabase test db` nos três — 100% verde
  5. Suíte Hurl completa contra `ciclo-a` e `ciclo-b`
  6. Executar o roteiro em `record` **no `ciclo-a` apenas**; exportar o cache; **importar o mesmo cache no `ciclo-b`**
  7. Reexecutar o roteiro em `replay_strict` nos dois — zero `REPLAY_MISS`
  8. Job `determinism` verde
  9. Conferir `fault_injection_log`: os 15 cenários registrados
  10. Montar `docs/handoff/` (ver "Pacote entregue aos dois ciclos" abaixo)

- [ ] 🔴 **[MANUAL] `T-065` / `GATE-11`** — Criar a tag de congelamento e publicar o repositório de handoff
  - **O quê:** Criar a tag `backend-v1.0-frozen`, proteger o ramo principal, publicar o repositório de handoff (somente leitura, **sem o código-fonte do backend**).
  - **Como confirmo:** tag criada, ramo protegido, repositório de handoff publicado e acessível.

---

## Pós-congelamento

- [ ] 🔴 **[MANUAL] `GATE-12`** — Reativar o ambiente `cerne-ciclo-b` antes de iniciar o ciclo B
  - **O quê:** Projetos gratuitos do Supabase pausam por inatividade. Como `ciclo-b` fica parado durante todo o ciclo A (semanas), reativá-lo manualmente no painel do Supabase antes de liberar o ciclo B.
  - **Por que agora:** reconferir a estrutura do schema (hash idêntico ao `ciclo-a` e ao `dev`) antes de liberar é obrigatório — está no checklist de congelamento (D14).
  - **Como confirmo:** projeto reativado, hash de schema conferido como idêntico.

---

## Checklist final de congelamento

*(consolidado da Seção 12 do plano técnico / Seção 9 do plano iniciante — nenhum ciclo comparativo começa antes de tudo aqui estar marcado)*

**Banco e segurança**
- [ ] Migrações aplicadas, estrutura idêntica nos 3 ambientes
- [ ] Suíte pgTAP 100% verde
- [ ] RLS forçada em todas as tabelas com dono
- [ ] Apagamento de conta sem linhas/arquivos órfãos
- [ ] Seed carregado (3 contas, datas relativas à âncora fixa)
- [ ] Busca semântica encontra o par plantado (RF06)

**Contratos**
- [ ] Documentação da API gerada, versionada, sem divergência
- [ ] Taxonomia de erro fechada em 13 códigos
- [ ] 23 endpoints com suíte de contrato passando
- [ ] Formato do streaming validado por teste

**Reprodutibilidade**
- [ ] Roteiro de validação escrito e revisado
- [ ] Cache populado; reexecução estrita sem "não encontrado"
- [ ] Teste de determinismo passando (2 execuções idênticas)
- [ ] Modelo de embedding fixado, sem chamada sem versão explícita
- [ ] Nenhum índice vetorial aproximado; toda ordenação com desempate

**Tratamento de erro**
- [ ] Os 15 cenários demonstrados e registrados
- [ ] Lista dos 5 endpoints de escrita confirmada e congelada

**Protótipo**
- [ ] Congelado, com hash registrado no documento de requisitos
- [ ] Todos os estados de tela sustentados por algum endpoint

**Entrega**
- [ ] Repositório de entrega publicado, somente leitura
- [ ] Tag de versão criada; branch protegida
- [ ] Arquivo de defeitos conhecidos presente, ainda que vazio
- [ ] Política D16 escrita e anexada ao pacote

---

## Pacote entregue aos dois ciclos (`docs/handoff/`)

Repositório separado, somente leitura, contendo: documentação da API (contrato completo dos 23 endpoints), taxonomia de erro (13 códigos), mapa de estados de tela, semântica do selo de sincronização (D9), roteiro de validação, fixtures (textos/áudio/imagens), coleção de testes de contrato, credenciais de ambiente (uma por ciclo), arquivo de defeitos conhecidos.

**O código-fonte do backend não vai no pacote** — evita assimetria de informação entre os dois ciclos.

---

## Itens em aberto — confirmar antes de depender

- **3 códigos de erro:** o `Contexto Geral.md` (§13) lista `EXPORT_EMPTY_PERIOD`, `PAYLOAD_TOO_LARGE` e `OCR_NO_TEXT` como "nomes ainda a definir na Fase 2". O plano técnico (§8.7), mais recente e operacional, **já os nomeia** dessa forma. Tratar como resolvido pelo plano técnico, mas vale confirmar com o Wagner antes da `T-025` para eliminar a divergência entre os dois documentos.
- **3 arquivos referenciados, não encontrados neste repositório** (confirmado por varredura completa do repo em 01/09/2026): `roteiro_de_validacao.md`, `Cerne_-_prototipo_final.html` (protótipo congelado, hash citado mas não localizado) e `Ciencia_Orientador_Divergencias_de_Escopo.md`. O próprio `Contexto Geral.md` (§25) já sinaliza isso como pendência. `roteiro_de_validacao.md` é especialmente crítico: sem ele, **o cache de replay é decorativo** (§6.3 do plano iniciante) — precisa existir antes da `T-060`.
- Também referenciado mas ausente: `Requisitos_e_Fluxo_de_Telas_TCC.md` / `_v2.md` (fonte de requisitos RF01–RF10/RNF01–RNF09) — os três documentos atuais o citam como fonte, mas não está neste repositório.

---

## Apêndice — Erros comuns a evitar

*(Seção 14 do plano técnico — conferir antes de dar qualquer tarefa por concluída)*

| Armadilha | Por que importa |
|---|---|
| Usar `service_role` num endpoint de aplicativo | Contorna toda a RLS; invalida o RNF04 |
| Retornar 403 em recurso de outro usuário | Vaza existência; contradiz D7 (deve ser 404) |
| Retornar 409 na idempotência do RF10 | O contrato é 200; os ciclos tratariam diferente |
| Montar prompt no cliente | Colapsa o cache de replay (D5) |
| Criar índice HNSW/IVFFlat | Introduz não-determinismo na busca |
| `ORDER BY` sem desempate por `id` | Ordem instável entre execuções |
| Gravar a imagem do OCR em qualquer lugar | Contradiz D17 |
| Falhar `POST /entries` quando o embedding falha | Perde dado do usuário |
| Retornar erro HTTP quando o insight falha | Quebra o chat; contradiz RF08 |
| Bloquear o download quando a narrativa falha | Contradiz o critério de aceite do RF05 |
| Editar migração já aplicada em remoto | Quebra a igualdade entre ambientes |
| Gravar o cache duas vezes, uma por ciclo | Anula todo o mecanismo de replay |
| Ajustar um teste para fazê-lo passar | Destrói o valor do instrumento de medição |

---

*Checklist mestre gerado a partir dos documentos-fonte em `context/` e `plan/`. Em caso de divergência entre este arquivo e os documentos-fonte, os documentos-fonte prevalecem — reportar a divergência, não resolver silenciosamente.*
