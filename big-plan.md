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

- [ ] `T-011` Migração de extensões: `pgcrypto`, `vector`, `pgmq`, `pg_cron`, `pgtap` — **Critério:** `supabase db reset` roda sem erro.

- [ ] `T-012` Tabela `profiles` (id, email, display_name, biometric_enabled, persona, server_revision, timestamps) + trigger de criação a partir de `auth.users` — **Critério:** cadastro de usuário cria linha em `profiles`.

- [ ] `T-013` Tabelas `chat_sessions` e `chat_messages` + triggers (incremento de `user_message_count` e `last_user_message_at` ao inserir mensagem `role='user'`) — **Critério:** `user_message_count` incrementa corretamente.

- [ ] `T-014` Tabela `entries` (conteúdo íntegro, origem, `chat_message_id`, embedding 1024d + versionamento, status de embedding/PII, PII spans, duração de mídia) + índice de timeline + **índice único parcial de idempotência** (`user_id`, `chat_message_id` quando não nulo) + trigger `bump_server_revision` — **Critério:** índice de idempotência existe e é verificável via `\d entries`.

- [ ] `T-015` Tabelas `tags` e `entry_tags` (populadas só pelo seed, nenhum endpoint escreve nelas).

- [ ] `T-016` Tabela `insights` com **UNIQUE** sobre `(session_id, trigger_type, trigger_key)` — **Critério:** insert duplicado é recusado pelo banco.

- [ ] `T-017` Tabela `export_jobs` com os dois status independentes (`status` do job e `narrative_status` da narrativa).

- [ ] `T-018` Schema `experiment` (fora do alcance de RLS de usuário) com `ai_replay_cache` e `fault_injection_log` — **Critério:** papel `authenticated` não tem acesso ao schema.

- [ ] `T-019` Políticas de RLS em **todas** as tabelas com dono: `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + uma política por operação (`auth.uid() = user_id`) + `REVOKE ALL ... FROM anon` — **Critério:** `supabase test db` verde.

- [ ] 🔴 **[MANUAL] `T-019v`** — Validar localmente os critérios de conclusão de `T-011`–`T-022` (item fora do backlog original — registrado por causa do bloqueio de rede descrito na "Nota de ambiente" acima)
  - **O quê**, na sua máquina local (Docker Desktop já rodando, `GATE-01`):
    1. `git pull origin fase1`
    2. `supabase db reset` — conferir que sobe **sem erro** (isso já aplica as 9 migrações **e** carrega o seed com as 3 contas)
    3. `\d entries` — confirmar o índice único parcial de idempotência (`entries_chat_message_uniq`)
    4. Tentar inserir duas linhas em `insights` com o mesmo `(session_id, trigger_type, trigger_key)` e confirmar que a segunda é recusada pelo banco
    5. Cadastrar um usuário de teste (fora das 3 contas do seed) e confirmar que aparece uma linha em `profiles` com o mesmo `id`
    6. Conferir a contagem do seed: `select count(*) from entries where user_id = 'a0000000-0000-0000-0000-000000000001'` deve dar **34**; trocando o `user_id` pelo de `cenario-uma@cerne.test`/`cenario-vazio@cerne.test`, **1** e **0**
    7. **Rodar o backfill de embeddings** (só depois do `db reset` acima): `deno run --allow-net --allow-env scripts/backfill-seed-embeddings.ts`, com `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `VOYAGE_API_KEY` no ambiente — sem isso a conta A fica com 33 entradas em `embedding_status='pending'` para sempre, e a prova do RF06 (`T-024`, mais adiante) não tem embedding pra buscar
  - **Por que agora:** é a única forma de comprovar por comando os critérios de `T-011`–`T-022` enquanto este ambiente remoto não pode baixar as imagens Docker do Supabase. O passo 7 é o único que não é só "confirmar o já escrito" — é uma ação que só pode acontecer na sua máquina (chama a Voyage de verdade).
  - **Como confirmo:** você reporta o resultado de `supabase db reset`, das verificações pontuais (3–6) e da saída do script de backfill (quantos embeddings gravados, quantas falhas). Com a confirmação, marco `T-011`–`T-022` como `[x]`.

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

