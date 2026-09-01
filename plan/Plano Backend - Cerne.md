# Cerne Backend — Especificação Técnica de Implementação

**Versão 1.0 · 31/08/2026**
Documento operacional para execução no Claude Code. Deriva de `Plano_Backend_Cerne_v4.md` (decisões) e `Requisitos_e_Fluxo_de_Telas_TCC_v2.md` (requisitos). Em caso de conflito, aqueles documentos prevalecem.

---

## 0. Protocolo de execução para o agente

### 0.1 Regras invioláveis

1. **Execute as tarefas na ordem do backlog da Seção 13.** Cada tarefa tem pré-requisitos declarados. Não antecipe.
2. **Nenhuma tarefa é considerada concluída sem seu Critério de Conclusão verificado por comando.** "Parece certo" não conta.
3. **Não reabra decisões.** As decisões D1–D18 estão fechadas. Se uma parecer errada durante a implementação, **pare e reporte ao desenvolvedor** em vez de contornar.
4. **Não invente endpoints, colunas, códigos de erro ou campos.** O inventário está congelado. Se algo parecer faltando, reporte.
5. **Não use `service_role` em nenhuma Edge Function que atenda requisição do aplicativo.** Apenas em workers de fila.
6. **Toda ordenação SQL termina com desempate por `id ASC`.** Sem exceção — é requisito de determinismo.
7. **Não crie índice vetorial** (HNSW ou IVFFlat). Varredura exata é obrigatória.

### 0.2 Portões de ação humana

Algumas tarefas exigem ação do desenvolvedor e **não podem ser executadas pelo agente**. Elas estão marcadas no backlog com `[GATE]`.

Ao encontrar um portão, o agente deve:

1. **Parar a execução.**
2. Emitir uma mensagem no formato:

```
⚠️ AÇÃO NECESSÁRIA — <título curto>

O que fazer:
  <passos numerados, específicos>

Por que agora:
  <consequência de não fazer / o que isso desbloqueia>

Como eu confirmo que foi feito:
  <comando ou verificação objetiva>

Aguardando sua confirmação para continuar.
```

3. **Aguardar confirmação explícita.** Não presumir conclusão, não seguir para a próxima tarefa.
4. Após a confirmação, **executar a verificação** antes de prosseguir. Se falhar, reportar e aguardar de novo.

A lista completa de portões está na Seção 1.

### 0.3 Ao final de cada tarefa

Reportar em três linhas: o que foi feito, qual comando comprova, e qual é a próxima tarefa. Sem prosa adicional.

### 0.4 Quando algo dá errado

Se um teste falhar por motivo não previsto, **não ajuste o teste para passar**. Reporte a divergência entre o esperado e o obtido. Testes ajustados para passar destroem o valor do instrumento de medição.

---

## 1. Portões de ação humana — lista completa

| ID | Momento | Ação do desenvolvedor |
|---|---|---|
| `GATE-01` | Antes da T-001 | Instalar Docker Desktop e mantê-lo rodando |
| `GATE-02` | Antes da T-002 | Criar conta no Supabase e três projetos: `cerne-dev`, `cerne-ciclo-a`, `cerne-ciclo-b` |
| `GATE-03` | T-003 | Executar `supabase login` (abre navegador, exige credencial pessoal) |
| `GATE-04` | T-004 | Criar chave de API na Anthropic e definir teto de gasto mensal |
| `GATE-05` | T-005 | Criar conta na Voyage AI, gerar chave, habilitar billing e definir teto |
| `GATE-06` | T-006 | Criar repositório privado no GitHub e conceder acesso ao agente |
| `GATE-07` | T-008 | Cadastrar os secrets no GitHub Actions |
| `GATE-08` | T-020 | Fornecer as três fixtures de mídia |
| `GATE-09` | T-021 | Aprovar os sete textos literais e os três pares semânticos |
| `GATE-10` | T-060 | Executar o roteiro de validação manualmente em modo `record` |
| `GATE-11` | T-063 | Criar a tag de congelamento e publicar o repositório de handoff |
| `GATE-12` | Início do ciclo B | Reativar o projeto `cerne-ciclo-b` (pausa por inatividade) e reconferir hash de schema |

### Detalhamento dos portões críticos

**GATE-02 — três projetos Supabase.** Região igual nos três (`sa-east-1`, São Paulo). Anotar `project ref`, `anon key`, `service_role key` e a senha do banco de cada um. O `cerne-dev` é o único onde o agente escreve durante o desenvolvimento; `ciclo-a` e `ciclo-b` recebem apenas migrações e seed.

**GATE-04 e GATE-05 — tetos de gasto.** Obrigatórios antes de qualquer código que chame IA. Um laço acidental em endpoint de IA queima crédito em minutos. Sugestão: US$ 50 na Anthropic, US$ 20 na Voyage.

**GATE-05 — verificação da Voyage.** Já executada em 31/08/2026: `voyage-4` com `output_dimension: 1024` retornou 1024 floats. Se a chave for recriada, repetir a verificação antes da T-030.

**GATE-08 — fixtures de mídia.** Três arquivos, colocados em `fixtures/media/`:
- `audio_fixture_01.wav` — 42 segundos, fala em português, transcrição conhecida e anotada em `fixtures/transcricoes.md`
- `ocr_fixture_01.png` — foto de caderno manuscrito, texto legível
- `ocr_fixture_ilegivel.png` — imagem sem texto reconhecível

Os arquivos são imutáveis após a T-060. Regenerar qualquer um invalida o cache de replay.

---

## 2. Estrutura do repositório

```
cerne-backend/
├── supabase/
│   ├── config.toml
│   ├── migrations/            # numeradas, imutáveis após aplicadas
│   ├── seed/
│   │   ├── seed.sql
│   │   └── ancora.md          # documenta a âncora de data
│   ├── functions/
│   │   ├── _shared/           # gateway, contratos, clientes de IA, cache, faults
│   │   └── <um diretório por endpoint>
│   └── tests/                 # pgTAP
├── contracts/
│   ├── zod/                   # schemas — fonte única
│   └── openapi.yaml           # GERADO, versionado, verificado pelo CI
├── tests/
│   ├── hurl/                  # contrato de endpoint
│   └── determinism/           # execução dupla do roteiro
├── fixtures/
│   ├── media/
│   ├── textos.json
│   └── pares_semanticos.md
├── docs/
│   ├── bugs_conhecidos.md
│   ├── roteiro_de_validacao.md
│   ├── mapa_de_estados.md
│   └── handoff/               # o que vai para os ciclos
├── scripts/
└── .github/workflows/
```

