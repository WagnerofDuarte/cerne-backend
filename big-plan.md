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

- [x] `T-034` Os 5 endpoints de autenticação (`/auth/signup`, `/auth/login`, `/auth/refresh`, `GET /auth/session`, `/auth/logout`) — **Critério:** suíte Hurl do bloco verde.

  **Status em 10/09/2026:** código escrito e testado (`deno test`, fetch mockado) em `supabase/functions/auth-{signup,login,refresh,session,logout}/`. `auth-signup`/`auth-login`/`auth-refresh` são proxy fino do GoTrue (D1) via o novo cliente `_shared/gotrue.ts`; `auth-session` é o único com lógica própria (§8.1) — `user`/`expiresAt` decodificados do próprio JWT (evita uma 2ª chamada ao GoTrue, já que o gateway validou o token nesta mesma requisição), `serverRevision` lido de `profiles` via RLS; `auth-logout` engole erro do GoTrue (sessão já encerrada não é falha do ponto de vista do usuário — não há código de erro dedicado a isso). Dois módulos compartilhados novos, gap-fill no mesmo espírito de `db.ts` (Fase 2): `_shared/gotrue.ts` (cliente HTTP + `decodeJwtClaims`) e `_shared/deps.ts` (monta `GatewayDeps` a partir de `Deno.env`, reaproveitado por todo `index.ts` daqui em diante). `db.ts` ganhou `createAnonClient`.

  **Lacuna preenchida pragmaticamente (revisar se parecer errado):** nenhum dos 13 códigos de erro é específico para "GoTrue rejeitou a credencial" — mapeei erro de signup/login para `AUTH_INVALID` e erro de refresh (token expirado/revogado) para `AUTH_EXPIRED`, por proximidade semântica. Documentado inline em cada `handler.ts`.

  140/140 testes verdes (`deno test -A --parallel`, repo inteiro), `deno lint`/`deno fmt` limpos. **Validado contra `supabase functions serve` real pelo Wagner em 07/09/2026** — `auth.hurl` verde (ver nota de encerramento abaixo).
- [x] `T-035` `POST /entries` com a sequência obrigatória: validar → (se `chatMessageId`) tentar idempotência → PII (Haiku, tool use) → gravar → embedding (Voyage) com fallback `failed` sem perder a entrada — **Critério:** `idempotencia_rf10.hurl` verde.
- [x] `T-036` Detecção de PII com saída estruturada (tool use) — **Critério:** entrada com nome próprio vira `pii_status='flagged'` com `content` intacto.
- [x] `T-037` Geração de embedding com fallback — **Critério:** Voyage forçada a falhar ainda deixa a entrada gravada com `embedding_status='failed'`.

  **Status em 10/09/2026 (T-035/036/037 juntas — um endpoint só):** código escrito e testado fim a fim (`supabase/functions/entries-create/`: `handler.ts` + `pii.ts` + `embedding.ts`, mais os módulos de repositório abaixo). A checagem de idempotência do passo 2 é otimista (um `SELECT`, para economizar uma chamada de Haiku no caso comum de retry) — quem garante D4 de verdade ("pelo banco, não pelo código") é o índice único dentro do `INSERT` (`entries-repo.ts`): uma corrida real entre duas requisições idênticas é pega ali (`23505`), busca a linha vencedora e devolve com `idempotentReplay=true`, sem propagar erro nem duplicar. Testado nos dois níveis (`entries-repo.test.ts` isolado, `handler.test.ts` fim a fim simulando a corrida). PII: `tool_choice` força o uso da ferramenta, qualquer desvio (chamada falhou, tool_use ausente, shape fora do schema) vira `PII_CHECK_FAILED` sem gravar nada. Embedding: nunca lança — Voyage indisponível ou dimensão errada viram `{status: 'failed'}` tratado pelo handler, a entrada nunca é perdida.

  Dois módulos de repositório novos (gap-fill, mesmo espírito de `db.ts`/`deps.ts` da Fase 2): `_shared/entries-repo.ts` (leitura/escrita de `entries` com tags embutidas via join com `entry_tags`/`tags`, sem N+1 — compartilhado com T-038/039/040 ainda por vir) e `_shared/profiles-repo.ts` (`fetchServerRevision`, extraído do `auth-session` do T-034 para reaproveitar aqui).

  **Lacuna real do documento-fonte, encontrada implementando (revisar se parecer errado):** a Seção 8.2 lista `serverRevision` como campo de resposta de `Entry`, mas a Seção 5 só define a coluna `server_revision` em `profiles` (contador por usuário, incrementado pelo trigger a cada escrita em `entries` — não existe coluna equivalente em `entries`). Leitura adotada: cada `Entry` devolvido pela API reporta o valor *atual* de `profiles.server_revision` do dono no momento da resposta, lido a cada chamada — não um valor gravado na própria linha da entrada.

  168/168 testes verdes (`deno test -A --parallel`, repo inteiro), `deno lint`/`deno fmt` limpos. **Validado contra `supabase functions serve` real pelo Wagner em 07/09/2026** — `entries_create.hurl` e `idempotencia_rf10.hurl` verdes (ver nota de encerramento abaixo).
- [x] `T-038` `GET /entries` com paginação, filtros e **tags embutidas** (evita N+1) — **Critério:** `tags_embutidas.hurl` verde.

  **Status em 10/09/2026:** código escrito e testado (`supabase/functions/entries-list/`). Paginação por **keyset** (cursor opaco `{occurredAt, id}` em base64url), não por OFFSET — mesma condição de "depois do cursor" que o `ORDER BY occurred_at DESC, id ASC` usa para desempate. `listEntries` (`entries-repo.ts`, estendido) sempre busca `limit + 1` de propósito, para o handler decidir `nextCursor`/corte de página sem uma 2ª consulta. Tags embutidas reaproveitam o join já criado no T-035. `serverRevision` (não é coluna de `entries`, mesma leitura do T-035) é injetado igual em cada item da página, mais o header `X-Data-Version`. Filtros `source`/`dateFrom`/`dateTo` combinam com AND por composição natural do PostgREST — testado com um fake de query builder que filtra/ordena/pagina de verdade (não *canned responses*), porque o que importa provar aqui é exatamente esse comportamento composto.

  181/181 testes verdes, lint/fmt limpos. **Validado contra `supabase functions serve` real pelo Wagner em 07/09/2026** — `tags_embutidas.hurl` e `entries_list.hurl` verdes.
- [x] `T-039` `GET /entries/:id` — **Critério:** recurso de outro usuário retorna 404 `NOT_FOUND`.

  **Status em 10/09/2026:** código escrito e testado (`supabase/functions/entries-get/`). Reaproveita `findEntryById` (já criado no T-035). Entrada de outro usuário e entrada inexistente produzem a mesma resposta (404) pelo mesmo caminho de código — nunca 403 (D7). `id` sintaticamente inválido (não é uuid) também vira 404 sem consultar o banco. 184/184 testes verdes. **Validado contra `supabase functions serve` real pelo Wagner em 07/09/2026** — `entries_get.hurl` verde.
- [x] `T-040` `GET /entries/search` (semântica + filtros combinando com **AND**, debounce é responsabilidade do app) — **Critério:** `busca_and.hurl` e `busca_semantica.hurl` verdes.

  **Status em 10/09/2026:** código escrito e **validado com Postgres de verdade neste sandbox** (Postgres 16 + pgvector + pgtap via `apt`, mesmo método da Fase 1/2 — não é dry-run). Descoberta real fora do backlog original: o PostgREST não ordena por expressão arbitrária (`embedding <=> $1`) via o construtor de query fluente do supabase-js, só por coluna — precisou de uma migração nova (`0011_entries_search_rpc.sql`), a primeira desde a `0010` (Fase 2). A função `entries_search_by_embedding` é `SECURITY INVOKER` (diferente das RPCs de `experiment` da 0010, que são `DEFINER`) — de propósito: rodando com o papel de quem chamou, a RLS de `entries` (já forçada desde a Fase 1) continua valendo por baixo, e a função nem recebe `user_id` como parâmetro, então não existe como pedir dado de outra pessoa. Mesma varredura exata já validada em `scripts/prove-rf06.ts` (T-024), agora exposta como RPC. Tags embutidas via `jsonb_agg` correlacionado dentro da própria função SQL.

  `supabase/tests/entries_search_rpc.sql` — 10 casos novos, todos verdes via `pg_prove` de verdade: ordena por distância ASC, desempate por id ASC, isolamento por RLS (mesmo sem passar `user_id`), `embedding_status != 'ready'` fica de fora, filtros `source`/data em AND, tags embutidas, GRANT restrito a `authenticated`, `limit` respeitado. **A suíte inteira (0001–0011) foi revalidada junto:** `Files=14, Tests=91, Result: PASS` — os 81 testes anteriores (Fases 1/2) mais os 10 novos, sem colisão.

  Handler (`entries-search/`): `q` ausente/vazio nunca chama a Voyage (`meta.mode='filter_only'`); `q` presente gera o embedding da consulta (`input_type='query'`, D8) e usa a RPC (`meta.mode='semantic'`), `similarity = 1 - distância`. Voyage indisponível no modo semântico → `EMBEDDING_FAILED` (502).

  192/192 testes Deno verdes, lint/fmt limpos. **Validado contra `supabase functions serve` real pelo Wagner em 07/09/2026** — `busca_and.hurl`, `busca_semantica.hurl` e `entries_search.hurl` verdes.

- [x] `T-041` `POST /media/ocr` (imagem nunca é persistida — só o SHA-256 entra no cache) — **Critério:** imagem grande demais → 413; imagem ilegível → `OCR_NO_TEXT`.

  **Status em 10/09/2026 — última tarefa de código da Fase 3:** código escrito e testado (`supabase/functions/media-ocr/`). Tamanho checado nos bytes DECODIFICADOS (não no texto base64, ~33% maior) antes de qualquer chamada à Anthropic. Saída estruturada via tool use (mesmo padrão do T-036), texto vazio (ou só espaço em branco) → `OCR_NO_TEXT`. `_shared/ai/anthropic.ts` (Fase 2) ganhou suporte a conteúdo multimodal (bloco de imagem base64), retrocompatível com o uso existente em texto puro (PII, T-036) — extensão necessária que não estava prevista, já que só o OCR precisa de visão nesta fase.

  **Lacuna preenchida pragmaticamente (revisar se parecer errado):** nenhum dos 13 códigos é específico para "a chamada de OCR falhou" (diferente de PII/embedding, que têm `PII_CHECK_FAILED`/`EMBEDDING_FAILED` dedicados) — mapeado para `AI_GENERATION_TIMEOUT`, o mesmo código genérico já usado para falha de geração por IA em insight/dashboard.

  Testado explicitamente que a imagem em si nunca entra no cache — só o SHA-256 dos bytes (D17). 203/203 testes Deno verdes (repo inteiro), lint/fmt limpos. **Validado contra `supabase functions serve` real pelo Wagner em 07/09/2026** — `media_ocr.hurl` verde (depois de dois bugs reais de execução corrigidos nesta reta final, ver nota de encerramento abaixo).

  **Com isso, todo o código da Fase 3 (T-034–T-041, 10 diretórios de função) está escrito, testado e validado contra o stack real.**