- [ ] `T-022` `supabase/seed/seed.sql` idempotente, com âncora de data fixa (`ANCORA = 2026-09-23T09:41:00Z`, documentada em `supabase/seed/ancora.md`, datas do seed sempre relativas a ela) e as três contas:

  | Conta | E-mail | Conteúdo |
  |---|---|---|
  | A | `cenario-cheio@cerne.test` | 34 entradas (14 manual, 8 áudio, 6 foto, 6 chat) em 10 dias, 4 tags, 3 sessões de chat (uma com exatamente 4 mensagens do usuário, para o roteiro disparar o gatilho N=5 na 5ª), os 3 pares semânticos plantados, ao menos uma entrada `embedding_status='failed'` e uma `pii_status='flagged'` |
  | B | `cenario-uma@cerne.test` | 1 entrada, sem tags, sem chat |
  | C | `cenario-vazio@cerne.test` | nenhuma entrada |

  Senha única via `TEST_ACCOUNT_PASSWORD`. Embeddings da conta A são gerados de verdade via Voyage na primeira execução e reaproveitados depois. — **Critério:** `supabase db reset` carrega 34+1+0 entradas.

  **Status em 02/09/2026:** código escrito (`supabase/seed/seed.sql`, `supabase/seed/ancora.md`) e validado por dry-run funcional neste sandbox (Postgres 16 nativo + as 9 migrações + mocks de `auth.users`/`auth.uid`/roles, mesmo esquema do dry-run de `T-011`–`T-019`): 34+1+0 entradas, 10 dias distintos na conta A, fontes 14/8/6/6, `chat_sessions.user_message_count` = 4/3/3 (trigger correto), 4 tags, 13 `entry_tags`, zero linha com `source`/`chat_message_id` incoerente, senha bate via `crypt()`, RLS isola cada conta corretamente, e reexecutar o `seed.sql` não duplica nada (idempotência confirmada). **Ainda não roda de verdade no Supabase CLI** — mesmo bloqueio de rede da nota de ambiente, dentro de `T-019v`.

  Duas lacunas que os documentos-fonte não resolviam, preenchidas de forma pragmática (revisar se achar errado):
  - **Senha:** `seed.sql` é SQL puro, sem acesso a variável de ambiente do shell — fixei o literal `Cerne-Teste-2026!` dentro do seed (hash via `crypt()`). `TEST_ACCOUNT_PASSWORD` precisa ser configurado com esse valor exato. Detalhado em `supabase/seed/ancora.md`.
  - **Embeddings reais da conta A:** SQL puro não faz chamada HTTP. `seed.sql` grava as 34 entradas da conta A com `embedding_status='pending'` (exceto a que fica propositalmente `'failed'`); um script novo, `scripts/backfill-seed-embeddings.ts` (Deno), precisa ser rodado **uma vez** depois de `supabase db reset` — chama a Voyage de verdade e preenche os embeddings. É idempotente (só toca `pending`). **Ação pendente do Wagner:** depois de rodar `supabase db reset` localmente, rodar `deno run --allow-net --allow-env scripts/backfill-seed-embeddings.ts` com `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `VOYAGE_API_KEY` no ambiente — sem isso a prova do RF06 (`T-024`) não tem embedding pra buscar.

- [ ] `T-023` Suíte pgTAP completa (ver Fase 1 de testes, abaixo) — **Critério:** `supabase test db` 100% verde.

- [ ] `T-024` **Prova do RF06** — busca por `ansiedade` (ou `cansaço`/`gratidão`) no seed encontra o par plantado correspondente. ⚠️ **Se falhar nos três pares, parar e reportar** — é condição de viabilidade do RF06, não um detalhe.

---

## Fase 2 — Contratos e Gateway
**Prazo: 06/09 a 09/09/2026**

- [ ] `T-025` Módulo `errors` com os 13 códigos da taxonomia e mapeamento para HTTP/`retryable` — **Critério:** teste unitário do mapeamento passa.
- [ ] `T-026` Módulo `contracts` — schemas Zod dos 23 endpoints (fonte única do OpenAPI) — **Critério:** todos os schemas compilam.
- [ ] `T-027` Módulo `serialize` (conversão `snake_case` ↔ `camelCase` + envelope de resposta) — **Critério:** teste de ida e volta passa.
- [ ] `T-028` Módulo `clock` respeitando o cabeçalho `X-Test-Now` — **Critério:** teste com relógio congelado passa.
- [ ] `T-029` Módulo `faults` (interpretação de `X-Test-Fault`, os 6 tipos) + tabela `fault_injection_log` — **Critério:** os 6 tipos disparam e registram.
- [ ] `T-030` Módulo `replay` com os 4 modos (`off`/`record`/`replay`/`replay_strict`) e envelope canônico de impressão digital — **Critério:** mesmo input produz sempre a mesma `cache_key`.
- [ ] `T-031` Módulo `gateway` (ponto de entrada único) na ordem obrigatória: `X-Request-Id` → `X-Test-Key` → `X-Test-Now` → `X-Test-Fault` (antes da autenticação para `offline`, depois para os demais) → autenticar → validar corpo (Zod) → handler → serializar → tratar exceção — **Critério:** requisição sem token retorna `AUTH_EXPIRED`.
- [ ] `T-032` Clientes `ai/anthropic` e `ai/voyage`, sempre atrás do cache de replay — **Critério:** segunda chamada idêntica retorna `hit`.
- [ ] `T-033` `scripts/gen-openapi.ts` gerando `contracts/openapi.yaml` a partir dos schemas Zod, com verificação de drift no CI — **Critério:** job `contracts` verde.

- [ ] ⚠️ **Ponto de decisão do cronograma:** se esta fase não fechar até **09/09**, cortar o RF05 (exportação) do escopo — maior economia isolada disponível (remove `pgmq`, `pg_cron`, Storage, geração de PDF e os 3 endpoints de exportação da Fase 5). Decidir isso **nesta data**, não depois.

---

## Fase 3 — Entradas
**Prazo: 10/09 a 13/09/2026**

- [ ] `T-034` Os 5 endpoints de autenticação (`/auth/signup`, `/auth/login`, `/auth/refresh`, `GET /auth/session`, `/auth/logout`) — **Critério:** suíte Hurl do bloco verde.
- [ ] `T-035` `POST /entries` com a sequência obrigatória: validar → (se `chatMessageId`) tentar idempotência → PII (Haiku, tool use) → gravar → embedding (Voyage) com fallback `failed` sem perder a entrada — **Critério:** `idempotencia_rf10.hurl` verde.
- [ ] `T-036` Detecção de PII com saída estruturada (tool use) — **Critério:** entrada com nome próprio vira `pii_status='flagged'` com `content` intacto.
- [ ] `T-037` Geração de embedding com fallback — **Critério:** Voyage forçada a falhar ainda deixa a entrada gravada com `embedding_status='failed'`.
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