**Regra de imutabilidade de migração.** Uma vez aplicada em qualquer ambiente que não seja o local, a migração nunca é editada. Correções entram como nova migração.

---

## 3. Convenções obrigatórias

### 3.1 Nomenclatura

| Camada | Convenção | Exemplo |
|---|---|---|
| Tabelas e colunas | `snake_case`, tabela no plural | `chat_messages.created_at` |
| Campos JSON da API | `camelCase` | `chatMessageId` |
| Diretórios de função | `kebab-case` | `entries-search` |
| Migrações | `NNNN_descricao.sql` | `0003_entries.sql` |

A conversão entre `snake_case` do banco e `camelCase` da API acontece na camada de serialização compartilhada, nunca ad hoc por endpoint.

### 3.2 Envelope de resposta

**Sucesso** — sempre objeto na raiz, nunca array:
```
{ "data": <objeto ou array>, "meta": { ... } }
```

**Erro** — formato único em toda a API:
```
{ "code": "<ErrorCode>", "message": "<texto legível>", "retryable": <bool>, "requestId": "<uuid>" }
```

### 3.3 Cabeçalhos

| Cabeçalho | Direção | Uso |
|---|---|---|
| `Authorization: Bearer <jwt>` | entrada | Token do GoTrue |
| `X-Request-Id` | ambas | Ecoado; gerado se ausente |
| `X-Data-Version` | saída | ETag derivado de `server_revision` |
| `X-Replay-Status` | saída | `hit` \| `miss` \| `off` |
| `X-Test-Fault` | entrada | Injeção de falha (Seção 10) |
| `X-Test-Now` | entrada | Congela o relógio |
| `X-Test-Key` | entrada | Segredo que habilita os dois anteriores |

### 3.4 Códigos HTTP

| Situação | Código |
|---|---|
| Sucesso | 200 |
| Job assíncrono aceito | 202 |
| Download | 302 para URL assinada |
| Erro de validação | 400 |
| Autenticação | 401 |
| Recurso inexistente **ou de outro usuário** | 404 |
| Payload grande demais | 413 |
| Falha de IA ou de provedor externo | 502 |
| Timeout | 504 |

**Nunca 403.** Recurso de outro usuário retorna 404 (D7) — 403 vazaria a existência.

**Nunca 409.** A idempotência do RF10 retorna 200 com a entrada existente (D4).

### 3.5 Determinismo

- Toda cláusula `ORDER BY` termina em `, id ASC`
- Toda referência a "agora" passa pela função compartilhada `now()` que respeita `X-Test-Now`
- Nenhum índice vetorial aproximado
- Nenhum valor aleatório em resposta, exceto UUIDs de linhas novas

### 3.6 Variáveis de ambiente

| Variável | Onde | Descrição |
|---|---|---|
| `SUPABASE_URL` | função | URL do projeto |
| `SUPABASE_ANON_KEY` | função | Chave pública |
| `SUPABASE_SERVICE_ROLE_KEY` | worker | **Apenas** em workers de fila |
| `ANTHROPIC_API_KEY` | função | Sonnet 5 e Haiku 4.5 |
| `VOYAGE_API_KEY` | função | Embeddings |
| `REPLAY_MODE` | função | `off` \| `record` \| `replay` \| `replay_strict` |
| `TEST_FAULT_KEY` | função | Segredo dos cabeçalhos de teste |
| `PROMPT_VERSION` | função | String de versão; entra na chave de cache |
| `OCR_MAX_BYTES` | função | `5242880` |

---

## 4. Ambiente local

Ferramentas exigidas: Docker (GATE-01), Supabase CLI, Deno, Node 20+, Hurl, `jq`.

Fluxo local padrão:

| Objetivo | Comando |
|---|---|
| Inicializar projeto | `supabase init` |
| Subir stack local | `supabase start` |
| Aplicar migrações do zero | `supabase db reset` |
| Servir funções | `supabase functions serve --env-file supabase/.env.local` |
| Rodar pgTAP | `supabase test db` |
| Aplicar em remoto | `supabase db push --project-ref <ref>` |

`supabase db reset` recria o banco e roda o seed — é o comando usado antes de qualquer execução de determinismo.

---

## 5. Schema — especificação de migrações

Onze migrações, nesta ordem. Tipos são obrigatórios; nomes de coluna são obrigatórios.

### 0001_extensions.sql
Habilitar: `pgcrypto`, `vector`, `pgmq`, `pg_cron`, `pgtap`.

### 0002_profiles.sql

| Coluna | Tipo | Restrições |
|---|---|---|
| `id` | `uuid` | PK, FK → `auth.users(id)` ON DELETE CASCADE |
| `email` | `text` | NOT NULL |
| `display_name` | `text` | NOT NULL, DEFAULT `''` |
| `biometric_enabled` | `boolean` | NOT NULL, DEFAULT `false` |
| `persona` | `text` | NOT NULL, DEFAULT `'empatico'`, CHECK IN (`analitico`,`empatico`,`socratico`) |
| `server_revision` | `bigint` | NOT NULL, DEFAULT `0` |
| `created_at` | `timestamptz` | NOT NULL, DEFAULT `now()` |
| `updated_at` | `timestamptz` | NOT NULL, DEFAULT `now()` |

Trigger `on_auth_user_created`: cria a linha em `profiles` quando surge um `auth.users`, copiando o e-mail.

### 0003_entries.sql

| Coluna | Tipo | Restrições |
|---|---|---|
| `id` | `uuid` | PK, DEFAULT `gen_random_uuid()` |
| `user_id` | `uuid` | NOT NULL, FK → `profiles(id)` ON DELETE CASCADE |
| `content` | `text` | NOT NULL, CHECK `length(content) BETWEEN 1 AND 20000` |
| `source` | `text` | NOT NULL, CHECK IN (`manual`,`audio`,`photo`,`chat`) |
| `chat_message_id` | `uuid` | NULL, FK → `chat_messages(id)` ON DELETE SET NULL |
| `occurred_at` | `timestamptz` | NOT NULL, DEFAULT `now()` |
| `embedding` | `vector(1024)` | NULL |
| `embedding_model` | `text` | NULL |
| `embedding_dim` | `integer` | NULL |
| `embedding_input_type` | `text` | NULL |
| `embedding_status` | `text` | NOT NULL, DEFAULT `'pending'`, CHECK IN (`pending`,`ready`,`failed`) |
| `pii_status` | `text` | NOT NULL, DEFAULT `'pending'`, CHECK IN (`pending`,`clean`,`flagged`,`failed`) |
| `pii_spans` | `jsonb` | NOT NULL, DEFAULT `'[]'::jsonb` |
| `media_duration_seconds` | `integer` | NULL |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL, DEFAULT `now()` |