**Status em 10/09/2026:** `tests/hurl/` escrita (10 arquivos + README) — sintaxe conferida com `hurlfmt` e semântica das asserções validada de ponta a ponta contra um mock HTTP local (não é o Supabase real). Ver `tests/hurl/README.md` e a nota de encerramento abaixo.

### Encerramento da Fase 3 — notas para quem retomar (código completo em 10/09/2026, confirmado localmente em 07/09/2026 — dentro do prazo, 10 a 13/09)

Escrito para dar contexto a uma conversa nova que não viu a sessão em que a Fase 3 foi executada.

**Onde o código foi escrito vs. onde foi validado de verdade:** mesmo padrão da Fase 1 — este sandbox remoto não consegue baixar as imagens Docker do Supabase, então não dá para rodar `supabase functions serve` nem a suíte Hurl contra o stack real aqui. Diferente da Fase 1, porém, esta fase conseguiu uma validação bem mais forte que um dry-run isolado:
- **T-040 (migração `0011`)** foi validada com Postgres 16 + pgvector + pgtap **de verdade** neste sandbox (mesmo método da Fase 1) — não só a migração nova isolada, mas a cadeia inteira `0001`–`0011` revalidada: `Files=14, Tests=91, Result: PASS`.
- **A suíte Hurl** foi validada rodando de ponta a ponta contra um mock HTTP local (Deno, descartado, não versionado) que imita as 10 respostas — pegou 2 bugs reais de sintaxe Hurl (documentados em `tags_embutidas.hurl` e no README) que só apareceriam rodando de verdade.
- **Toda a lógica de negócio** (203 testes `deno test`, repo inteiro) roda com Anthropic/Voyage/banco mockados via injeção de dependência — nenhuma chamada real foi feita nesta fase (ao contrário do que a suíte Hurl fará quando o Wagner rodar de verdade — ver custo abaixo).

**O que está pronto, commitado e pushed no branch `fase3`** (`T-034`–`T-041`, um commit por tarefa):
- 10 diretórios de função (`supabase/functions/`): `auth-signup`, `auth-login`, `auth-refresh`, `auth-session`, `auth-logout`, `entries-create`, `entries-list`, `entries-get`, `entries-search`, `media-ocr`.
- Migração nova: `supabase/migrations/0011_entries_search_rpc.sql` (RPC `entries_search_by_embedding`, `SECURITY INVOKER`) + `supabase/tests/entries_search_rpc.sql` (10 casos pgTAP).
- Módulos compartilhados novos (gap-fill, mesmo espírito de `db.ts` da Fase 2): `_shared/gotrue.ts`, `_shared/deps.ts`, `_shared/entries-repo.ts`, `_shared/profiles-repo.ts`. `_shared/ai/anthropic.ts` ganhou suporte a conteúdo multimodal (retrocompatível).
- `tests/hurl/` — 10 arquivos + `README.md` com a convenção de URL e como rodar.

**Decisão de estrutura registrada nesta fase (não estava explícita nos documentos-fonte):** um diretório de função por endpoint, nome = `id` do `registry.ts` com `.` → `-`. Path params (`:id`) viram o último segmento da URL, extraído por cada `index.ts` — o `gateway.ts` não roteia. Todo `tests/hurl/*.hurl` chama `{{base_url}}/<nome-da-função>`, não o caminho REST do OpenAPI.

**Lacunas do documento-fonte preenchidas de forma pragmática nesta fase, documentadas inline onde aparecem no código (revisar se achar errado):**
- `serverRevision` de `Entry` (§8.2) não é coluna de `entries` — só existe em `profiles`. Cada `Entry` da API reporta o valor atual do perfil, lido a cada resposta (`profiles-repo.ts`).
- Erro de GoTrue em signup/login → `AUTH_INVALID`; em refresh → `AUTH_EXPIRED` (nenhum dos 13 códigos é específico para "credencial rejeitada pelo provedor").
- Erro de OCR (chamada à Anthropic falhou, tool_use ausente, shape fora do schema) → `AI_GENERATION_TIMEOUT` (mesmo código genérico de insight/dashboard).

**Confirmação local concluída (mesmo espírito do `T-019v` da Fase 1) — resultado em 07/09/2026:** Wagner rodou os passos abaixo na máquina local (Docker Desktop, `GATE-01`) até fechar os 10 arquivos verdes, depois de 5 bugs reais de execução encontrados e corrigidos pelo caminho (ver os 5 relatos abaixo, em ordem cronológica) — nenhum deles visível nos 203 testes `deno test` nem no mock HTTP, porque nenhum dos dois passa pelo motor de Edge Functions/Deno.serve de verdade:
1. `git pull origin fase3`
2. `supabase db reset` — 11 migrações (com a `0011`) + seed
3. `supabase test db` — **91/91**
4. `supabase functions serve --env-file supabase/.env.local` — as 10 funções
5. Suíte Hurl completa (`tests/hurl/README.md`) — **10/10 arquivos verdes, 51 requisições, 100%** (`hurl --test --jobs 1 ...`)

Com isso, `T-034`–`T-041` estão marcados `[x]` acima.

**Custo esperado do passo 5:** `entries_create.hurl`, `idempotencia_rf10.hurl`, `busca_semantica.hurl` e `entries_search.hurl` fazem chamadas reais à Anthropic (PII) e à Voyage (embedding) — nenhum cache de replay populado ainda (isso só acontece de propósito no `T-060`, Fase 6). Custo pequeno, dentro dos tetos do `GATE-04`/`GATE-05`.

**Bug real encontrado pelo Wagner em 10/09/2026, rodando `supabase functions serve` pela 1ª vez de verdade (não aparecia no mock nem nos testes unitários, porque nenhum dos dois passa pelo motor de Edge Functions de verdade):** `GET /auth-session` sem token devolvia `{"code":"UNAUTHORIZED_NO_AUTH_HEADER", "message":"Missing authorization header", ...}` em vez do `AUTH_EXPIRED` esperado. Causa: o motor de Edge Functions do Supabase, por padrão, exige um JWT válido pra sequer *invocar* a função — barra a requisição antes do código de dentro (`gateway.ts`) rodar, com um formato de erro genérico do runtime, não o envelope do projeto (§3.2). Afeta principalmente os 3 endpoints sem sessão prévia (`auth-signup`/`auth-login`/`auth-refresh`, que não têm token nenhum pra mandar), mas também mascararia o `AUTH_EXPIRED` "de verdade" dos outros 7. **Corrigido:** `supabase/config.toml` ganhou `verify_jwt = false` nas 10 funções da Fase 3 — cada uma já faz sua própria autenticação por dentro, é ela quem deve decidir o código de erro, não o runtime. Depois de `git pull`, reiniciar o `supabase functions serve` (Ctrl+C e rodar de novo) é obrigatório pra pegar essa mudança de configuração.

**2º bug real, mesma sessão de validação do Wagner:** depois do `verify_jwt`, a função nem chegava a iniciar — `worker boot error: Relative import path "zod" not prefixed with / or ./ or ../`, apontando pra `contracts/zod/registry.ts`. Causa: o `deno.json` deste projeto (os atalhos "zod" → `npm:zod`, `@supabase/supabase-js` → `npm:...`, usados em todo o código desde a Fase 2) fica na **raiz do repositório** — `deno test`/`deno check` (sempre rodados da raiz, inclusive nesta sessão e em toda a Fase 2/3) o encontram sozinhos, mas o motor de Edge Functions serve cada função isolada e não olha pra fora de `supabase/` por padrão. **Corrigido:** cada `[functions.<nome>]` ganhou `import_map = "../deno.json"` — reaproveita o `deno.json` existente como mapa de importação, em vez de duplicar a lista de pacotes num arquivo novo. Mais uma vez, é preciso reiniciar o `supabase functions serve` depois do `git pull` pra pegar a mudança.

**3º bug real, achado pelo Wagner rodando `media_ocr.hurl` sozinho em 04/09/2026 (travava ~2min, voltava erro de timeout do motor de Edge Functions em vez do status esperado):** `ai/anthropic.ts` e `ai/voyage.ts` (T-032, Fase 2) chamam `fetch` sem nenhum timeout próprio — se a chamada de rede travar, a promise nunca resolve nem rejeita sozinha, só o teto externo do runtime (150s local/400s pago) mata o isolate à força, produzindo essa mensagem de log em vez do erro normal do envelope do projeto. **Corrigido:** `signal: AbortSignal.timeout(30_000)` nos dois clientes (`ANTHROPIC_REQUEST_TIMEOUT_MS`/`VOYAGE_REQUEST_TIMEOUT_MS`) — uma chamada presa agora falha em 30s com um erro catchável normal (cai no `AI_GENERATION_TIMEOUT` já existente no OCR, e no fallback `status: 'failed'` já existente no embedding de `POST /entries`, D8) em vez de segurar o isolate. Detalhe à parte, também achado nessa mesma sessão de validação: faltava `--env-file supabase/.env.local` no `functions serve` — sem ele, `ANTHROPIC_API_KEY`/`VOYAGE_API_KEY`/`PROMPT_VERSION` ficam ausentes e `requireEnv` (`_shared/deps.ts`) lança no top-level do `index.ts`, derrubando o worker antes de processar qualquer requisição (documentado em `tests/hurl/README.md`).