**CHECK de coerência:** `(source = 'chat') = (chat_message_id IS NOT NULL)`.

**Índices:**
- `entries_user_occurred_idx` sobre `(user_id, occurred_at DESC, id ASC)`
- `entries_chat_message_uniq` — **UNIQUE parcial** sobre `(user_id, chat_message_id)` WHERE `chat_message_id IS NOT NULL`

**Trigger `bump_server_revision`:** após INSERT ou UPDATE em `entries`, incrementa `profiles.server_revision` do dono.

*Nota de ordem:* `entries` referencia `chat_messages`, criada em 0005. A FK entra como migração separada em 0006, ou `chat_messages` é criada antes. **Decisão: criar `chat_sessions` e `chat_messages` em 0003, e `entries` em 0004.** Renumerar conforme.

### tags e entry_tags

`tags`: `id` uuid PK · `user_id` uuid NOT NULL FK · `name` text NOT NULL · `created_at`. UNIQUE sobre `(user_id, lower(name))`.

`entry_tags`: `entry_id` uuid FK ON DELETE CASCADE · `tag_id` uuid FK ON DELETE CASCADE · `user_id` uuid NOT NULL. PK composta `(entry_id, tag_id)`.

Populadas apenas pelo seed. Nenhum endpoint escreve.

### chat_sessions

| Coluna | Tipo | Restrições |
|---|---|---|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | NOT NULL, FK |
| `title` | `text` | NOT NULL, DEFAULT `''` |
| `persona_snapshot` | `text` | NOT NULL, CHECK igual ao de `profiles.persona` |
| `user_message_count` | `integer` | NOT NULL, DEFAULT `0` |
| `last_user_message_at` | `timestamptz` | NULL |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL |

### chat_messages

| Coluna | Tipo | Restrições |
|---|---|---|
| `id` | `uuid` | PK |
| `session_id` | `uuid` | NOT NULL, FK ON DELETE CASCADE |
| `user_id` | `uuid` | NOT NULL — denormalizado para RLS sem join |
| `role` | `text` | NOT NULL, CHECK IN (`user`,`assistant`) |
| `content` | `text` | NOT NULL, DEFAULT `''` |
| `seq` | `integer` | NOT NULL |
| `status` | `text` | NOT NULL, DEFAULT `'complete'`, CHECK IN (`streaming`,`complete`,`failed`) |
| `retry_count` | `integer` | NOT NULL, DEFAULT `0` |
| `created_at` | `timestamptz` | NOT NULL |

UNIQUE sobre `(session_id, seq)`.

**Trigger:** após INSERT com `role='user'`, incrementa `user_message_count` e atualiza `last_user_message_at` na sessão.

### insights

| Coluna | Tipo | Restrições |
|---|---|---|
| `id` | `uuid` | PK |
| `session_id` | `uuid` | NOT NULL, FK ON DELETE CASCADE |
| `user_id` | `uuid` | NOT NULL |
| `trigger_type` | `text` | NOT NULL, CHECK IN (`message_count`,`inactivity`) |
| `trigger_key` | `text` | NOT NULL |
| `status` | `text` | NOT NULL, CHECK IN (`generating`,`ready`,`failed`,`dismissed`) |
| `content` | `text` | NULL |
| `error_code` | `text` | NULL |
| `dismissed_at` | `timestamptz` | NULL |
| `created_at` | `timestamptz` | NOT NULL |

**UNIQUE sobre `(session_id, trigger_type, trigger_key)`** — é o coração do RF08.

### export_jobs

| Coluna | Tipo | Restrições |
|---|---|---|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | NOT NULL, FK |
| `period_start` | `timestamptz` | NULL — nulo significa "todo o período" |
| `period_end` | `timestamptz` | NULL |
| `status` | `text` | NOT NULL, CHECK IN (`pending`,`processing`,`data_ready`,`done`,`error`) |
| `narrative_status` | `text` | NOT NULL, CHECK IN (`pending`,`processing`,`done`,`failed`,`skipped`) |
| `entry_count` | `integer` | NULL |
| `raw_file_path` | `text` | NULL |
| `pdf_file_path` | `text` | NULL |
| `error_code` | `text` | NULL |
| `narrative_error_code` | `text` | NULL |
| `created_at` / `updated_at` / `completed_at` | `timestamptz` | — |

### schema `experiment`

Fora do alcance da RLS de usuário. Acesso apenas por `service_role`.

`ai_replay_cache`: `cache_key` text PK · `operation` text · `provider` text · `model` text · `prompt_version` text · `request_envelope` jsonb · `response` jsonb · `hit_count` integer DEFAULT 0 · `created_at`.

`fault_injection_log`: `id` uuid PK · `request_id` text · `endpoint` text · `fault_type` text · `injected_at` timestamptz.

### RLS

Para **todas** as tabelas com `user_id` (`profiles` usa `id`):

- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
- `ALTER TABLE ... FORCE ROW LEVEL SECURITY`
- Uma política por operação (SELECT, INSERT, UPDATE, DELETE) com predicado `auth.uid() = user_id`
- `REVOKE ALL ... FROM anon`
- Tabelas do schema `experiment`: sem acesso para `anon` nem `authenticated`

### Storage

Um bucket privado: `exports`. Política: o caminho do objeto começa com o `user_id` do requisitante. **Nenhum bucket de imagens** (D17).

---

## 6. Seed

Arquivo `supabase/seed/seed.sql`, idempotente (executável várias vezes sem duplicar).

### 6.1 Âncora de data

Todas as datas do seed são calculadas **relativas a uma âncora fixa**, nunca absolutas:

```
ANCORA = 2026-09-23T09:41:00Z
```

Documentar em `supabase/seed/ancora.md`. Entradas usam deslocamentos negativos (`ANCORA - 1 day`, `ANCORA - 12 days`). Isso mantém o seed determinístico independentemente de quando for executado.

### 6.2 As três contas

| Conta | E-mail | Conteúdo | Serve a |
|---|---|---|---|
| A | `cenario-cheio@cerne.test` | 34 entradas, 4 tags aplicadas, 3 sessões de chat, os 3 pares semânticos | RF06, RF07, RF09 (>30), RF05 |
| B | `cenario-uma@cerne.test` | 1 entrada, sem tags, sem chat | RF09 (uma entrada) |
| C | `cenario-vazio@cerne.test` | Nenhuma entrada | RF06 (estado vazio), RF09 (zero), RF05 (período vazio) |

Senha única para as três: definida em `TEST_ACCOUNT_PASSWORD`.

### 6.3 Distribuição da conta A

- 34 entradas distribuídas em 10 dias distintos a partir da âncora
- Origens: 14 `manual`, 8 `audio`, 6 `photo`, 6 `chat`
- Todas com `embedding_status='ready'` — o seed **gera os embeddings de verdade** via Voyage na primeira execução e os grava; execuções seguintes reaproveitam
- Ao menos uma entrada com `embedding_status='failed'` e uma com `pii_status='flagged'`, para os estados de UI existirem

### 6.4 Os três pares semânticos

Definidos **antes** do teste. Regra de aceite: **pelo menos um dos três precisa passar** para o critério do RF06 ser considerado satisfeito.

| Par | Termo buscado | Entrada plantada (não contém o termo) |
|---|---|---|
| 1 | `ansiedade` | Texto sobre nervosismo antes de uma apresentação |
| 2 | `cansaço` | Texto sobre exaustão ao fim da semana |
| 3 | `gratidão` | Texto sobre reconhecer coisas boas do dia |

Textos completos em `fixtures/pares_semanticos.md` (GATE-09).

### 6.5 Sessões de chat da conta A

Três sessões, com títulos e mensagens fixos. Uma delas com exatamente 4 mensagens do usuário — assim o passo 3.2 do roteiro atinge a quinta e dispara o gatilho N=5 de forma previsível.

---

## 7. Camada compartilhada

Diretório `supabase/functions/_shared/`. Módulos e responsabilidades. **Nenhum endpoint reimplementa nada daqui.**

| Módulo | Responsabilidade |
|---|---|
| `gateway` | Ponto de entrada único. Ordem obrigatória: gerar/ecoar `X-Request-Id` → validar `X-Test-Key` → aplicar `X-Test-Now` → aplicar `X-Test-Fault` → autenticar → validar corpo com Zod → executar handler → serializar → tratar exceção |
| `errors` | Os 13 códigos, mapeamento para HTTP e `retryable`. Função única de lançamento de erro |
| `contracts` | Schemas Zod de request e response de todos os endpoints. Fonte única do OpenAPI |
| `serialize` | Conversão `snake_case` ↔ `camelCase` e montagem do envelope |
| `clock` | `now()` que respeita `X-Test-Now` |
| `db` | Cliente Supabase com o JWT do usuário (nunca `service_role`) |
| `ai/anthropic` | Cliente Sonnet 5 e Haiku 4.5, sempre atrás do cache |
| `ai/voyage` | Cliente de embeddings, sempre atrás do cache |
| `replay` | Impressão digital, consulta, gravação, modos (Seção 9) |
| `prompts` | **Toda** montagem de prompt. Versionada por `PROMPT_VERSION` (D5) |
| `rag` | Recuperação de entradas relacionadas, com ordenação determinística |
| `faults` | Interpretação de `X-Test-Fault` e registro em log (Seção 10) |
| `sse` | Emissão de eventos no formato fixo da D12 |

**Regra crítica de ordem no gateway:** a injeção de falha é aplicada **antes** da autenticação para o tipo `offline` e **depois** para os demais. Um `offline` simulado precisa cortar a conexão sem nem processar o token.

---

## 8. Contratos dos 23 endpoints

Notação: campos em `camelCase`. Todos os erros seguem o envelope da Seção 3.2.

### 8.1 Autenticação (5)

| Rota | Método | Corpo | Resposta | Nota |
|---|---|---|---|---|
| `/auth/signup` | POST | `email`, `password` | `session`, `user` | Proxy fino do GoTrue |
| `/auth/login` | POST | `email`, `password` | `session`, `user` | Proxy fino |
| `/auth/refresh` | POST | `refreshToken` | `session` | Proxy fino |
| `/auth/session` | GET | — | `user`, `expiresAt`, `serverRevision` | Único com lógica própria |
| `/auth/logout` | POST | — | `ok: true` | Proxy fino |

### 8.2 Entradas (5)

**`POST /entries`**

Request: `content` (1–20000), `source` (enum), `chatMessageId` (uuid, opcional), `occurredAt` (ISO, opcional), `mediaDurationSeconds` (int, opcional).
Refinamento Zod: `source === 'chat'` ⟺ `chatMessageId` presente.

Sequência obrigatória do handler:
1. Validar
2. Se `chatMessageId` presente, tentar inserir com tratamento de conflito no índice único
3. Se houve conflito → retornar **200** com a entrada existente e `meta.idempotentReplay = true`. **Encerrar.**
4. Detecção de PII via Haiku com *tool use* estruturado. Falha aqui → `PII_CHECK_FAILED`, **nada é gravado**
5. Gravar a entrada com `embedding_status='pending'`
6. Gerar embedding via Voyage. Sucesso → `ready`. Falha → `failed`, **mas a entrada permanece**
7. Retornar 200

Response: `id`, `content`, `source`, `chatMessageId`, `occurredAt`, `tags[]`, `piiStatus`, `piiSpans`, `embeddingStatus`, `mediaDurationSeconds`, `serverRevision`, `createdAt`, `updatedAt`.

**`GET /entries`**
Query: `cursor`, `limit` (≤50, default 20), `source`, `dateFrom`, `dateTo`.
Response: `data: Entry[]` com **`tags` embutidas**, `meta: { nextCursor, total }`, header `X-Data-Version`.
Ordenação: `occurred_at DESC, id ASC`.

**`GET /entries/:id`** — objeto `Entry`. Se não existir ou for de outro usuário: 404 `NOT_FOUND`.