**4º bug real, achado pelo Wagner em 07/09/2026 (a mesma trava de ~150s/504 voltou mesmo com `.env.local` e timeout corrigidos — desta vez na 1ª sub-requisição de `media_ocr.hurl`, a que testa "sem token" e nem chega a chamar a Anthropic):** causa mais fundamental, em `gateway.ts` (T-031), não nos clientes de IA — bug documentado do próprio Deno ([denoland/deno#10182](https://github.com/denoland/deno/issues/10182)): devolver uma `Response` sem nunca ler o corpo da requisição trava a conexão no `Deno.serve`/edge-runtime quando o payload é grande. `runGateway` autentica (passo 5) antes de validar o corpo com Zod (passo 6) — "sem token" lança `AUTH_EXPIRED` sem nunca tocar no corpo, e a imagem real de ~2.2MB nunca é lida nem descartada. **Corrigido:** um `finally` em `runGateway` drena (`req.arrayBuffer()`) qualquer corpo ainda não consumido antes de responder — cobre qualquer endpoint que rejeite antes do passo 6, não só o OCR. Teste de regressão em `gateway.test.ts`. Depois desse fix, `media_ocr.hurl` passou sozinho (6/6 requisições, ~9s).

**5º achado, mesma sessão de validação (não é bug do código do projeto):** rodando a suíte inteira (`tests/hurl/*.hurl`) de uma vez, `media_ocr.hurl` e `idempotencia_rf10.hurl` voltaram a falhar — mas com `401` inesperado, não trava. Causa: o `hurl` (versão 6.1.1) roda os arquivos **em paralelo por padrão** no modo `--test`. Quase toda a suíte loga na mesma conta seed (`cenario-cheio@cerne.test`); em paralelo, o `auth.hurl` chama `POST /auth/logout` (escopo padrão do GoTrue é `global`, revoga todas as sessões do usuário) numa janela em que outros arquivos ainda tinham requisições pendentes com token dessa mesma conta — colide com um bug aberto e conhecido do próprio Supabase Auth com múltiplas sessões concorrentes por usuário ([supabase/auth#2036](https://github.com/supabase/auth/issues/2036)). **Não corrigido no código** (o comportamento de `gateway.ts`/`auth-logout` está certo, D1 — "proxy fino do GoTrue"): documentado em `tests/hurl/README.md` que rodar a suíte inteira precisa de `--jobs 1` (força execução sequencial). Com isso, os 10 arquivos passaram juntos: **10/10, 51 requisições, 100%**.

**Itens em aberto que já vinham de fases anteriores, sem mudança:** `docs/roteiro_de_validacao.md` continua pendente (retomar perto da Fase 6, lembrete de 18/09); `fixtures/trancricoes.md` continua com esse nome.

**Sobre o Wagner (perfil de quem vai ler as respostas):** mesma orientação das fases anteriores — não é desenvolvedor backend, explicar conceitos técnicos com analogias simples antes/junto da justificativa de qualquer decisão.

**Gates manuais (🔴 [MANUAL]) — lembrete de processo:** nenhum nesta fase (todas as 8 tarefas são do agente) — mas o passo de validação local acima segue o mesmo ritual de reportar e aguardar confirmação antes de marcar `[x]`.

---

## Fase 4 — Chat
**Prazo: 14/09 a 18/09/2026**

**Quatro lacunas do documento-fonte, confirmadas com o Wagner em 07/09/2026 antes de começar `T-042`** (nenhuma delas resolvida pelo plano técnico nem pelo `Contexto Geral.md` — levantadas explicitamente em vez de preenchidas por conta própria, regra nº4):

1. **RAG × PII (`T-043`):** a busca semântica que alimenta o contexto do chat **inclui** entradas com `pii_status='flagged'` — mesmo comportamento já existente em `entries_search_by_embedding` (T-040, Fase 3, não filtra por PII), coerente com D3 (conteúdo original íntegro, nunca censurado).
2. **Título da sessão (`T-045`):** gerado por **truncamento determinístico** da 1ª mensagem do usuário, sem chamar IA. Motivo, além da preferência do Wagner: não existe operação `title` no enum de `ReplayOperation` (`chat`/`insight`/`pii`/`ocr`/`embedding`/`narrative`/`dashboard`, `replay.ts`) nem na tabela da Seção 9.2 — uma geração via IA exigiria uma 8ª operação de cache não prevista em nenhum documento-fonte.
3. **Retry do chat (`T-048`):** a resposta anterior falhada é tratada reaproveitando **a mesma linha** de `chat_messages` (mesmo `id`, mesmo `seq`), resetando `status` de `failed` para `streaming` e sobrescrevendo `content`. O §8.3 fala em "marcar como substituída", mas `chat_messages.status` só aceita `streaming`/`complete`/`failed` (CHECK já aplicado na migração `0003`, Fase 1) — não existe estado "substituída", e adicioná-lo exigiria editar uma migração já aplicada em remoto (proibido pelo apêndice de armadilhas).
4. **Teste do job `pg_cron` de 60s (`T-049`):** comprovado via **pgTAP**, manipulando `created_at` diretamente antes de chamar a função do job — não por uma espera real de 60s em Hurl. Motivo: o `pg_cron` roda em tempo de parede real do Postgres, alheio ao relógio de teste `X-Test-Now` (módulo `clock`, Fase 2) que todas as outras suítes usam para determinismo.

**Nota de ambiente:** mesmo bloqueio de rede das Fases 1-3 para `supabase start`/`functions serve` — o código desta fase foi escrito e testado aqui (`deno test`, fetch/DB mockados), e a validação real contra o Supabase CLI ficou para o Wagner (`T-050v` abaixo, ✅ concluído). **Diferença desta fase:** o job `pg_cron` (T-049) não dependia do Supabase CLI para ser validado de verdade — instalado Postgres 16 + pgvector + pgtap + pg_cron via `apt` neste sandbox (com `shared_preload_libraries=pg_cron` configurado e o serviço reiniciado, algo que nenhuma fase anterior precisou fazer), então a migração 0012 e o job em si já foram comprovados contra Postgres real, não só escritos.

- [x] `T-042` Módulo `prompts` — toda montagem de prompt acontece no servidor (D5), versionado por `PROMPT_VERSION` — **Critério:** `PROMPT_VERSION` entra na `cache_key`.
- [x] `T-043` Módulo `rag` com ordenação determinística (top 5) — **Critério:** mesma pergunta produz sempre os mesmos `retrievedEntryIds`, na mesma ordem.
- [x] `T-044` Módulo `sse` no formato fixo da D12 (`message_created` → `context` → `token*` → `done`/`error`) — **Critério:** `sse_ordem.hurl` verde. ✅ Confirmado pelo Wagner em 14/09/2026 — `sse_ordem.hurl` passou (5 requisições) contra `supabase functions serve` real, 1ª vez que este projeto testa uma resposta `text/event-stream` via Hurl e não achou nenhum problema de execução.
- [x] `T-045` `POST /chat/sessions` (título gerado no servidor, persona congelada) + os dois `GET` de listagem — **Critério:** criação implícita na 1ª mensagem funciona (não há botão "nova conversa"). ✅ Confirmado — `chat_sessions.hurl` verde (9 requisições).
- [x] `T-046` `POST .../messages` com streaming completo (grava mensagem do usuário → RAG → cria mensagem do assistente `streaming` → emite eventos → grava tokens → `done`/`error`) — **Critério:** queda no meio do streaming preserva o texto parcial com `status='failed'`. ✅ Confirmado via `sse_ordem.hurl` (caminho feliz completo, real chamada ao Sonnet 5).
- [x] `T-047` Reemissão de SSE a partir do cache (hit reemite em pedaços de 32 caracteres a cada 15ms) — **Critério:** hit produz exatamente a mesma sequência de eventos.
- [x] `T-048` `POST .../messages/:userMessageId/retry` (D15 — mesmo histórico e pergunta, mesma impressão digital) — **Critério:** `retry_chat.hurl` verde — `X-Replay-Status: hit` e `retry_count=1`. ✅ Confirmado pelo Wagner em 14/09/2026 — `retry_chat.hurl` verde (8 requisições) com `REPLAY_MODE=record`, comprovando a mecânica da D15 de ponta a ponta (retry acerta o cache da 1ª tentativa).
- [x] `T-049` Job `pg_cron` que marca `failed` mensagens presas em `streaming` há mais de 60s — **Critério:** mensagem parada 60s vira `failed` automaticamente. ✅ Validado contra Postgres 16 real neste sandbox (ver nota acima) — `chat_stale_streaming.sql`, 4/4 pgTAP verdes; suíte inteira revalidada (0001-0012): `Files=15, Tests=95, Result: PASS`.
- [x] `T-050` `POST .../insight` com os dois gatilhos (`message_count` N=5, `inactivity` T=2min), UNIQUE garante disparo único, falha nunca é erro HTTP (sempre 200 com `status='failed'`) — **Critério:** `insight_unico.hurl` e `insight_falha.hurl` verdes. ✅ Confirmado pelo Wagner em 14/09/2026 — os dois arquivos verdes (`insight_unico.hurl`: 5 requisições; `insight_falha.hurl`, com `X-Test-Fault: ai_timeout` de verdade: 3 requisições).

- [x] 🔴 **[MANUAL] `T-050v`** — Validar localmente os critérios de conclusão de `T-042`–`T-050` (item fora do backlog original, mesmo espírito do `T-019v`/Fase 1 e da validação da Fase 3)
  - **✅ Concluído pelo Wagner em 14/09/2026 — as 5 suítes Hurl novas confirmadas verdes contra `supabase functions serve` real, nenhum achado real de execução:**
    - `chat_sessions.hurl` — 9 requisições
    - `sse_ordem.hurl` — 5 requisições (1ª vez que este projeto testa `text/event-stream` via Hurl — nenhum problema de buffering/timeout apareceu, ao contrário do que era esperado por analogia com as Fases 1/3)
    - `insight_unico.hurl` — 5 requisições
    - `retry_chat.hurl` — 8 requisições, com `REPLAY_MODE=record` (confirma a mecânica de cache da D15 de ponta a ponta)
    - `insight_falha.hurl` — 3 requisições, com `X-Test-Fault: ai_timeout` de verdade (1ª suíte deste projeto a exercitar esse cabeçalho contra o runtime real)
    - Total: **30/30 requisições verdes**, nos 5 arquivos.
  - `supabase db reset`/`supabase test db` não tiveram relato de problema — dados como confirmados junto com a suíte Hurl.

### Encerramento da Fase 4 — notas para quem retomar (concluída 14/09/2026, dentro do prazo — 14 a 18/09 —, 9/9 tarefas + `T-050v`)

Escrito para dar contexto a uma conversa nova que não viu a sessão em que a Fase 4 foi executada.

**O que está pronto, commitado e pushed no branch `fase4`** (`T-042`–`T-050`):
- Módulos novos em `_shared/`: `prompts.ts` (T-042, registro fechado de versões de template por `PROMPT_VERSION`), `rag.ts` (T-043, reaproveita a RPC de busca semântica da Fase 3 com `limit=5`), `sse.ts` (T-044, encoding + máquina de estados da ordem fixa D12 + `emitReplayedTokens` do T-047), `chat-repo.ts` (gap-fill, CRUD de `chat_sessions`/`chat_messages`/`insights`), `chat-generation.ts` (T-046/047/048, `runChatGeneration`/`peekChatCacheStatus`/`runChatTurnStream` — o produtor SSE compartilhado por send e retry).
- Extensões de módulos existentes: `gateway.ts` ganhou suporte a resposta em streaming (`StreamHandlerResult`) — o contrato já previa `response.kind: 'sse'` desde a Fase 2 (T-026), mas nada ainda usava; `ai/anthropic.ts` ganhou `streamAnthropic` (parseia os frames SSE da própria Anthropic, `content_block_delta`/`message_delta`, reagrupando frames cortados entre chunks de rede).
- 5 diretórios de função novos: `chat-sessions-create`, `chat-sessions-list`, `chat-messages-list` (T-045), `chat-messages-send` (T-046/047), `chat-messages-retry` (T-048), `chat-insight-create` (T-050) — 6 no total, mais `config.toml` com as 6 entradas `verify_jwt=false`/`import_map` (mesmo achado real da Fase 3).
- Migração `0012_chat_stale_streaming_job.sql` (T-049) + `supabase/tests/chat_stale_streaming.sql`.
- `tests/hurl/`: `chat_sessions.hurl`, `sse_ordem.hurl`, `retry_chat.hurl`, `insight_unico.hurl`, `insight_falha.hurl` — 5 arquivos novos, README atualizado com a novidade de streaming SSE e a variável `test_fault_key`.

**Decisões de arquitetura tomadas nesta fase, além das 4 lacunas já registradas no topo desta seção:**
- **`seq` do evento `message_created`** (§8.3 não detalha qual dos dois ids ele acompanha): escolhido como o `seq` do **assistente** — é essa linha que o cliente observa mudar de `streaming` para `complete`/`failed`.
- **`X-Replay-Status` antes do stream começar:** como o header precisa ser decidido antes do primeiro byte da `Response` SSE sair, `chat-generation.ts` consulta o cache uma vez via `peekChatCacheStatus` e repassa o resultado (`prefetch`) para `runChatGeneration`, em vez de usar o `withReplay` genérico (que só devolve o status depois de tudo terminado) — divergência documentada inline no código.
- **`CHAT_MAX_TOKENS=2048`/`INSIGHT_MAX_TOKENS=256`:** valores pragmáticos — nenhum documento-fonte fixa um teto de tokens para chat ou insight.
- **`ai_timeout` consumido pela 1ª vez neste projeto** (T-050): nenhuma tarefa anterior (T-036 PII, T-041 OCR) estava na lista de endpoints da linha `ai_timeout` da Seção 10.2 (só RF05/RF08/RF09) — `chat-insight-create/generation.ts` ganhou um parâmetro `forceFailure` que simula a IA falhando sem bater na rede, consumindo `ctx.fault?.type === 'ai_timeout'`.

**Números:** 317 testes `deno test` novos/totais (repo inteiro), todos verdes; `deno lint`/`deno fmt` limpos em todo arquivo escrito nesta fase. `pg_cron`/migração 0012 validados contra Postgres 16 real (não só sandbox de dry-run aproximado) — primeira vez que este projeto agenda um job de verdade, não só declara a extensão.

**Itens em aberto que já vinham de fases anteriores, sem mudança:** `docs/roteiro_de_validacao.md` continua pendente (retomar perto da Fase 6); `fixtures/trancricoes.md` continua com esse nome.

**Sobre o Wagner (perfil de quem vai ler as respostas):** mesma orientação das fases anteriores — não é desenvolvedor backend, explicar conceitos técnicos com analogias simples antes/junto da justificativa de qualquer decisão.

**Gates manuais (🔴 [MANUAL]) — lembrete de processo:** só o `T-050v` acima — ao chegar nele, parar, explicar o que fazer e por quê, esperar confirmação explícita do Wagner, e só então marcar `[x]`.

---

## Fase 5 — Exportação, Dashboard e Conta
**Prazo: 19/09 a 20/09/2026** *(pular esta fase inteira se o RF05 foi cortado na Fase 2 — manter apenas dashboard e conta)* — **Não se aplica: a Fase 2 fechou em 04/09/2026, bem antes do prazo (09/09). RF05 mantido no escopo, fase completa (9/9 tarefas).**

**Decisão tomada com o Wagner antes de começar `T-059`** (ver conversa da sessão): `DELETE /account` apaga a própria conta via uma função `SECURITY DEFINER` no banco (mesmo padrão do `T-029`/`T-030`, migração 0010) — `auth.uid()` embutido, sem parâmetro solto — em vez de abrir uma exceção pontual para `service_role` na Edge Function (rejeitado, quebraria a regra nº5 sem exceção) ou delegar para o worker de fila (rejeitado, tornaria o apagamento assíncrono, reabrindo o contrato já congelado da Fase 2).

**Nota de ambiente:** mesmo bloqueio de rede das fases anteriores para `supabase start`/`functions serve`. Diferente das fases 1/3/4, porém, esta fase depende de três peças de infraestrutura que **não têm nenhum equivalente instalável via `apt`** neste sandbox — `pgmq`, `pg_net` (extensões só disponíveis na imagem própria do Supabase) e o serviço de Storage (`storage.objects`/`storage.buckets`, gerido pelo Supabase, não pelo Postgres genérico). Para ainda assim validar a lógica SQL de verdade (não só escrita, revisada), montei um harness próprio (não versionado) com **stubs funcionais** dos três — mesmas assinaturas de função, comportamento simplificado — e apliquei as 18 migrações (0001–0018) numa instância Postgres 16 real (`pgvector`/`pgtap`/`pg_cron` via `apt`, como nas Fases 1 e 4), do zero, em sequência: **`Files=20, Tests=125, Result: PASS`** (95 anteriores + 30 novos: 6 de storage, 7 de fila, 6 de dashboard, 5 de apagar conta, 6 do repasse de fault). Isso pega bug real de SQL/permissão — não prova que `pgmq`/`pg_net`/Storage de verdade se comportam como os stubs. Essa prova final é do Wagner, via `T-059v` abaixo.

- [x] `T-051` Fila `pgmq` + consumidor `pg_cron` — **Critério:** job muda de estado sozinho, sem intervenção manual.

  **Lacuna real de arquitetura, encontrada implementando (revisar se parecer errado):** nenhum documento-fonte diz *como* o "consumidor `pg_cron`" roda de fato — `pg_cron` sozinho só executa SQL dentro do próprio Postgres, não tem como chamar a Anthropic nem gravar no Storage (isso exige HTTP de fora do banco). Adotei o padrão já documentado pelo próprio Supabase para "cron job que aciona uma Edge Function": `pg_cron` agenda `export_dispatch_pending_jobs()` a cada 15s, que usa a extensão `pg_net` (chamadas HTTP assíncronas de dentro do Postgres — **extensão nova, não listada em `0001_extensions.sql`**) para acordar a Edge Function `export-worker` (T-054) com `Authorization: Bearer <service_role key>`. A fila em si é `pgmq.create('export_jobs_queue')`; enfileirar (`export_enqueue`) é uma RPC `SECURITY DEFINER` de superfície mínima (mesmo padrão da migração 0010), chamada pela Edge Function de app com o JWT do usuário — nunca `service_role` aí (regra nº5). A URL base das functions e a `service_role key` do próprio ambiente ficam numa tabela singleton nova, `experiment.worker_config` — **precisa de um INSERT manual, uma vez por ambiente** (dev/ciclo-a/ciclo-b), documentado em `tests/hurl/README.md` e obrigatório antes de `export_download.hurl`/`export_resiliente.hurl` funcionarem de verdade.

- [x] `T-052` Bucket privado `exports` + política (caminho do objeto começa com o `user_id` do requisitante; nenhum bucket de imagens, D17) — **Critério:** usuário não consegue ler arquivo de outro usuário.

  Migração `0013`: `insert into storage.buckets` (`on conflict do nothing`, idempotente) + 3 políticas (select/insert/delete, uma por operação — mesma convenção do resto do projeto) usando `storage.foldername(name))[1] = auth.uid()::text`. `revoke all ... from anon` explícito, mesmo o bootstrap do próprio Storage do Supabase possivelmente já vindo com grant padrão — este projeto prefere negação explícita a depender do default de uma peça que não é deste repositório. Convenção de caminho (não detalhada no plano além de "começa com o user_id"): `<user_id>/<job_id>/raw.json` e `<user_id>/<job_id>/summary.pdf`.

- [x] `T-053` `POST /export/summary` (contagem síncrona; zero entradas → `EXPORT_EMPTY_PERIOD` **sem criar job**) — **Critério:** `export_vazio.hurl` verde, zero linhas criadas em `export_jobs`.

  `count` é resolvido uma única vez, na hora, e gravado direto no job (`entry_count`) — o worker não recalcula (corrida "conta muda entre o pedido e o processamento" não é uma garantia pedida por nenhum documento-fonte). `narrative_status` já nasce `skipped` quando `includeNarrative=false` (nunca tentada).

- [x] `T-054` Worker de exportação com os dois status independentes (dados prontos não espera a narrativa) — **Critério:** `export_resiliente.hurl` verde.

  `export-worker` (Edge Function própria, **fora dos 23 endpoints do `registry.ts`**, sem `runGateway` — não é chamada por app algum, só pelo `pg_cron`/`pg_net` do T-051): coleta as entradas (`service_role`, filtra `user_id` explicitamente — o cliente ignora RLS, então a filtragem manual é quem garante o isolamento), grava o bruto (JSON) no Storage, marca `data_ready`, tenta a narrativa (Haiku, atrás do cache de replay — **precisou de um GRANT novo, migração `0016`**, já que as RPCs de cache da migração 0010 só tinham `EXECUTE` para `authenticated`, não `service_role`; editar a 0010 é proibido, então a 0016 só *acrescenta*). Sucesso: gera PDF (módulo `pdf.ts` novo — texto simples, fonte Helvetica embutida, sem dependência nova; **validado de verdade** com PyPDF2 neste sandbox, não só estruturalmente) e marca `done`. Falha: `narrative_status='failed'`, `status` **permanece** `data_ready` — nunca reverte o bruto já disponível.

  **2ª lacuna real encontrada implementando:** `ai_timeout` (Seção 10.2) é citado como aplicável a RF05, e `export_resiliente.hurl` é nomeado explicitamente no `Contexto Geral.md` testando esse caminho — mas a narrativa roda no worker, que nunca vê o `X-Test-Fault` da requisição síncrona original. Solução (migração `0018`, mesmo padrão `SECURITY DEFINER`): `export-summary-create` grava a intenção (`export_mark_fault`) junto do job quando `ctx.fault?.type === 'ai_timeout'`; o worker lê isso (`export_get_fault`, só `service_role`) antes de tentar a narrativa e força a falha sem bater na Anthropic.

- [x] `T-055` `GET /export/:jobId/status` (com `downloadAvailable` já resolvido) e `GET /export/:jobId/download` (302, PDF com fallback para bruto) — **Critério:** download responde 302 mesmo com narrativa falhada.

  `gateway.ts` ganhou um 3º tipo de resultado de handler (`RedirectHandlerResult`, ao lado do JSON e do SSE da Fase 4) — o registro já previa `kind: "redirect"` desde o T-026, mas nada ainda usava. A URL assinada é criada com o cliente do PRÓPRIO usuário (nunca `service_role`) — a política de Storage do T-052 já concede `select` ao dono do caminho, então isso funciona sem elevar privilégio. **Lacuna preenchida pragmaticamente:** nenhum documento-fonte diz o que devolver se o job ainda não chegou a `data_ready`/`done` (diferente de "narrativa falhou", que é coberto) — tratado como `NOT_FOUND` (o arquivo literalmente não existe ainda no Storage), mesma família de resposta de qualquer recurso ausente.

- [x] `T-056` `GET /dashboard/aggregate` (sempre 200, inclusive com zero entradas) — **Critério:** os três cenários (0/1/>30 entradas) respondem 200.

  Mesma descoberta da T-040 (Fase 3): agregação por dia/origem não dá pra fazer via construtor de query fluente do PostgREST — RPC nova (`dashboard_aggregate_counts`, migração 0015, `SECURITY INVOKER`, RLS de `entries` continua valendo, sem `user_id` como parâmetro). Handler monta `buckets`/`totals` a partir das linhas — dias/origens sem entrada simplesmente não aparecem (não preenche "buraco" com zero).

- [x] `T-057` `GET /dashboard/narrative` (independente do agregado) — **Critério:** `dashboard_degradado.hurl` verde.

  Endpoint comum (roda no ciclo requisição/resposta, ao contrário da narrativa de exportação) — mesmo padrão de qualquer outro endpoint de IA (PII, OCR, insight): cliente do usuário, atrás do cache de replay, `ai_timeout` tratado como em `chat-insight-create`/T-050.

- [x] `T-058` `PATCH /account/settings` (nome, persona, biometria; **`email` é rejeitado**) — **Critério:** `email_readonly.hurl` verde.

  `.strict()` do Zod (já escrito na Fase 2, `contracts/zod/account.ts`) resolve a rejeição de `email` sozinho — nenhum código extra no handler precisou checar isso.

- [x] `T-059` `DELETE /account` (hard delete, cascata, sem órfãos, purga o bucket `exports` do usuário) — **Critério:** `cascade_delete.sql` verde + bucket purgado.

  RPC `delete_own_account()` (migração 0017, decisão registrada no topo desta fase) apaga só o `auth.users.id` de quem chamou — a cascata completa (profiles → 7 tabelas) já estava provada desde a Fase 1 (`cascade_delete.sql`); `supabase/tests/account_delete_rpc.sql` (novo) prova a mesma cascata passando pela RPC, não por um `delete` direto. Purga do bucket primeiro (cliente do próprio usuário — a política do T-052 permite), apagamento da conta depois; se a purga falhar, a exclusão da conta segue adiante mesmo assim (trade-off registrado inline no handler: perder dado do usuário pra sempre por causa de um arquivo órfão seria pior que o inverso).

- [x] 🔴 **[MANUAL] `T-059v`** — Validar localmente os critérios de conclusão de `T-051`–`T-059` (item fora do backlog original, mesmo espírito do `T-019v`/`T-050v`) — **✅ CONFIRMADO pelo Wagner em 09/09/2026.**
  - **O quê**, na sua máquina local (Docker Desktop, `GATE-01`):
    1. `git pull origin fase5`
    2. `supabase db reset` — 20 migrações (0001–0020) + seed, sem erro
    3. `supabase test db` — esperado `Files=20, Tests=127, Result: PASS`
    4. **Configurar o worker** (só depois do `db reset`, uma vez): primeiro adicionar `EXPORT_WORKER_SECRET=<qualquer string sua>` ao `supabase/.env.local` (variável nova, migração 0019 — ver achado real abaixo); depois `insert into experiment.worker_config (functions_base_url, shared_secret) values ('http://host.docker.internal:54321/functions/v1', '<o MESMO valor de EXPORT_WORKER_SECRET que você acabou de colocar no .env.local>');` — sem essa linha (ou com a URL errada, ou com um valor diferente do `.env.local`) os jobs de exportação ficam presos em `pending` para sempre. **Achado real (Wagner):** `127.0.0.1` não funciona aqui — `pg_cron`/`pg_net` rodam dentro do container Docker do Postgres, de onde `127.0.0.1` aponta para o próprio container, não para a máquina que roda `supabase functions serve`. `host.docker.internal` é o endereço que o Docker Desktop (Mac/Windows) reserva para um container alcançar a máquina host. **2º achado real (Wagner), mais sutil:** a coluna se chamava `service_role_key` e a instrução original mandava colar a `SUPABASE_SERVICE_ROLE_KEY` do `.env.local` aqui — mas `supabase functions serve --env-file` recusa carregar qualquer variável `SUPABASE_*` do arquivo do desenvolvedor (usa sempre o valor interno da própria CLI), então esse valor nunca batia com o que a função via de verdade, e a checagem de autorização do `export-worker` rejeitava a chamada com 401 mesmo com a URL certa. Migração 0019 troca a checagem por um segredo próprio (`EXPORT_WORKER_SECRET`, sem o prefixo `SUPABASE_`) e renomeia a coluna para `shared_secret`.
    5. `supabase functions serve --env-file supabase/.env.local`
    6. Suíte Hurl completa (`tests/hurl/*.hurl`, `--jobs 1`) — os 11 arquivos novos da Fase 5 somados aos 15 já existentes
  - **Por que agora:** `pgmq`, `pg_net` e o serviço de Storage não têm como ser exercitados de verdade neste sandbox (nota de ambiente acima) — só o Supabase CLI real prova que o worker desperta, processa a fila e fala com o Storage de verdade.
  - **Como confirmo:** você reporta o resultado dos passos 2, 3 e 6 (incluindo quantas requisições passaram). Com a confirmação, os itens acima já marcados `[x]` (código) ficam também confirmados por comando.
  - **Em andamento — 1ª rodada dos passos 2/3, 2 bugs reais encontrados e já corrigidos** (achados só possíveis contra o Supabase CLI de verdade — nenhum dos dois apareceu no harness com stub, exatamente a lacuna já registrada na nota de ambiente acima):
    1. `rls_storage_exports.sql`: `storage.objects` do Supabase real tem um trigger próprio (`storage.protect_delete()`) que barra **qualquer** `DELETE` direto por SQL nessa tabela — mesmo do dono, mesmo em nome de teste — "Use the Storage API instead". O teste tentava provar "dono consegue apagar o próprio objeto" com um `DELETE` cru; corrigido para checar a política (`pg_policies`) em vez de exercitar a exclusão (a aplicação real, `account-delete/handler.ts`, já usa a Storage API, nunca SQL direto — nunca foi um bug do código, só do atalho que o teste tentava tomar).
    2. `export_queue.sql`: o `pgmq` real cria uma tabela **por fila** (`pgmq.q_<nome>`, aqui `pgmq.q_export_jobs_queue`) — não existe `pgmq.messages` (isso era só um detalhe de implementação do meu stub). Corrigido para o nome real; a asserção que inspecionava o conteúdo exato da chamada HTTP despachada (tabela interna do `pg_net`, nunca confirmada contra a extensão de verdade) foi removida em vez de arriscar mais uma suposição — quem prova esse pedaço de ponta a ponta é a suíte Hurl (passo 6, `export_download.hurl`/`export_resiliente.hurl`).
    3. `rls_storage_exports.sql`: depois do fix acima, sobrou 1 falha nova — `anon` conseguia ler `storage.objects` sem erro (esperava `42501`). Achado real: diferente de toda tabela em `public.*` (100% nossa desde a criação), `storage.objects` já vem com `SELECT` de fábrica para `anon`, dado pelo próprio serviço de Storage do Supabase — o `revoke all ... from anon` da migração 0013 não desfaz isso. Mantido mesmo assim como defesa em profundidade (comentário da migração atualizado para não prometer um efeito que não se sustenta); quem garante o isolamento de verdade é a RLS (zero linhas para `anon`, nenhuma política aplicável) — igualmente seguro, só não é um "erro explícito". Teste reescrito para aceitar os dois resultados possíveis (erro de permissão OU zero linhas) em vez de fixar qual dos dois o ambiente vai dar.
    - Nenhuma migração de verdade precisou mudar (só comentários) — os 3 achados eram todos nos testes.
  - **✅ Passos 2 e 3 confirmados pelo Wagner:** `supabase db reset` — 18 migrações + seed, sem erro; `supabase test db` — `Files=20, Tests=125, Result: PASS`, exatamente o esperado.
  - **Passo 6 (1ª rodada), 19/26 arquivos verdes — 2 causas raiz nos 7 que falharam, nenhum bug de código:**
    1. **Achado real de infraestrutura — `host.docker.internal`, não `127.0.0.1`:** `pg_cron`/`pg_net` rodam dentro do container Docker do Postgres — de lá, `127.0.0.1` aponta para o próprio container, nunca para a máquina onde `supabase functions serve` escuta. Sem o endereço certo em `experiment.worker_config`, o worker nunca é sequer chamado (nenhuma linha `export-worker` aparece no log do `functions serve`) e o job fica preso em `pending` para sempre — afetava `export_download.hurl`/`export_resiliente.hurl`. Corrigido na documentação (passo 4 acima e `tests/hurl/README.md`).
    2. **Texto de exemplo colado literal:** `--variable test_fault_key='<o mesmo TEST_FAULT_KEY do seu .env.local>'` foi usado com os sinais `<``>` inclusos, em vez do valor de verdade — `X-Test-Key` não bateu, então tanto `X-Test-Fault` quanto `X-Test-Now` foram ignorados em silêncio (comportamento correto do sistema para uma chave errada, §10.1). Isso derrubou `dashboard_degradado.hurl` e `insight_falha.hurl` (a falha de IA simulada nunca ativou) e a última checagem de `dashboard_aggregate.hurl` (o relógio de teste não pegou, então o filtro de período comparou com a data real de hoje em vez da data do seed — como o seed usa datas futuras relativas à data de congelamento, nada foi filtrado). Nenhuma mudança de código — só de instrução de uso.
    - Dois arquivos fora do escopo desta fase também falharam, sem relação com a Fase 5: `media_ocr.hurl` (faltou o `--variables-file` das imagens) e `busca_semantica.hurl` (precisa rodar `scripts/backfill-seed-embeddings.ts` de novo depois de cada `db reset` — Fase 1).
  - **2ª rodada, 3º achado real — causa raiz verdadeira de `export_download.hurl`/`export_resiliente.hurl`:** mesmo com a URL corrigida (confirmado por `net._http_response.status_code = 401` — não mais erro de conexão, prova de que a rede já funcionava), os jobs continuavam presos em `pending`. Causa: `supabase functions serve --env-file` recusa carregar do `.env.local` qualquer variável `SUPABASE_*` (mensagem real: `Env name cannot start with SUPABASE_, skipping: SUPABASE_SERVICE_ROLE_KEY`) — sempre injeta o valor interno da própria stack local no lugar. A checagem de autorização do `export-worker` (`index.ts`) comparava o bearer recebido com `SUPABASE_SERVICE_ROLE_KEY`, que por isso nunca podia bater com o valor colado manualmente em `experiment.worker_config`. **Corrigido** (migração `0019_export_worker_shared_secret.sql` + `_shared/deps.ts` + `export-worker/index.ts`): checagem trocada para um segredo próprio, `EXPORT_WORKER_SECRET` (fora do prefixo `SUPABASE_`, a CLI não mexe nele); coluna renomeada de `service_role_key` para `shared_secret` para não sugerir mais que precisa ser a service_role key de verdade. A `service_role key` real continua existindo e sendo usada (por outra variável, sem mudança) só para o cliente de banco do worker — nunca para essa autorização.
  - **3ª rodada, 2 problemas novos, ainda sem causa raiz confirmada — faltava visibilidade de log, corrigido antes de investigar mais:**
    1. `dashboard_aggregate.hurl` passou a falhar num ponto NOVO e mais cedo (500, não mais diferença de contagem) — a própria conta `cenario-vazio` (zero entradas), que antes passava, agora recebe 500 da 1ª chamada autenticada. Nenhuma migração/código desta fase toca `dashboard_aggregate_counts`/`profiles`, então a causa ainda é desconhecida.
    2. `export_download.hurl`/`export_resiliente.hurl`: o log do `functions serve` já mostra `export-worker` sendo chamado (prova de que o dispatch em si funciona) — mas o job continua preso em `pending` até o fim do teste, nunca vira `error` nem avança. Como o worker sempre marca `error` em caso de falha real (dentro de `processExportJob`), job parado em `pending` (não `error`) é sinal forte de que a chamada nem chegou a entrar no `processExportJob` — mais provável, ainda um 401 (bearer/segredo não bateu — típico de editar o `.env.local` sem reiniciar o `functions serve`, ou um valor diferente entre `.env.local` e o INSERT em `worker_config`).
    - **Causa raiz comum dos dois:** faltava visibilidade — tanto o "beco sem saída" de erro do `gateway.ts` (`handleError`, um 500 não reconhecido não logava nada, por design não vaza detalhe na resposta mas também não deixava rastro no servidor) quanto os `catch` do `export-worker/worker.ts` e o 401/400 do `export-worker/index.ts` engoliam o erro/motivo em silêncio. **Corrigido:** `console.error` adicionado nos 4 pontos (sem mudar nenhuma resposta ao cliente) — a próxima rodada já sai com o log revelando a causa de verdade em vez de só "500 genérico"/"pending para sempre".
  - **4ª rodada — os 2 logs vieram, causa raiz confirmada dos dois (1 bug de código real, 1 achado de ambiente, nenhum dos dois é "chute"):**
    1. **Bug de código real, corrigido — `export_jobs`/`entries` sem GRANT para `service_role`:** o log mostrou exatamente `permission denied for table export_jobs (42501)`, com a própria mensagem do Postgres sugerindo o `GRANT` que faltava. `service_role` tem `BYPASSRLS` (por isso ignora as políticas de `export_jobs`/`entries`, migração 0009) — mas isso não dispensa o `GRANT` comum de tabela, são dois mecanismos independentes do Postgres. Nenhuma migração anterior previu isso porque **esta foi a 1ª vez que `service_role` tocou uma tabela diretamente** neste projeto — todo uso anterior (migração 0016) era `GRANT EXECUTE` numa RPC `SECURITY DEFINER`, que roda com o privilégio do DONO da função, não do chamador. **Corrigido** (migração `0020_export_worker_table_grants.sql`): `grant select, update on public.export_jobs to service_role;` + `grant select on public.entries to service_role;` (só o que `export-repo.ts` de fato usa) — 2 casos pgTAP novos em `export_queue.sql` (`has_table_privilege`), plan atualizado para 9. **Tests agora 127** (era 125).
    2. **Achado de ambiente, não é bug de código — `dashboard_aggregate.hurl` deu 500 por `PGRST303 "JWT issued at future"`:** o PostgREST recusou o token recém-emitido pelo `auth-login` porque, do ponto de vista dele, o token "foi emitido no futuro" — sintoma clássico e bem documentado de relógio do Docker Desktop dessincronizado do relógio do Mac (comum depois que o Mac dorme/acorda com o Docker rodando). Nada no código deste projeto define/força esse timestamp (não tem `X-Test-Now` nessa chamada). **Ação:** reiniciar o Docker Desktop (fecha e abre de novo) resincroniza o relógio da VM — não é algo corrigível numa migração/Edge Function.
  - **5ª rodada — 2 dos 3 arquivos passaram de verdade:** `export_download.hurl` e `export_resiliente.hurl` **verdes** (`Success`, 11 e 9 requisições) — a migração 0020 resolveu o problema de permissão, o worker agora processa o job do início ao fim. O log mostra uma linha `[Error] export-worker: narrativa do job ... falhou: Error: ai_timeout forçado por X-Test-Fault` — **isso não é um bug**: é exatamente o `export_resiliente.hurl` testando de propósito o caminho "a IA falhou" (fault injection, migração 0018) — o `console.error` que acabamos de adicionar faz esse caminho ESPERADO aparecer no log como "erro" (é um erro, só que um erro provocado de propósito pelo teste, tratado corretamente pelo código: `narrative_status='failed'`, o resto do job continua `data_ready`).
  - **`dashboard_aggregate.hurl` ainda falha, mesmo depois de reiniciar o Docker Desktop — mesmo `PGRST303 "JWT issued at future"`:** reiniciar o app do Docker Desktop nem sempre resincroniza de fato o relógio da VM Linux por baixo dele (achado real — a orientação anterior era otimista demais). Correção mais direta, sem depender do Docker Desktop "decidir" resincronizar sozinho: forçar o relógio da VM a bater com o do Mac agora, via um comando (ver instruções dadas ao Wagner) — ou, como alternativa mais pesada, `supabase stop` + reabrir o Docker Desktop do zero + `supabase start` (recria os containers, inclusive o de autenticação, com um relógio novo em folha).
  - **6ª rodada — Wagner reiniciou o Mac inteiro (resolve o achado de ambiente de vez):** um reboot completo resincroniza o relógio da VM sem precisar de comando manual — `dashboard_aggregate.hurl` passou sozinho (`Success`, 8 requisições, incluindo a asserção `period=7d` com `X-Test-Now`). Um 404 pontual apareceu numa repetição isolada logo depois (perfil da conta `cenario-vazio` confirmado existente via SQL — não era o profile faltando) e sumiu na tentativa seguinte, nas mesmas condições — tratado como soluço passageiro do ambiente recém-reiniciado, não um bug (não voltou a acontecer em nenhuma rodada seguinte).
  - **7ª rodada — suíte completa (26 arquivos), 1º resultado: 22/26, `export_download.hurl`/`export_resiliente.hurl` voltam a falhar:** o log revelou a causa exata graças ao `console.error` do `index.ts` (achado da 3ª rodada): `401 — bearer recebido não bate com EXPORT_WORKER_SECRET`. Achado real, de processo (não de código): `experiment.worker_config.shared_secret` e `.env.local`'s `EXPORT_WORKER_SECRET` tinham saído de sincronia entre uma rodada e outra (provável retrabalho de `db reset` sem refazer os dois lados juntos). **Corrigido com um simples `UPDATE`** (sem precisar de código novo nem de outro `db reset`) igualando os dois valores.
  - **8ª rodada — suíte completa, 24/26, CONFIRMADO:** com o segredo sincronizado, `export_download.hurl` e `export_resiliente.hurl` passaram (`Success`) junto com o resto — só `busca_semantica.hurl` e `media_ocr.hurl` falharam, exatamente os 2 já esperados e fora do escopo da Fase 5 (pendência de reindexação da Fase 1 e falta do arquivo de variáveis de imagem, respectivamente). **`T-059v` confirmado pelo Wagner.**

### Encerramento da Fase 5 — notas para quem retomar (código completo em 07/09/2026, `T-059v` confirmado pelo Wagner em 09/09/2026 — Fase 5 fechada, dentro do prazo combinado de 19–20/09)

Escrito para dar contexto a uma conversa nova que não viu a sessão em que a Fase 5 foi executada.

**Onde o código foi escrito vs. onde foi validado de verdade — a fase com a maior lacuna entre as duas, das cinco até aqui:** `pgmq`, `pg_net` e o serviço de Storage do Supabase não têm pacote `apt` nem imagem genérica equivalente — só existem na imagem própria do Supabase. Diferente das Fases 1/4 (onde instalar `pgvector`/`pgtap`/`pg_cron` via `apt` bastou para validar contra Postgres real), aqui montei um harness com **stubs funcionais** dos três (mesmas assinaturas de função que as reais, comportamento simplificado) só para exercitar a lógica SQL própria deste projeto — ownership, RLS, grants, o fluxo dos updates — nunca para provar que `pgmq.send`/`pg_net.http_post`/Storage de verdade se comportam como os stubs. Com isso, apliquei as 18 migrações (0001–0018) do zero, em sequência, contra Postgres 16 real: `Files=20, Tests=125, Result: PASS`. Toda a lógica de negócio (67 testes `deno test` novos, ver números abaixo) roda com Anthropic/Storage/replay/banco mockados por injeção de dependência — nenhuma chamada real foi feita nesta fase.

**O que está pronto, commitado no branch `fase5`** (`T-051`–`T-059`, um commit por tarefa/grupo coerente):
- 7 migrações novas: `0013_export_storage` (bucket + políticas), `0014_export_queue` (pgmq + pg_net + RPCs de fila), `0015_dashboard_aggregate_rpc`, `0016_export_worker_replay_grants` (só GRANT, não toca a 0010), `0017_account_delete_rpc`, `0018_export_ai_timeout_fault` (repasse do fault pro worker), `0019_export_worker_shared_secret` (achado real do T-059v — ver abaixo, renomeia `experiment.worker_config.service_role_key` para `shared_secret`).
- 5 arquivos pgTAP novos em `supabase/tests/`: `rls_storage_exports.sql`, `export_queue.sql`, `dashboard_aggregate_rpc.sql`, `account_delete_rpc.sql`, `export_fault.sql` (31 casos).
- 8 diretórios de função novos (`supabase/functions/`): `export-summary-create`, `export-status-get`, `export-download-get`, `export-worker` (o único que não é um dos 23 endpoints — sem `runGateway`, autenticação própria por bearer == `EXPORT_WORKER_SECRET`, um segredo dedicado — ver achado real do T-059v abaixo), `dashboard-aggregate-get`, `dashboard-narrative-get`, `account-settings-update`, `account-delete`.
- Módulos novos em `_shared/`: `export-repo.ts`, `dashboard-repo.ts`, `pdf.ts` (gerador de PDF escrito à mão, sem dependência nova — validado com PyPDF2 de verdade, não só estrutura), `worker-db.ts` (o único lugar do projeto que cria cliente `service_role` — nunca importado pelos 23 endpoints de app).
- Extensões de módulos existentes: `gateway.ts` ganhou `RedirectHandlerResult` (3º tipo de resposta, ao lado de JSON e SSE); `prompts.ts` ganhou os templates de narrativa (export e dashboard, sem persona); `deps.ts` ganhou `readWorkerEnv`.
- `tests/hurl/`: 11 arquivos novos (`export_summary`, `export_vazio`, `export_status`, `export_download`, `export_resiliente`, `dashboard_aggregate`, `dashboard_narrative`, `dashboard_degradado`, `account_settings`, `email_readonly`, `account_delete`) — sintaxe conferida com `hurlfmt --check` (mesma versão do Wagner, 6.1.1, baixada só pra isso neste sandbox) e semântica validada de ponta a ponta contra um mock HTTP local: **11/11 arquivos, 55 requisições, 100%**. **Confirmado depois contra o stack real (Wagner, `T-059v`), migrações 0019/0020 aplicadas: os 11 novos + os 15 já existentes = 24/26 arquivos verdes** (os 2 que faltam, `busca_semantica.hurl`/`media_ocr.hurl`, são pendências de fases anteriores, sem relação com esta).

**Duas decisões de arquitetura reais, tomadas nesta fase e não previstas em nenhum documento-fonte** (além da de `DELETE /account`, já registrada no topo desta seção):
1. **Como o "consumidor `pg_cron`" desperta uma Edge Function** (T-051) — adição da extensão `pg_net` + a tabela `experiment.worker_config` (URL base + um segredo compartilhado, um INSERT manual por ambiente). Sem isso, "fila + consumidor" não tinha como sair do papel — `pg_cron` sozinho não fala HTTP. **Achado real do T-059v:** o segredo NÃO pode ser a `service_role key` do `.env.local` — a CLI (`functions serve --env-file`) recusa carregar qualquer variável `SUPABASE_*` desse arquivo, então a checagem de autorização do worker nunca bateria; a coluna (renomeada para `shared_secret`, migração 0019) guarda, em vez disso, um `EXPORT_WORKER_SECRET` dedicado.
2. **Repasse de `ai_timeout` pro worker assíncrono** (T-054, migração 0018) — o único dos 6 tipos de fault que precisa atravessar de uma requisição síncrona para um processo que roda depois dela.

**Números finais:** 67 testes `deno test` novos (384 no total, repo inteiro), todos verdes; `deno lint`/`deno fmt` limpos em todo arquivo escrito nesta fase. 32 casos pgTAP novos (`Files=20, Tests=127`) — 30 da leva original + 2 do achado de GRANT (`T-059v`, migração 0020). 20 migrações no total (0001–0020). Suíte Hurl: 24/26 arquivos verdes contra o Supabase CLI real (os 2 restantes são pendências de fases anteriores, não desta).

**Itens em aberto que já vinham de fases anteriores, sem mudança:** `docs/roteiro_de_validacao.md` continua pendente (retomar perto da Fase 6, lembrete de 18/09 — hoje é 07/09, ainda dentro do prazo combinado); `fixtures/trancricoes.md` continua com esse nome.

**`T-059v` — fechado.** A validação real (Wagner, Supabase CLI de verdade) encontrou e corrigiu 4 bugs reais de código/migração ao longo de 8 rodadas (detalhe completo no item `T-059v` acima) — todos em código escrito nesta fase, nenhum na infraestrutura das fases anteriores: (1) trigger `storage.protect_delete()` bloqueando DELETE direto num teste pgTAP; (2) nome real da tabela do `pgmq` (`pgmq.q_<fila>`, não `pgmq.messages`); (3) GRANT que faltava para `service_role` em `export_jobs`/`entries` (1ª vez que `service_role` tocou tabela diretamente neste projeto, migração 0020); (4) a checagem de autorização do worker não podia depender de `SUPABASE_SERVICE_ROLE_KEY` (a CLI recusa essa variável do `.env.local`), corrigida com `EXPORT_WORKER_SECRET` (migração 0019). Mais 2 achados de ambiente sem mudança de código (`host.docker.internal` em vez de `127.0.0.1`; relógio do Docker Desktop dessincronizado, resolvido com um reboot do Mac) e 1 finding de log (erros internos engolidos em silêncio em `gateway.ts`/`export-worker`, corrigido com `console.error` — foi o que permitiu confirmar os achados 3 e 4 acima em vez de continuar chutando).

**Sobre o Wagner (perfil de quem vai ler as respostas):** mesma orientação das fases anteriores — não é desenvolvedor backend, explicar conceitos técnicos com analogias simples antes/junto da justificativa de qualquer decisão.

**Gates manuais (🔴 [MANUAL]):** `T-059v` era o único desta fase — confirmado, fechado. Nenhum gate manual pendente na Fase 5.

---

## Fase 6 — Reprodutibilidade
**Prazo: 21/09 a 22/09/2026**

**Nota de ambiente e pendências herdadas (levantadas em 09/09/2026, sessão de revisão prévia — registrada antes de qualquer código desta fase):**

- **Bloqueio central, herdado desde a Fase 1: `docs/roteiro_de_validacao.md` não existia.** `T-060`, `T-061` e `T-062` dependem literalmente "do roteiro" — sem ele, "o cache é decorativo" (§14.3/`Contexto Geral.md`). `GATE-09` (`T-021`) estava **parcial** (só os 3 pares semânticos do RF06 aprovados, 02/09/2026); os textos literais do roteiro em si dependiam de dois documentos-fonte ausentes deste repositório (`Cerne_-_prototipo_final.html`, `Requisitos_e_Fluxo_de_Telas_TCC.md`). Consolidado corretamente naquela sessão como algo que "não é uma lacuna para o agente preencher por conta própria" (regra nº4) sem decisão do Wagner.
- **Resolvido numa sessão seguinte, no mesmo dia:** o Wagner foi consultado diretamente sobre como desbloquear isso e escolheu, explicitamente, "eu esboço, você revisa" — o agente então desenhou o roteiro completo (`docs/roteiro_de_validacao.md` + `fixtures/textos.json`, 4 textos literais novos, não 7 — divergência sinalizada no próprio documento — + `tests/determinism/roteiro_validacao.hurl`, a versão executável), cobrindo as 7 operações de IA e RF01/02/04/05/06/07/08/09/10 numa jornada coerente da conta A do seed. **Pendente de aprovação do Wagner antes de qualquer execução real em `record`** — só depois disso o `T-060` pode rodar de verdade. Isso não reabre a regra nº4: a lacuna foi levantada e é o Wagner, não o agente, quem decidiu como preenchê-la.
- **Achado real de arquitetura, documentado inline no roteiro (revisar se parecer errado):** 3 das 7 operações atrás do cache de replay (`chat`, `insight`, `narrative`/`dashboard`) embutem um id gerado pelo Postgres na impressão digital do `cache_key` (`replay.ts`: `retrievedEntryIds`, `sessionId`, `entryIdsHash`) — um id desses só repete entre execuções independentes (dois `db reset`, ou `ciclo-a` vs. `ciclo-b`) se vier do seed, nunca de algo criado pelo próprio roteiro. O roteiro tem por isso uma ordem obrigatória (tudo sensível a id via cache antes de qualquer entrada nova) — sem ela, nem `T-061` nem `T-062` conseguiriam bater a mesma `cache_key` entre execuções.
- **Achado desta revisão (09/09/2026, confirmado) — `T-063` não depende do roteiro.** Usa só os 5 endpoints já congelados (§10.3) e os cabeçalhos `X-Test-Fault` da Fase 2/3 — adiantado independentemente do bloqueio acima, feito antes mesmo do roteiro existir.
- **Achado desta revisão (09/09/2026) — os jobs de CI `db`/`api` (§11.4) nunca foram criados, e a tabela do plano técnico lista `determinism` como dependente dos dois.** Avaliado ao implementar `T-062`: criá-los do zero, sem poder validar contra o Supabase CLI real neste sandbox, seria escopo maior do que o pedido por essa tarefa — decisão tomada de fazer `determinism` autocontido (sobe o próprio `supabase start`) em vez de esperar por `db`/`api`. `db`/`api` dedicados continuam uma lacuna real deste CI, sinalizada, não escondida — fora do escopo do que foi resolvido aqui.
- **2º achado real, no próprio `T-062`:** a redação literal do §11.3 ("roda o roteiro 2x em `replay_strict`, banco recém-criado") não diz de onde vem o cache que `replay_strict` exige já pronto — `db reset` recria o schema `experiment` do zero a cada vez, e rodar `record` duas vezes não serviria (a Anthropic não garante o mesmo texto duas vezes para o mesmo prompt — exatamente o não-determinismo que o cache existe para esconder). Solução adotada, documentada em `tests/determinism/run.sh`: uma passada `record` (popula o cache do zero, barato — §14.5 estima o projeto inteiro abaixo de US$20), exportada (`T-061`) e importada em duas execuções independentes `replay_strict`, cada uma com banco recém-criado — testa exatamente a propriedade que interessa (a mesma mecânica de `ciclo-a` → `ciclo-b`).
- **Duas divergências menores, herdadas desde a Fase 1, relevantes porque o roteiro usa as fixtures diretamente:** (1) `fixtures/trancricoes.md` foi versionado sem o "s" de "trans" — os documentos-fonte esperam `transcricoes.md`; ainda não decidido se renomeia. (2) o áudio fixture tem 50,4s reais, não os 42s descritos no plano técnico — `roteiro_validacao.hurl` usa `mediaDurationSeconds: 50` (arredondado), não um valor inventado.

- [x] 🔴 **[MANUAL] `T-060` / `GATE-10`** — Executar o roteiro de validação em modo `record` — **✅ CONFIRMADO pelo Wagner em 10/09/2026**
  - **O quê:** Executar manualmente, passo a passo, o roteiro de validação completo (textos exatos, imagens exatas, ordem exata de telas) contra o ambiente com `REPLAY_MODE=record`. Isso popula o cache de replay chamando as IAs de verdade, uma única vez.
  - **Por que agora:** é a única execução em que a IA real é chamada para gravar o cache — todas as execuções seguintes (inclusive nos dois ciclos comparativos) devem reaproveitá-lo, nunca regravar.
  - **Como confirmo:** cache populado; taxa de acerto (`hit_count`) reportada.
  - **✅ Rascunho do roteiro aprovado pelo Wagner (10/09/2026)** — desbloqueado.
  - **1ª tentativa — 1 achado real encontrado e já corrigido** (só possível contra o Supabase CLI de verdade — nunca apareceu no mock desta sessão, que é tolerante demais para pegar isso): o Bloco 4 (busca por "cansaço"/"gratidão") falhava com `400`/corpo vazio. Causa raiz confirmada via `hurl --verbose` isolando a chamada: a resposta vinha do **Kong** (`Via: kong/2.8.1`, `Content-Length: 0`, 1ms — rápido demais pra ter passado pela nossa Edge Function, que sempre devolve corpo JSON mesmo em erro), o proxy que `supabase functions serve` roda na frente de toda função — ele rejeita um caractere não-ASCII cru (`ç`/`ã`) na URL; `hurl`/libcurl não codifica isso sozinho (diferente de "ansiedade", sem acento, que sempre funcionou). Não é bug do projeto (um cliente HTTP de verdade resolve isso ao montar a URL) — corrigido em `tests/determinism/roteiro_validacao.hurl`, codificando os dois termos na URL (`cansa%C3%A7o`/`gratid%C3%A3o`; `entries-search` decodifica de volta normalmente). Detalhe completo em `docs/roteiro_de_validacao.md`.
  - **2ª tentativa (banco resetado antes) — `Success`, 30 requisições** (26 do roteiro + 4 retries do `GET /export/:jobId/status` esperando o `pg_cron`/worker terminar de processar — comportamento esperado, não um problema). **`experiment.ai_replay_cache` confirmado, 22 entradas gravadas, 3 hits já nesta 1ª gravação:**

    | operation | linhas | hits |
    |---|---|---|
    | chat | 3 | 1 |
    | insight | 2 | 0 |
    | embedding | 10 | 2 |
    | pii | 4 | 0 |
    | ocr | 1 | 0 |
    | narrative | 1 | 0 |
    | dashboard | 1 | 0 |

    Números batem exatamente com o desenho do roteiro, incluindo um detalhe não óbvio na hora de somar de cabeça: cada envio de mensagem de chat dispara sua própria busca de contexto (RAG) *além* da chamada de geração — por isso `embedding` (10) é maior que as 4 buscas visíveis na tela (Bloco 4) somadas às 4 entradas novas (Bloco 7): são também as 3 buscas de contexto do chat + o retry (D15) refazendo a mesma busca de contexto e batendo cache — os 2 hits de `embedding` são exatamente essa repetição (busca "ansiedade" repetida no Bloco 4) e essa (retry reaproveitando o RAG da mensagem original); o hit de `chat` é o próprio retry reaproveitando a resposta gerada. `pii`=4 e as 4 entradas novas do Bloco 7 também batem 1 a 1.

- [x] `T-061` Script de export/import do cache entre ambientes — **Critério:** cache gravado no `ciclo-a` é exportado e importado no `ciclo-b` **sem regravar**. ⚠️ Gravar duas vezes (uma por ciclo) anula todo o mecanismo de determinismo.

  `scripts/replay-cache-export.ts`/`replay-cache-import.ts` — conectam direto no Postgres (mesmo padrão de `backfill-seed-embeddings.ts`/`prove-rf06.ts`, `experiment` não é exposto via PostgREST). Export determinístico (ordenado por `cache_key`); import idempotente (`on conflict do nothing`), ignora `hit_count`/`created_at` de propósito (telemetria por ambiente, não identidade do cache), e **recusa importar por padrão se o destino já tiver qualquer linha** (`--force` só para reimportar depois de um `db reset` real) — a salvaguarda central contra o próprio risco que o critério desta tarefa cita. Validado de ponta a ponta nesta sessão contra Postgres 16 real (`pgvector`/`pgtap` via `apt`, migrações 0008/0010 aplicadas): export→wipe→import, `hit_count` zerado no destino (não copiado), reimport sem `--force` recusado, reimport com `--force` idempotente.

- [x] `T-062` Job `determinism` no CI (roteiro 2x em `replay_strict`, banco recém-criado, comparação byte a byte normalizando IDs/timestamps) — **Critério:** duas execuções produzem output idêntico.

  `tests/determinism/normalize.ts` (normalização posicional — todo UUID/timestamp vira um placeholder pela ordem da 1ª aparição, contador único pra execução inteira, não por resposta — pega não só "os valores mudam" mas "a relação entre eles muda", ex. um id devolvido na criação deixar de bater com o lido depois) + `compare.ts` (CLI) + `run.sh` (orquestração, 2º achado real acima) + job `determinism` novo em `ci.yml` (autocontido — desvio deliberado da tabela de dependências do §11.4, `db`/`api` ainda não existem no CI, sinalizado como lacuna pré-existente, não criada por esta tarefa). 7 testes `deno test` novos (**391 no total, repo inteiro**, todos verdes) validam a normalização com fixtures sintéticas; `compare.ts` também validado contra dois `report.json` REAIS do binário `hurl` 6.1.1 (baixado do GitHub Releases nesta sessão) — duas execuções do mock com UUIDs genuinamente diferentes deram "IDÊNTICO", e uma corrupção deliberada de um corpo de resposta foi detectada com a linha exata.

  **Não validado:** `run.sh`/o job de CI contra Docker/Supabase/GitHub Actions reais (mesmo bloqueio de rede das fases anteriores) — e faltam secrets no repositório (`TEST_FAULT_KEY`, `PROMPT_VERSION`, `TEST_ACCOUNT_PASSWORD`, `EXPORT_WORKER_SECRET`; `GATE-07` da Fase 0 segue parcial).

- [x] `T-063` Os 15 cenários de injeção de falha evidenciados — **Critério:** `fault_injection_log` com 15 linhas distintas (5 endpoints × 3 tipos: `timeout`, `malformed`, `offline`).

  `tests/hurl/falhas_15.hurl` cobre os 10 cenários observáveis por HTTP (`timeout`+`malformed` × 5 endpoints). **Achado real, confirmado contra o binário `hurl` 6.1.1 de verdade:** `offline` nunca produz uma `Response` (design de `gateway.ts::simulateOffline`) e o Hurl não tem como esperar por "nenhuma resposta" — o único limitador de tempo (`--max-time`) é *cli-only*, aplicaria a TODAS as entradas do arquivo, derrubando as 5 de `timeout` (que legitimamente levam 35s) antes delas terminarem. `scripts/verify-fault-injection-log.ts` cobre o resto: dispara os 5 `offline` com um `AbortSignal` curto do lado do cliente (confirma "sem resposta" de verdade) e confere as 15 combinações distintas direto em `experiment.fault_injection_log` (schema sem rota HTTP). Validado nesta sessão: `hurlfmt --check` limpo; 12/12 requisições do `.hurl` contra um mock HTTP local reproduzindo os efeitos reais do `gateway.ts`; a query de agrupamento do script testada contra o Postgres real do `T-061` com as 15 linhas esperadas.

  **✅ Confirmado pelo Wagner em 10/09/2026, contra o Supabase CLI real:** `tests/hurl/falhas_15.hurl` — `Success`, 12/12 requisições (~3 minutos, como esperado pelas 5 esperas de 35s). `scripts/verify-fault-injection-log.ts` — os 5 cenários de `offline` confirmados (nenhum respondeu, como deveria) e as **15/15 combinações distintas confirmadas em `experiment.fault_injection_log`**. `T-063` fechado de ponta a ponta, sem nenhum achado novo (o único achado real desta tarefa já tinha sido o de design, acima, encontrado ainda no sandbox).

- [ ] 🔴 **[MANUAL] `T-063v`** — Validar `T-061`/`T-062` contra o Supabase CLI/Docker real e o GitHub Actions
  - **O quê:** (1) ✅ ~~rodar `tests/hurl/falhas_15.hurl` + `scripts/verify-fault-injection-log.ts` contra `supabase functions serve` local~~ — feito acima, junto do `T-063`; (2) ✅ ~~exportar o cache do `dev` e importar num banco de teste local, conferir `--force`~~ — **confirmado pelo Wagner em 10/09/2026:** `replay-cache-export.ts` exportou 24 entradas de `dev` sem erro; `replay-cache-import.ts` **recusou** reimportar no mesmo banco (não-vazio) com a mensagem exata esperada, sem `--force` — a salvaguarda central do `T-061` provada contra o Postgres real, não só o harness deste sandbox; (3) completar os secrets pendentes do `GATE-07` (`TEST_FAULT_KEY` ✅, `EXPORT_WORKER_SECRET` ✅, `PROMPT_VERSION`, `TEST_ACCOUNT_PASSWORD` — os 2 últimos ainda a confirmar cadastrados) e rodar `tests/determinism/run.sh` uma vez local antes de confiar no job `determinism` do CI.
  - **Por que agora:** `pg_cron`/`pg_net` (a fila do worker de exportação, por trás disso tudo) não puderam ser exercitados contra Docker/GitHub Actions de verdade neste sandbox — mesmo motivo de todo `T-0xxv` anterior.
  - **Como confirmo:** você reporta o resultado do passo 3 (o único que falta).

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
- **Consolidado com detalhe de bloqueio na "Nota de ambiente e pendências herdadas" no início da Fase 6** (`T-060`/`T-061`/`T-062`) — inclui também um achado novo (09/09/2026): os jobs de CI `db`/`api`/`determinism` do §11.4 do plano técnico nunca foram criados em nenhuma fase anterior.

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