**`GET /entries/search`**
Query: `q`, `source`, `dateFrom`, `dateTo`, `limit` (≤50).
- `q` ausente ou vazio → apenas filtros, `meta.mode = 'filter_only'`, **sem chamar Voyage**
- `q` presente → embedding da query com `input_type='query'`, filtros aplicados no `WHERE` **antes** do ranqueamento, `meta.mode = 'semantic'`
- Filtros combinam com **AND**
- Response inclui `similarity` por item
- Ordenação: similaridade DESC, `id ASC`
- **Sem throttle no servidor** — o debounce de 300ms é do cliente

**`POST /media/ocr`**
Request: `image` (base64), `mimeType` (`image/jpeg`|`image/png`|`image/webp`).
- Acima de `OCR_MAX_BYTES` decodificados → 413 `PAYLOAD_TOO_LARGE`
- Sem texto encontrado → `OCR_NO_TEXT`
- Response: `text`, `confidence` (`high`|`low`)
- **A imagem não é gravada em lugar nenhum.** No `request_envelope` do cache entra apenas o SHA-256 dela

### 8.3 Chat (6)

**`POST /chat/sessions`** — corpo opcional `title`. Grava `persona_snapshot` a partir do perfil. Se `title` ausente, fica vazio e é preenchido pelo servidor na primeira mensagem.

**`GET /chat/sessions`** — lista com `cursor`, `limit`. Ordenação `updated_at DESC, id ASC`.

**`GET /chat/sessions/:id/messages`** — ordenação `seq ASC`.

**`POST /chat/sessions/:id/messages`** — resposta **SSE**.

Request: `content` (1–8000).

Sequência do handler:
1. Gravar a mensagem do usuário com o próximo `seq`
2. Gerar embedding da pergunta e executar RAG (top 5, ordenação determinística)
3. Criar a mensagem do assistente com `status='streaming'` e `content=''`
4. Emitir `message_created` com `userMessageId`, `assistantMessageId`, `seq`
5. Emitir `context` com `retrievedEntryIds` ordenados
6. Montar o prompt **no servidor** (D5) e chamar Sonnet 5 atrás do cache
7. Emitir `token` a cada pedaço, acumulando no banco
8. Emitir `done` e marcar `status='complete'`
9. Em falha: emitir `error` e marcar `status='failed'`, **preservando o texto parcial**

Formato dos eventos — fixo, nesta ordem:

| Evento | Payload |
|---|---|
| `message_created` | `userMessageId`, `assistantMessageId`, `seq` |
| `context` | `retrievedEntryIds: uuid[]` |
| `token` | `text` (n vezes) |
| `done` | `assistantMessageId`, `finishReason` |
| `error` | `code`, `message`, `retryable` |

Job de `pg_cron`: marcar como `failed` mensagens em `streaming` há mais de 60 segundos.

**`POST /chat/sessions/:id/messages/:userMessageId/retry`** — resposta SSE.
- Corpo vazio
- Validar que `:userMessageId` tem `role='user'` e é a última mensagem da sessão. Caso contrário: `VALIDATION_ERROR`
- Marcar a resposta anterior falhada como substituída
- Incrementar `retry_count`
- Reabrir o stream com **envelope de replay idêntico ao da primeira tentativa** — mesmo histórico, mesma pergunta, mesmo contexto RAG. Deve resultar em `X-Replay-Status: hit`

**`POST /chat/sessions/:id/insight`**
Request: `triggerType` (`message_count`|`inactivity`), `triggerKey` (string).
- Tentar inserir; conflito na UNIQUE → retornar **200** com o insight existente
- Gerar via Haiku atrás do cache
- Falha de geração → **HTTP 200** com `status='failed'` e `errorCode`. **Nunca erro HTTP** — o chat não pode quebrar

Cálculo de `triggerKey` (documentado, calculado pelo cliente):
- `message_count` → `floor(user_message_count / 5)` como string
- `inactivity` → o `id` da última mensagem do usuário

### 8.4 Exportação (3)

**`POST /export/summary`**
Request: `periodStart` (ISO ou null), `periodEnd` (ISO ou null), `includeNarrative` (bool, default true).
- Contar entradas do período **de forma síncrona**
- Zero entradas → `EXPORT_EMPTY_PERIOD`, **sem criar linha em `export_jobs`**
- Caso contrário → criar job, enfileirar em `pgmq`, retornar **202** com `jobId` e `status: 'pending'`

**`GET /export/:jobId/status`**
Response: `jobId`, `status`, `narrativeStatus`, `entryCount`, `errorCode`, `narrativeErrorCode`, **`downloadAvailable` já resolvido** pelo servidor.

`downloadAvailable = status IN ('data_ready','done')`.

**`GET /export/:jobId/download`**
Query: `format` (`pdf`|`raw`, default `pdf` com fallback para `raw`).
- 302 para URL assinada do Storage
- Responde com sucesso sempre que `downloadAvailable` — falha de narrativa **nunca** produz 4xx/5xx aqui

**Worker da fila:** consome de `pgmq`, coleta as entradas, grava o arquivo bruto, marca `status='data_ready'`, então tenta a narrativa. Sucesso → gera PDF e marca `done`. Falha → `narrative_status='failed'`, `status` permanece `data_ready`.

### 8.5 Dashboard (2)

**`GET /dashboard/aggregate`**
Query: `period` (`7d`|`30d`|`90d`|`all`).
Response: `buckets: [{ date, count, sources }]`, `totals`. Header `X-Data-Version` derivado de `server_revision`.
**Sempre 200**, inclusive com zero entradas (`buckets: []`).

**`GET /dashboard/narrative`**
Query: `period`.
Response: `text`, `generatedAt`. Falha → `AI_GENERATION_TIMEOUT`.
**Independente do agregado** — a falha aqui não afeta o endpoint anterior.

### 8.6 Conta (2)

**`PATCH /account/settings`**
Request: `displayName` (1–80, opcional), `persona` (enum, opcional), `biometricEnabled` (bool, opcional).
**Campo `email` presente → `VALIDATION_ERROR`.**

**`DELETE /account`**
Request: `confirmation` com valor literal `"DELETE"`.
Apagamento **hard**, em cascata, mais purga dos objetos do bucket `exports` do usuário. Nenhuma linha órfã em nenhuma tabela.

### 8.7 Taxonomia — 13 códigos

| Código | HTTP | `retryable` |
|---|---|---|
| `AUTH_EXPIRED` | 401 | não |
| `AUTH_INVALID` | 401 | não |
| `NETWORK_TIMEOUT` | 504 | sim |
| `NETWORK_OFFLINE` | — (conexão cortada) | sim |
| `VALIDATION_ERROR` | 400 | não |
| `PII_CHECK_FAILED` | 502 | sim |
| `EMBEDDING_FAILED` | 502 | sim |
| `AI_GENERATION_TIMEOUT` | 504 | sim |
| `NOT_FOUND` | 404 | não |
| `RATE_LIMITED` | 429 | sim |
| `EXPORT_EMPTY_PERIOD` | 400 | não |
| `PAYLOAD_TOO_LARGE` | 413 | não |
| `OCR_NO_TEXT` | 400 | não |

`RATE_LIMITED` **nunca é emitido por lógica real** — apenas por injeção de falha.

### 8.8 OpenAPI

Gerado a partir dos schemas Zod por script (`scripts/gen-openapi.ts`), gravado em `contracts/openapi.yaml`. O CI regenera e compara; **divergência quebra o build**.

---

## 9. Cache de replay

### 9.1 Envelope canônico

Antes de qualquer chamada a Anthropic ou Voyage, montar um objeto com **chaves ordenadas alfabeticamente** e serialização JSON estável:

```
{ operation, provider, model, promptVersion, personaSnapshot, input }
```

`cache_key = sha256(json_canonico)`, em hexadecimal.

### 9.2 Normalização de `input` por operação

| `operation` | Conteúdo de `input` |
|---|---|
| `chat` | `historySeqs[]`, `historyHash`, `userMessage`, `retrievedEntryIds[]` |
| `insight` | `sessionId`, `triggerType`, `triggerKey`, `historyHash` |
| `pii` | `text` |
| `ocr` | `imageSha256`, `mimeType` |
| `embedding` | `text`, `inputType` |
| `narrative` | `period`, `entryIdsHash` |
| `dashboard` | `period`, `entryIdsHash` |

`historyHash` = SHA-256 da concatenação de `role + ':' + content` de todas as mensagens da sessão, em ordem de `seq`.

**`retrievedEntryIds` deve estar ordenado** antes de entrar no envelope — ordem instável quebraria a chave.

### 9.3 Modos

| `REPLAY_MODE` | Comportamento em hit | Comportamento em miss |
|---|---|---|
| `off` | — | Chama o provedor, não grava |
| `record` | Serve do cache, `hit_count++` | Chama o provedor e **grava** |
| `replay` | Serve do cache, `hit_count++` | Chama o provedor e grava |
| `replay_strict` | Serve do cache, `hit_count++` | **Lança erro `REPLAY_MISS`** e registra |

Header `X-Replay-Status` sempre presente: `hit`, `miss` ou `off`.

`REPLAY_MISS` **não** está na taxonomia de 13 códigos — é erro de infraestrutura de experimento, retorna HTTP 500 e só ocorre em `replay_strict`. Nunca chega ao aplicativo em uso normal.

### 9.4 Streaming e cache

Respostas de chat são armazenadas **completas** no cache. Em hit, o servidor **reemite** os eventos SSE a partir do texto guardado, fatiando em pedaços de tamanho fixo (32 caracteres) com intervalo de 15ms. Isso mantém a experiência de streaming e o determinismo do conteúdo final.

---

## 10. Injeção de falha

### 10.1 Ativação

Só age quando `X-Test-Key` coincide com `TEST_FAULT_KEY`. Sem coincidência, os cabeçalhos `X-Test-Fault` e `X-Test-Now` são **ignorados em silêncio** — nunca rejeitados com erro.

### 10.2 Tipos

| Valor | Efeito | Cobre |
|---|---|---|
| `timeout` | Aguarda 35s e retorna `NETWORK_TIMEOUT` (504) | RNF09 tipo 1 |
| `malformed` | Retorna 200 com corpo JSON estruturalmente inválido para o schema | RNF09 tipo 2 |
| `offline` | Encerra a conexão sem resposta | RNF09 tipo 3 |
| `ai_timeout` | Falha **apenas** a chamada de IA; o resto do endpoint funciona | RF05, RF08, RF09 |
| `slow:<ms>` | Atrasa a resposta pelo tempo informado | RNF01 |
| `rate_limited` | Retorna `RATE_LIMITED` (429) | Taxonomia |

Toda injeção grava linha em `experiment.fault_injection_log`.

### 10.3 Os 15 cenários

Cinco endpoints × três tipos (`timeout`, `malformed`, `offline`):

`POST /entries` · `POST /chat/sessions/:id/messages` · `POST /media/ocr` · `POST /export/summary` · `POST /chat/sessions/:id/insight`

**Lista congelada.** Não alterar.

---

## 11. Testes

### 11.1 pgTAP — `supabase/tests/`

Um arquivo por tabela com dono, mais um de constraints:

| Arquivo | Cobre |
|---|---|
| `rls_profiles.sql`, `rls_entries.sql`, `rls_tags.sql`, `rls_entry_tags.sql`, `rls_chat_sessions.sql`, `rls_chat_messages.sql`, `rls_insights.sql`, `rls_export_jobs.sql` | Isolamento positivo, isolamento negativo (**zero linhas**, não erro), escrita cruzada bloqueada, RLS forçada, `anon` sem leitura |
| `rls_experiment.sql` | `authenticated` e `anon` sem acesso ao schema `experiment` |
| `constraints.sql` | Índice de idempotência do RF10; UNIQUE de insight; CHECK de coerência `source`/`chat_message_id`; UNIQUE de `(session_id, seq)` |
| `cascade_delete.sql` | Apagar `auth.users` não deixa órfão em nenhuma das 8 tabelas |
| `triggers.sql` | `server_revision` incrementa; `user_message_count` incrementa |

Comando: `supabase test db`. **Meta: 100%.**

### 11.2 Hurl — `tests/hurl/`

Por endpoint: caminho feliz com validação de schema; corpo inválido → `VALIDATION_ERROR`; sem token → `AUTH_EXPIRED`; recurso de outro usuário → **404** `NOT_FOUND`.

Suítes específicas:

| Arquivo | Assertiva central |
|---|---|
| `idempotencia_rf10.hurl` | Dois POST com o mesmo `chatMessageId` → mesmo `id`, `total` inalterado, `meta.idempotentReplay=true` no segundo |
| `insight_unico.hurl` | Dois POST com o mesmo `triggerKey` → mesmo `id` |
| `insight_falha.hurl` | Com `ai_timeout` → **HTTP 200**, `status='failed'` |
| `export_resiliente.hurl` | Com `ai_timeout` → `narrativeStatus='failed'` **e** `downloadAvailable=true`; download responde 302 |
| `export_vazio.hurl` | Período vazio → `EXPORT_EMPTY_PERIOD` e **zero linhas** em `export_jobs` |
| `retry_chat.hurl` | Retry → `X-Replay-Status: hit` e `retry_count=1` |
| `tags_embutidas.hurl` | `GET /entries` traz `tags[]` populado |
| `dashboard_degradado.hurl` | Com `ai_timeout` na narrativa, o agregado continua 200 |
| `busca_and.hurl` | Dois filtros restringem com AND |
| `busca_semantica.hurl` | Buscar `ansiedade` retorna a entrada plantada do par 1 |
| `sse_ordem.hurl` | Eventos na ordem `message_created → context → token* → done` |
| `falhas_15.hurl` | Os 15 cenários, cada um com código e `retryable` corretos |
| `email_readonly.hurl` | `PATCH /account/settings` com `email` → `VALIDATION_ERROR` |

### 11.3 Teste de determinismo — `tests/determinism/`

Script que:
1. Executa `supabase db reset` (banco limpo + seed)
2. Roda o roteiro de validação com `REPLAY_MODE=replay_strict`, gravando todas as respostas
3. Repete os passos 1 e 2
4. Normaliza: remove `requestId`, timestamps e UUIDs gerados
5. **Compara byte a byte.** Qualquer diferença falha o build

É o gate mais importante do CI.

### 11.4 GitHub Actions

Cinco jobs em `.github/workflows/`:

| Job | Faz | Depende de |
|---|---|---|
| `db` | `supabase start` → migrações → seed → `supabase test db` | — |
| `contracts` | Gera OpenAPI do Zod → `git diff --exit-code contracts/openapi.yaml` | — |
| `api` | Sobe funções local → suíte Hurl completa | `db` |
| `determinism` | Roteiro × 2 em `replay_strict` → diff | `db`, `api` |
| `freeze` | Só em tag `backend-v1.0-frozen`: valida o checklist da Seção 12 | todos |

---

## 12. Procedimento de congelamento

Executar em ordem, na Fase 7.

1. `supabase db reset` no `dev` — confirmar que migrações + seed rodam do zero
2. Aplicar migrações em `ciclo-a` e `ciclo-b`
3. Gerar hash do schema dos três ambientes e **confirmar que são idênticos**
4. `supabase test db` nos três — 100% verde
5. Suíte Hurl completa contra `ciclo-a` e `ciclo-b`
6. Executar o roteiro em `record` no `ciclo-a`; exportar o cache; **importar o mesmo cache no `ciclo-b`**
7. Reexecutar o roteiro em `replay_strict` nos dois — zero `REPLAY_MISS`
8. Job `determinism` verde
9. Conferir `fault_injection_log`: os 15 cenários registrados
10. Montar `docs/handoff/` (Seção 10 do plano v4)
11. `[GATE-11]` Criar tag `backend-v1.0-frozen`, proteger o ramo, publicar o repositório de handoff

**O passo 6 é crítico e fácil de errar:** o cache é gravado uma vez e **copiado** para o outro ambiente. Gravar duas vezes produziria respostas de IA diferentes nos dois ciclos, anulando todo o mecanismo.

### Checklist final

- [ ] Hash de schema idêntico nos três ambientes
- [ ] pgTAP 100% nos três
- [ ] Hurl 100% em `ciclo-a` e `ciclo-b`
- [ ] `openapi.yaml` sem drift
- [ ] Cache exportado do `ciclo-a` e importado no `ciclo-b`
- [ ] Zero `REPLAY_MISS` na reexecução
- [ ] Job `determinism` verde
- [ ] 15 cenários em `fault_injection_log`
- [ ] `docs/bugs_conhecidos.md` presente
- [ ] `docs/handoff/` completo, **sem o código-fonte do backend**
- [ ] Tag criada, ramo protegido
- [ ] Hash do protótipo registrado no documento de requisitos

---

## 13. Backlog ordenado

Cada tarefa: pré-requisito → o que fazer → critério de conclusão verificável.

### Fase 0 — Fundação

| ID | Tarefa | Critério de conclusão |
|---|---|---|
| `T-001` | `[GATE-01]` Docker instalado e rodando | `docker ps` responde |
| `T-002` | `[GATE-02]` Três projetos Supabase criados | Três `project ref` anotados |
| `T-003` | `[GATE-03]` `supabase login` | `supabase projects list` lista os três |
| `T-004` | `[GATE-04]` Chave Anthropic + teto | Chamada de teste ao Haiku responde |
| `T-005` | `[GATE-05]` Chave Voyage + teto | Chamada retorna vetor de **1024** floats |
| `T-006` | `[GATE-06]` Repositório GitHub privado | `git remote -v` aponta para ele |
| `T-007` | Estrutura de diretórios da Seção 2 | `tree` bate com a especificação |
| `T-008` | `[GATE-07]` Secrets no GitHub Actions | Workflow vazio passa verde |
| `T-009` | `supabase init` + `config.toml` | `supabase start` sobe sem erro |
| `T-010` | `docs/bugs_conhecidos.md` vazio criado | Arquivo existe e está versionado |

### Fase 1 — Banco e segurança

| ID | Tarefa | Critério de conclusão |
|---|---|---|
| `T-011` | Migração de extensões | `supabase db reset` sem erro |
| `T-012` | `profiles` + trigger de criação | Cadastro cria linha em `profiles` |
| `T-013` | `chat_sessions` e `chat_messages` + triggers | `user_message_count` incrementa |
| `T-014` | `entries` + índices + trigger de `server_revision` | Índice de idempotência existe |
| `T-015` | `tags` e `entry_tags` | — |
| `T-016` | `insights` com a UNIQUE | Insert duplicado é recusado |
| `T-017` | `export_jobs` com os dois status | — |
| `T-018` | Schema `experiment` + duas tabelas | `authenticated` sem acesso |
| `T-019` | Políticas de RLS em todas as tabelas | `supabase test db` verde |
| `T-020` | `[GATE-08]` Fixtures de mídia | Três arquivos em `fixtures/media/` |
| `T-021` | `[GATE-09]` Textos e pares semânticos aprovados | `fixtures/textos.json` e `pares_semanticos.md` |
| `T-022` | `seed.sql` com as três contas e a âncora | `supabase db reset` carrega 34+1+0 entradas |
| `T-023` | Suíte pgTAP completa | `supabase test db` 100% |
| `T-024` | **Prova do RF06** | Busca por `ansiedade` no seed encontra o par 1 (ou 2 ou 3) |

> **Se `T-024` falhar nos três pares, parar e reportar.** É condição de viabilidade do RF06, não um detalhe.

### Fase 2 — Contratos e gateway

| ID | Tarefa | Critério de conclusão |
|---|---|---|
| `T-025` | Módulo `errors` com os 13 códigos | Teste unitário do mapeamento HTTP |
| `T-026` | Módulo `contracts` — Zod dos 23 endpoints | Todos os schemas compilam |
| `T-027` | Módulo `serialize` | Teste de ida e volta snake↔camel |
| `T-028` | Módulo `clock` respeitando `X-Test-Now` | Teste com relógio congelado |
| `T-029` | Módulo `faults` + tabela de log | Os 6 tipos disparam e registram |
| `T-030` | Módulo `replay` com os 4 modos | Mesmo input → mesma `cache_key` |
| `T-031` | Módulo `gateway` na ordem obrigatória | Requisição sem token → `AUTH_EXPIRED` |
| `T-032` | Clientes `ai/anthropic` e `ai/voyage` atrás do cache | Segunda chamada idêntica → `hit` |
| `T-033` | `scripts/gen-openapi.ts` + `openapi.yaml` | Job `contracts` verde |

> **Ponto de decisão do cronograma.** Se a Fase 2 não fechar em 09/09, cortar o RF05 — remove `pgmq`, `pg_cron`, Storage, PDF e três endpoints.

### Fase 3 — Entradas

| ID | Tarefa | Critério de conclusão |
|---|---|---|
| `T-034` | 5 endpoints de autenticação | Hurl do bloco verde |
| `T-035` | `POST /entries` com a sequência da Seção 8.2 | `idempotencia_rf10.hurl` verde |
| `T-036` | Detecção de PII com tool use | Entrada com nome → `pii_status='flagged'`, `content` intacto |
| `T-037` | Geração de embedding com fallback | Voyage forçada a falhar → entrada existe com `embedding_status='failed'` |
| `T-038` | `GET /entries` com tags embutidas | `tags_embutidas.hurl` verde |
| `T-039` | `GET /entries/:id` | Recurso de outro usuário → 404 |
| `T-040` | `GET /entries/search` | `busca_and.hurl` e `busca_semantica.hurl` verdes |
| `T-041` | `POST /media/ocr` | Imagem grande → 413; ilegível → `OCR_NO_TEXT` |

### Fase 4 — Chat

| ID | Tarefa | Critério de conclusão |
|---|---|---|
| `T-042` | Módulo `prompts` versionado | `PROMPT_VERSION` entra na `cache_key` |
| `T-043` | Módulo `rag` com ordenação determinística | Mesma pergunta → mesmos `retrievedEntryIds`, mesma ordem |
| `T-044` | Módulo `sse` no formato da D12 | `sse_ordem.hurl` verde |
| `T-045` | `POST /chat/sessions` e os dois GET | Criação implícita funciona |
| `T-046` | `POST .../messages` com streaming | Queda no meio preserva parcial com `status='failed'` |
| `T-047` | Reemissão de SSE a partir do cache | Hit produz a mesma sequência de eventos |
| `T-048` | `POST .../retry` | `retry_chat.hurl` verde — `hit` e `retry_count=1` |
| `T-049` | Job `pg_cron` de streams abandonados | Mensagem parada 60s vira `failed` |
| `T-050` | `POST .../insight` com os dois gatilhos | `insight_unico.hurl` e `insight_falha.hurl` verdes |

### Fase 5 — Exportação, dashboard, conta

| ID | Tarefa | Critério de conclusão |
|---|---|---|
| `T-051` | Fila `pgmq` + consumidor `pg_cron` | Job muda de estado sozinho |
| `T-052` | Bucket `exports` + política | Usuário não lê arquivo de outro |
| `T-053` | `POST /export/summary` | `export_vazio.hurl` verde, zero linhas criadas |
| `T-054` | Worker de exportação com os dois status | `export_resiliente.hurl` verde |
| `T-055` | `GET /export/:jobId/status` e `/download` | Download 302 mesmo com narrativa falhada |
| `T-056` | `GET /dashboard/aggregate` | Três cenários (0/1/>30) respondem 200 |
| `T-057` | `GET /dashboard/narrative` | `dashboard_degradado.hurl` verde |
| `T-058` | `PATCH /account/settings` | `email_readonly.hurl` verde |
| `T-059` | `DELETE /account` | `cascade_delete.sql` verde + bucket purgado |

### Fase 6 — Reprodutibilidade

| ID | Tarefa | Critério de conclusão |
|---|---|---|
| `T-060` | `[GATE-10]` Roteiro executado em `record` | Cache populado; taxa de hit reportada |
| `T-061` | Script de export/import do cache | Cache do `ciclo-a` importado no `ciclo-b` |
| `T-062` | Job `determinism` no CI | Duas execuções idênticas |
| `T-063` | Os 15 cenários evidenciados | `fault_injection_log` com 15 linhas distintas |

### Fase 7 — Congelamento

| ID | Tarefa | Critério de conclusão |
|---|---|---|
| `T-064` | Procedimento da Seção 12, passos 1–10 | Checklist final completo |
| `T-065` | `[GATE-11]` Tag e repositório de handoff | Tag criada, ramo protegido, handoff publicado |

---

## 14. Erros comuns a evitar

Lista de armadilhas específicas deste projeto, para o agente conferir antes de dar uma tarefa por concluída.

| Armadilha | Por que importa |
|---|---|
| Usar `service_role` num endpoint de aplicativo | Contorna toda a RLS; invalida o RNF04 |
| Retornar 403 em recurso de outro usuário | Vaza existência; contradiz D7 |
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

*Especificação técnica v1.0 — 31/08/2026. Derivada de `Plano_Backend_Cerne_v4.md`. Nenhuma decisão nova foi tomada aqui.*
