# Documentação técnica — backend Cerne

> Versão direta, para dev backend experiente. A versão explicativa do mesmo
> conteúdo está em [`DOCUMENTACAO_DIDATICA.md`](DOCUMENTACAO_DIDATICA.md).
> As divergências listadas na seção 15 têm proposta de correção em
> [`DIVERGENCIAS_E_INCONSISTENCIAS.md`](DIVERGENCIAS_E_INCONSISTENCIAS.md).

## Sumário

1. [Escopo, fontes e como ler](#1-escopo-fontes-e-como-ler)
2. [Visão geral da arquitetura](#2-visão-geral-da-arquitetura)
3. [Camada de contratos](#3-camada-de-contratos)
4. [Camada de gateway](#4-camada-de-gateway)
5. [Camada compartilhada, módulo a módulo](#5-camada-compartilhada-módulo-a-módulo)
6. [Camada de endpoints](#6-camada-de-endpoints)
7. [Camada de dados](#7-camada-de-dados)
8. [Segurança](#8-segurança)
9. [Regras de negócio implementadas](#9-regras-de-negócio-implementadas)
10. [Contratos de API](#10-contratos-de-api)
11. [Integrações externas](#11-integrações-externas)
12. [Testes](#12-testes)
13. [Scripts operacionais](#13-scripts-operacionais)
14. [Padrões e convenções de código](#14-padrões-e-convenções-de-código)
15. [Observações técnicas](#15-observações-técnicas)

---

## 1. Escopo, fontes e como ler

Este documento descreve **o que está implementado** no repositório `cerne-backend`,
lido diretamente do código-fonte. Onde o código diverge de um plano, especificação
ou documento de handoff, a divergência está registrada na seção 15 — nunca
"corrigida" na narrativa.

**Fonte da verdade deste documento:** a árvore de arquivos do repositório.
Referências aparecem como `caminho/arquivo.ts:linha` quando a linha importa.

**Convenção de nomenclatura das tarefas:** comentários no código citam `T-0NN`
(tarefa do backlog), `RF0N`/`RNF0N` (requisito funcional/não-funcional) e `D N`
(decisão de arquitetura). Este documento reaproveita essas âncoras onde elas
aparecem no código, sem reconstituir os documentos-fonte.

**Estado do repositório:** congelado na tag `backend-v1.0-frozen` (Fase 7).
A partir do congelamento, toda mudança entra por PR — inclusive documentação
(ver `CLAUDE.md` na raiz).

---

## 2. Visão geral da arquitetura

### 2.1 Stack e topologia de deploy

| Item | Escolha |
|---|---|
| Runtime | Deno 2 (Supabase Edge Functions) |
| Banco | Postgres 17 + `pgvector`, `pgcrypto`, `pgtap`, `pg_cron`, `pgmq`, `pg_net` |
| Auth | GoTrue (Supabase Auth) |
| Storage | Supabase Storage, bucket privado `exports` |
| Validação | Zod 3.23.8 (`deno.json`) |
| Cliente de banco | `@supabase/supabase-js` 2.45.4 via PostgREST |
| IA | Anthropic Messages API (Sonnet 5, Haiku 4.5) + Voyage AI (`voyage-4`, 1024d) |

**Topologia:** uma Edge Function por endpoint. O diretório
`supabase/functions/<nome>/` **é** a unidade de deploy — não existe roteador
central. Consequência prática: a URL real de invocação é
`{FUNCTIONS_BASE_URL}/<nome-do-diretório>/<params...>`, não o caminho REST
publicado no OpenAPI (ver seção 15, D-01).

24 diretórios de função = 23 endpoints de aplicativo + `export-worker`
(infraestrutura, fora do registro de contratos).

### 2.2 As camadas e o fluxo de uma requisição

```
   App Flutter
        │  HTTPS  {base}/<funcao>/<params>
        ▼
┌─────────────────────────────────────────────────────────────┐
│ supabase/functions/<endpoint>/index.ts                      │
│   fiação: lê env uma vez, extrai params da URL,             │
│           chama runGateway(req, contract, params, handler)   │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ _shared/gateway.ts — PONTO DE ENTRADA ÚNICO (9 passos)      │
│   X-Request-Id → test-mode → X-Test-Now → X-Test-Fault      │
│   → autenticar → validar Zod → handler → serializar → erro  │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ <endpoint>/handler.ts — REGRA DE NEGÓCIO                    │
│   orquestra repositórios + IA + serialização                │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ _shared/*-repo.ts  |  _shared/ai/*  |  _shared/replay.ts    │
│ acesso a dados     |  provedores    |  cache determinístico │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Postgres (RLS forçada) + Storage + GoTrue                   │
└─────────────────────────────────────────────────────────────┘
```

**Regra estrutural que atravessa todas as camadas:** o cliente de banco
carrega sempre o JWT do usuário da requisição (`_shared/db.ts`). `service_role`
existe num único módulo (`_shared/worker-db.ts`), importado por um único
consumidor (`export-worker`).

### 2.3 Os dois fluxos fora do ciclo síncrono

**(a) Streaming SSE — `chat.messages.send` e `chat.messages.retry`.**
O handler executa uma fase síncrona (validar sessão, gravar mensagem do
usuário, RAG, criar placeholder do assistente, decidir `X-Replay-Status`),
devolve `{ stream }` ao gateway e dispara `runChatTurnStream` em
fire-and-forget. Os bytes saem conforme o emitter produz eventos. Falha na
fase síncrona = resposta HTTP de erro normal; falha depois = evento SSE
`error` dentro do stream.

**(b) Fila de exportação — `export.summary.create` → `export-worker`.**
```
POST /export/summary        (síncrono: conta entradas, cria job, enfileira)
      │  export_enqueue()  → pgmq.send('export_jobs_queue')
      ▼
pg_cron '15 seconds' → export_dispatch_pending_jobs()
      │  pgmq.read(vt=60, qty=5) → net.http_post(.../export-worker)
      ▼
export-worker (service_role)
      │ entries → raw.json no Storage → status='data_ready'
      │ narrativa (Haiku, atrás do cache) → PDF → status='done'
      └ falha da narrativa → narrative_status='failed', status fica 'data_ready'
```

### 2.4 Mapa de diretórios

| Caminho | Conteúdo |
|---|---|
| `contracts/zod/` | Schemas Zod + registro dos 23 endpoints |
| `contracts/openapi.yaml` | **Gerado** a partir de `contracts/zod/` |
| `supabase/migrations/` | 20 migrações SQL (schema, RLS, RPC, fila, cron, storage) |
| `supabase/seed/` | Seed idempotente + `ancora.md` (âncora temporal) |
| `supabase/functions/_shared/` | Camada compartilhada (22 módulos + 2 em `ai/`) |
| `supabase/functions/<endpoint>/` | 23 endpoints + `export-worker` |
| `supabase/tests/` | 20 arquivos pgTAP |
| `tests/hurl/` | 27 suítes de contrato HTTP |
| `tests/determinism/` | Gate de determinismo (normalize/compare/run.sh) |
| `scripts/` | 11 ferramentas operacionais |
| `docs/handoff/` | Documentos **gerados** do pacote de handoff |
| `context/`, `plan/`, `ux/`, `fixtures/` | Insumos não-código |

---

## 3. Camada de contratos

### 3.1 Estrutura de `contracts/zod/` e convenções

| Arquivo | Conteúdo |
|---|---|
| `common.ts` | Primitivos (`uuidSchema`, `isoDateTimeSchema`), enums fechados, envelopes, paginação, `tagSchema`, `piiSpanSchema` |
| `auth.ts` | 5 endpoints de autenticação |
| `entries.ts` | 4 endpoints de entradas + `media.ocr` |
| `chat.ts` | 6 endpoints de chat + os 5 schemas de evento SSE |
| `export.ts` | 3 endpoints de exportação |
| `dashboard.ts` | 2 endpoints de dashboard |
| `account.ts` | 2 endpoints de conta |
| `registry.ts` | `ENDPOINTS`: o array dos 23 contratos |

**Convenções:**
- Campos JSON sempre `camelCase`, mesmo com coluna `snake_case` no banco. A
  conversão acontece **só** em `_shared/serialize.ts` (`contracts/zod/common.ts:12-14`).
- `errorCodeEnum` deriva de `ERROR_CODES` (`_shared/errors.ts`) em vez de
  redigitar os 13 códigos — uma segunda cópia divergiria em silêncio.
- Schemas de auth são propositalmente permissivos (`.catchall(z.unknown())`)
  porque 4 dos 5 endpoints são proxy fino do GoTrue (D1).
- `.strict()` é usado como mecanismo de regra: em
  `updateAccountSettingsRequestSchema`, é ele que implementa
  "campo `email` presente → `VALIDATION_ERROR`" sem checagem no handler.

### 3.2 `EndpointContract` e o registro dos 23 endpoints

```ts
interface EndpointContract {
  id: string;            // "entries.create"
  method: HttpMethod;    // GET | POST | PATCH | DELETE
  path: string;          // "/entries/:id" — notação do plano, não a URL real
  summary: string;
  auth: boolean;         // false só em signup/login/refresh
  requestBody?: ZodTypeAny;
  requestQuery?: ZodTypeAny;
  response: JsonResponse | SseResponse | RedirectResponse;
}
```

Três formas de resposta declaradas no tipo:
`{kind:"json", status, schema}` (21 endpoints), `{kind:"sse"}` (send/retry),
`{kind:"redirect"}` (download). O gateway ramifica sobre a forma do resultado
do handler, não sobre esse campo — ver 4.4.

Dois consumidores diretos: `_shared/gateway.ts` (valida body/query) e
`scripts/gen-openapi.ts` (gera o YAML).

### 3.3 Envelopes, primitivos e paginação por cursor

**Sucesso:** `{ data, meta? }`. **Erro:** `{ code, message, retryable, requestId }` —
mesmo schema para os 23 endpoints (`common.ts:47-52`).

**Paginação:** keyset, nunca OFFSET.
`cursorPaginationQuerySchema = { cursor?, limit? }`,
`cursorPaginationMetaSchema = { nextCursor: string|null, total?: number }`.
O cursor é base64url opaco de um JSON mínimo — `{o,i}` para entradas
(`occurred_at`,`id`), `{u,i}` para sessões (`updated_at`,`id`).

**Lacunas de contrato preenchidas no código, marcadas inline pelos autores:**
`tagSchema` (`{id,name}`), `piiSpanSchema` (`{start,end,type}`),
`sourceCountsSchema` do dashboard (as 4 chaves do enum `source`).

### 3.4 Geração do OpenAPI e o gate de CI

`scripts/gen-openapi.ts` itera `ENDPOINTS`, converte cada Zod para JSON Schema
(`scripts/openapi/zod-to-json-schema.ts`) e emite `contracts/openapi.yaml`.
Converte `:param` → `{param}`, monta `parameters` de path e query, e injeta
`responses.default` apontando para `#/components/schemas/Error` em todos.

O job `contracts` do CI roda `deno run -A scripts/gen-openapi.ts` seguido de
`git diff --exit-code contracts/openapi.yaml` — editar o YAML à mão quebra o
build. O arquivo gerado tem 1872 linhas e 20 `paths` (23 operações; `/entries`
e `/chat/sessions` têm GET+POST).

---

## 4. Camada de gateway

`supabase/functions/_shared/gateway.ts` (397 linhas). Ponto de entrada único
de todos os 23 endpoints. **Não roteia** — a extração de `:param` é do
`index.ts` de cada função.

### 4.1 Pipeline de 9 passos (ordem obrigatória)

| # | Passo | Implementação |
|---|---|---|
| 1 | `X-Request-Id` ecoado ou gerado | `req.headers.get("X-Request-Id") ?? crypto.randomUUID()` |
| 2 | Gate de modo de teste | `_shared/test-mode.ts` — não há passo de rejeição; chave errada = cabeçalhos ignorados em silêncio |
| 3 | `X-Test-Now` | `now(req, clockDeps)` — `_shared/clock.ts` |
| 4a | `X-Test-Fault`, parte `offline` | `applyFault(...)`; `offline` curto-circuita **antes** da autenticação |
| 5 | Autenticar | só se `contract.auth`; monta `AuthContext` |
| 4b | `X-Test-Fault`, outros 5 tipos | `applyNonOfflineFaultEffect` — log já foi gravado em 4a (nunca duas vezes) |
| 6 | Validar body e query com Zod | `parseBody` / `parseQuery` |
| 7 | Executar handler | `await handler(ctx)` |
| 8 | Serializar | três formas — ver 4.4 |
| 9 | Tratar exceção | `handleError` |

A numeração fora de ordem (4a antes de 5, 4b depois) é deliberada e está
documentada no próprio arquivo: "um offline simulado precisa cortar a conexão
sem nem processar o token".

**`GatewayContext` entregue ao handler:**
```ts
{ req, requestId, now: Date, params, body, query,
  auth: AuthContext | null, fault: ParsedFault | null }
```

**Efeito de cada fault (`gateway.ts:196-220`):**

| Tipo | Efeito |
|---|---|
| `offline` | `new Promise(() => {})` — nunca resolve, cliente nunca recebe bytes |
| `timeout` | espera `TIMEOUT_FAULT_DELAY_MS = 35_000`, devolve `NETWORK_TIMEOUT` (504) |
| `malformed` | HTTP 200 com `{__injected_fault__, note}` — fora de qualquer envelope, por desenho |
| `rate_limited` | `RATE_LIMITED` (429) |
| `slow:<ms>` | espera e **segue** para o handler |
| `ai_timeout` | não curto-circuita — chega ao handler via `ctx.fault` |

### 4.2 Autenticação e `AuthContext`

```ts
const accessToken = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
if (!accessToken) throwError("AUTH_EXPIRED", ...);   // ausência → AUTH_EXPIRED
const verified = await deps.verifyAccessToken(accessToken);
if (!verified) throwError("AUTH_INVALID", ...);      // inválido → AUTH_INVALID
return { userId, accessToken, db: createUserClient(deps.db, accessToken) };
```

`verifyAccessTokenViaGoTrue` faz `GET {supabaseUrl}/auth/v1/user` com o bearer
e a `apikey` — **uma chamada de rede por requisição autenticada**, sem
verificação local de assinatura. `deps.verifyAccessToken` é injetável para teste.

### 4.3 Validação de body e query

- Body ausente (`req.body === null`) vira `{}` antes do parse.
- JSON inválido → `VALIDATION_ERROR` ("corpo da requisição não é JSON válido").
- Falha de schema → `VALIDATION_ERROR` com `summarizeZodError`, que achata
  `issues` em `caminho: mensagem; caminho: mensagem`.
- Query: `searchParams` viram `Record<string,string>` e passam pelo schema
  (daí o uso de `z.coerce.number()` em `limit`).

### 4.4 As três formas de resposta

`runGateway` ramifica por **forma estrutural** do resultado, não pelo contrato:

```ts
isStreamResult(r)   →  "stream"   in r   → Response(stream, 200, sseHeaders)
isRedirectResult(r) →  "location" in r   → Response(null, 302, Location)
default             →  dataResponse(r.envelope, r.status, headers)
```

`X-Request-Id` é setado nos três caminhos.

### 4.5 Tratamento de exceção

| Entrada | Saída |
|---|---|
| `CerneError` | `{code,message,retryable,requestId}` + status da taxonomia (`err.http ?? 500`) |
| `ReplayMissError` | HTTP 500, `{code:"REPLAY_MISS", message, requestId}` — fora dos 13 códigos, só em `replay_strict` |
| Qualquer outra | HTTP 500, `{code:"INTERNAL_ERROR", message:"erro inesperado no servidor", requestId}` + `console.error` correlacionável por `requestId` |

O `console.error` no caminho genérico é um achado real (T-059v): antes dele,
um erro de banco/RPC não deixava rastro nem na resposta (por desenho) nem no
log do `functions serve`.

### 4.6 O dreno de corpo no `finally`

```ts
finally {
  if (req.body && !req.bodyUsed) { await req.arrayBuffer().catch(() => {}); }
}
```

Achado real (T-041): devolver uma `Response` sem nunca ler o corpo trava a
conexão no Deno/edge-runtime quando o payload é grande (denoland/deno#10182).
Acontece sempre que o passo 5 rejeita antes do passo 6 rodar — ex.: `media-ocr`
sem token com alguns MB de base64 no corpo. `bodyUsed` já é `true` para quem
passou pelo `parseBody`, então nunca lê duas vezes.

---

## 5. Camada compartilhada, módulo a módulo

`supabase/functions/_shared/` — 22 módulos `.ts` + 2 em `ai/`. Regra transversal:
nada aqui é reimplementado ad hoc por endpoint.

### 5.1 `errors.ts`

Lista fechada de 13 códigos + tabela literal código → HTTP → `retryable`.

| Código | HTTP | retryable |
|---|---|---|
| `AUTH_EXPIRED` | 401 | não |
| `AUTH_INVALID` | 401 | não |
| `NETWORK_TIMEOUT` | 504 | sim |
| `NETWORK_OFFLINE` | **null** | sim |
| `VALIDATION_ERROR` | 400 | não |
| `PII_CHECK_FAILED` | 502 | sim |
| `EMBEDDING_FAILED` | 502 | sim |
| `AI_GENERATION_TIMEOUT` | 504 | sim |
| `NOT_FOUND` | 404 | não |
| `RATE_LIMITED` | 429 | sim |
| `EXPORT_EMPTY_PERIOD` | 400 | não |
| `PAYLOAD_TOO_LARGE` | 413 | não |
| `OCR_NO_TEXT` | 400 | não |

Duas ausências deliberadas, documentadas no cabeçalho: **nunca 403** (recurso
de outro usuário é `NOT_FOUND`, D7) e **nunca 409** (idempotência do RF10 é
200, fora da taxonomia de erro).

API: `CerneError`, `throwError(code, message?, {cause})` (único ponto de
lançamento — handlers não fazem `throw new CerneError`), `isCerneError`,
`httpStatusFor`, `isRetryable`.

### 5.2 `serialize.ts`

Única fronteira `snake_case` ↔ `camelCase` do repositório.

- `snakeToCamel` / `camelToSnake` percorrem objetos e arrays recursivamente.
- `Date` é folha e vira ISO 8601 — a API nunca expõe objeto `Date`.
- `camelKeyToSnake` usa `/[A-Z]/g` (uma maiúscula por vez), não
  `/([a-z0-9])([A-Z])/`: a versão anterior colapsava `aBC` em `a_bc` e perdia
  a bijetividade com `snakeKeyToCamel`.
- `buildDataEnvelope(raw, meta?)` converte e monta `{data, meta?}` — handlers
  não chamam `snakeToCamel` separadamente.
- `errorToResponse` **lança** se o código não tiver status HTTP
  (`NETWORK_OFFLINE`), em vez de inventar um status.

### 5.3 `clock.ts` / `test-mode.ts` / `faults.ts`

**`test-mode.ts`** — gate único compartilhado. `isTestModeActive` exige
`X-Test-Key` presente e igual a `TEST_FAULT_KEY`, com comparação em tempo
constante (`timingSafeEqual`). Sem `TEST_FAULT_KEY` no ambiente, o modo nunca
liga.

**`clock.ts`** — `now(req, deps)` e `nowIso(req, deps)`. Em modo de teste com
`X-Test-Now` válido, devolve o instante congelado; caso contrário, `new Date()`.
Um `X-Test-Now` malformado nunca quebra a requisição. Nenhum handler chama
`new Date()` diretamente (exceção: `export-worker`, que não atende HTTP do app
— ver 15, D-16).

**`faults.ts`** — só **interpreta e registra**; quem executa o efeito é o
gateway. 6 tipos: `timeout`, `malformed`, `offline`, `ai_timeout`,
`rate_limited`, `slow:<ms>` (regex `/^slow:(\d+)$/`). `parseFault` devolve
`null` para tudo que deve ser ignorado em silêncio. `applyFault` grava em
`experiment.fault_injection_log` via RPC — cabeçalho ignorado não produz log.

### 5.4 `db.ts` / `worker-db.ts` / `deps.ts`

**`db.ts`** — `createUserClient(env, accessToken)` (JWT do usuário no header
`Authorization`) e `createAnonClient(env)`. Nunca `service_role`. Expõe também
os três wrappers de RPC de `experiment`: `logFaultInjection`,
`replayCacheLookup` (null = miss), `replayCacheStore` (idempotente).

**`worker-db.ts`** — `createServiceRoleClient`. 28 linhas, um único export,
importado por um único arquivo (`export-worker/index.ts`). É o isolamento
físico da regra "service_role só em worker de fila".

**`deps.ts`** — fiação de ambiente em 4 perfis:

| Perfil | Lê | Usado por |
|---|---|---|
| `AppEnv` (`readAppEnv`) | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `TEST_FAULT_KEY` | 14 endpoints |
| `AiEnv` (`readAiEnv`) | + `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `PROMPT_VERSION`, `REPLAY_MODE` | 6 endpoints que chamam IA |
| `OcrEnv` (`readOcrEnv`) | + `OCR_MAX_BYTES` (default 5 242 880) | `media-ocr` |
| `WorkerEnv` (`readWorkerEnv`) | `SUPABASE_SERVICE_ROLE_KEY`, `EXPORT_WORKER_SECRET`, `ANTHROPIC_API_KEY`, `PROMPT_VERSION`, `REPLAY_MODE` | `export-worker` |

`buildGatewayDeps(req, env)` monta as `GatewayDeps`. O cliente usado para
logar fault é escolhido pelo `Authorization` **cru** da requisição, não por
`ctx.auth` — o passo 4a roda antes do passo 5, então não existe `AuthContext`
ainda. `parseReplayMode` tem default seguro `off` (nunca serve nem grava cache
por engano).

`buildReplayDeps(db, mode)` monta as `ReplayDeps` a partir de um cliente já
escolhido pelo chamador.

### 5.5 `gotrue.ts`

Cliente fino: `signUp`, `signInWithPassword`, `refreshAccessToken`, `logout`.
`goTrueFetch` injeta `apikey` + `Content-Type`, trata 204 sem corpo e lança
`GoTrueApiError(status, body)` em não-2xx. **Nunca decide qual dos 13 códigos
o erro vira** — isso é de cada handler (e eles divergem: signup/login →
`AUTH_INVALID`, refresh → `AUTH_EXPIRED`).

`decodeJwtClaims(accessToken)` decodifica os claims **sem verificar
assinatura** — legítimo porque o gateway já validou o token contra o GoTrue na
mesma requisição. Evita uma segunda ida à rede em `GET /auth/session`.

### 5.6 `ai/anthropic.ts` e `ai/voyage.ts`

Ambos genéricos: não sabem qual operação estão servindo, não decidem taxonomia
de erro, e garantem estruturalmente que a chamada real nunca acontece fora de
`withReplay`.

**`ai/anthropic.ts`:**
- `ANTHROPIC_MODELS = { sonnet5: "claude-sonnet-5", haiku45: "claude-haiku-4-5-20251001" }`
- `ANTHROPIC_REQUEST_TIMEOUT_MS = 30_000` via `AbortSignal.timeout`. Sem isso,
  uma chamada presa fica pendurada até o runtime matar o isolate ("early
  termination has been triggered") — achado real de T-041.
- `callAnthropic(envelope, request, deps)` → `withReplay`.
- `streamAnthropic(request, env, onDelta)` → **deliberadamente fora** do cache:
  o header `X-Replay-Status` precisa ser decidido antes dos bytes começarem a
  sair, e `withReplay` só devolve status no final. O parser de frames SSE da
  própria Anthropic (`content_block_delta` → texto, `message_delta` →
  `stop_reason`) fica aqui; não confundir com `_shared/sse.ts`, que é o formato
  que **este** servidor emite.
- Suporta conteúdo multimodal (`AnthropicImageContent`) para o OCR e `tools` /
  `tool_choice` para saída estruturada.

**`ai/voyage.ts`:**
- `VOYAGE_MODEL = "voyage-4"`, `VOYAGE_OUTPUT_DIMENSION = 1024` (D8, fixados).
- `VOYAGE_REQUEST_TIMEOUT_MS = 30_000` — aqui importa ainda mais, porque
  `entries-create` conta com falha **rápida** para cair no fallback `failed`.
- Valida que a resposta tem exatamente 1024 floats, senão lança `VoyageApiError`.

### 5.7 `replay.ts`

O mecanismo que torna a IA determinística entre os dois ciclos.

**Envelope canônico:**
```ts
{ operation, provider, model, promptVersion, personaSnapshot, input }
```
`canonicalize` ordena chaves recursivamente e `computeCacheKey` faz
`sha256(JSON.stringify(canonico))` em hex. Sem a ordenação, dois handlers que
preenchessem os mesmos campos em ordem diferente produziriam chaves diferentes
para o mesmo input.

**7 operações e a normalização de `input`:**

| Operação | `personaSnapshot` | `input` |
|---|---|---|
| `chat` | persona da sessão | `historySeqs`, `historyHash`, `userMessage`, `retrievedEntryIds` (reordenado) |
| `insight` | persona da sessão | `sessionId`, `triggerType`, `triggerKey`, `historyHash` |
| `pii` | `null` | `text` |
| `ocr` | `null` | `imageSha256`, `mimeType` |
| `embedding` | `null` | `text`, `inputType` |
| `narrative` | `null` | `period`, `entryIdsHash` |
| `dashboard` | `null` | `period`, `entryIdsHash` |

`computeHistoryHash` = `sha256` da concatenação `role + ":" + content` em ordem
de `seq`, **sem separador entre mensagens**. `computeEntryIdsHash` ordena antes
de concatenar com `,`.

**4 modos (`withReplay`):**

| Modo | Consulta cache | Miss |
|---|---|---|
| `off` | não | chama o provedor, não grava |
| `record` | sim | chama o provedor e grava |
| `replay` | sim | chama o provedor e grava (idêntico a `record` no código) |
| `replay_strict` | sim | lança `ReplayMissError`, nunca chama o provedor |

`ReplayMissError` não é `CerneError` — está fora da lista fechada de 13.

### 5.8 `prompts.ts`

Toda montagem de prompt acontece no servidor (D5) — o app manda só o texto
digitado. Registro fechado de versões: `PROMPT_TEMPLATES = { v1: V1_TEMPLATE }`;
pedir uma versão sem entrada **lança**.

Cinco templates em `PromptTemplate`: `chatSystem`, `insightSystem`,
`insightClosingInstruction`, `exportNarrativeSystem`, `dashboardNarrativeSystem`.
As três personas têm voz própria em `PERSONA_VOICE` (`analitico`, `empatico`,
`socratico`); as duas narrativas são **sem persona**, coerente com
`personaSnapshot: null` no envelope de replay.

Quatro construtores exportados: `buildChatPrompt`, `buildInsightPrompt`,
`buildExportNarrativePrompt`, `buildDashboardNarrativePrompt`.

O próprio módulo documenta o que não consegue impedir: alguém editar a wording
de `v1` no lugar de criar `v2` — disciplina humana, nenhuma checagem em runtime
detecta.

### 5.9 `rag.ts`

`RAG_TOP_K = 5`, congelado (mudar altera a impressão digital do chat).
`runRag` gera o embedding da pergunta com `inputType: "query"` atrás do cache e
chama `searchEntriesByEmbedding` **sem filtros** de `source`/data — o RAG não é
busca do usuário, é contexto. Falha da Voyage → `EMBEDDING_FAILED` (502), ainda
na fase síncrona, antes de qualquer evento SSE.

Entradas com `pii_status='flagged'` **entram** no RAG (decisão registrada,
coerente com D3 — conteúdo original nunca censurado).

### 5.10 `sse.ts`

Quatro responsabilidades:

1. **Encoding** — `event: <tipo>\ndata: <json>\n\n`, com validação do payload
   contra o schema Zod do contrato antes de emitir. Exceção explícita:
   `code: "REPLAY_MISS"` pula a checagem (não está no `errorCodeEnum`).
2. **Ordem fixa da D12**, em runtime, via máquina de estados:
   ```
   start → message_created → context → (token* ) → done|error → ended
   ```
   Emitir fora de ordem lança `SseSequenceError`.
3. **`createSseStream()`** — devolve `{stream, emitter}`; o handler entrega
   `stream` ao gateway e alimenta `emitter` em fire-and-forget.
4. **`emitReplayedTokens`** — fatia texto de cache em pedaços de
   `REPLAY_CHUNK_SIZE = 32` a cada `REPLAY_CHUNK_INTERVAL_MS = 15`. Os limites
   dependem só do comprimento do texto, nunca do relógio ou da rede.

`sseHeaders` fixa `text/event-stream; charset=utf-8`, `no-cache`, `keep-alive`.

### 5.11 `chat-generation.ts`

Nasceu em `chat-messages-send/` e foi movido para `_shared/` porque os passos
4–9 são idênticos em `send` e `retry`.

- `peekChatCacheStatus(envelope, mode, replay)` — consulta o cache **sem
  emitir nada**, para o handler decidir `X-Replay-Status` antes de abrir o stream.
- `runChatGeneration(args)` — três caminhos: hit (reemite do cache, nunca chama
  a Anthropic), miss/`off` (streaming real, grava no cache se `status==="miss"`),
  miss em `replay_strict` (lança `ReplayMissError` antes de qualquer `token`).
  `prefetch` evita consultar o cache duas vezes. `CHAT_MAX_TOKENS = 2048`.
- `runChatTurnStream(args)` — produtor fire-and-forget dos passos 4–9. Emite
  `message_created` → `context` → geração → grava a mensagem (`complete`) →
  `done`. No `catch`: grava o **texto parcial acumulado** com `status='failed'`
  (melhor esforço) e emite `error` (`REPLAY_MISS` ou `AI_GENERATION_TIMEOUT`).
  `finally` sempre fecha o stream. Nenhuma exceção escapa.

Forma armazenada no cache para `operation='chat'`:
`{ text, finishReason }` — não o `AnthropicResponse` cru.

### 5.12 Repositórios

Cinco módulos, um por domínio. Todos recebem o cliente como parâmetro e
devolvem linhas ainda em `snake_case` (a conversão é na borda).

**`entries-repo.ts`** — `ENTRY_SELECT_WITH_TAGS = "*, entry_tags(tags(id, name))"`
resolve as tags embutidas numa consulta só (evita N+1). `shapeEntryForApi`
achata o embed do PostgREST em `tags: [{id,name}]`.
- `insertEntry` — trata SQLSTATE `23505` em `entries_chat_message_uniq`
  buscando e devolvendo a linha vencedora com `idempotentReplay: true`. **Esta
  é a garantia real do RF10**, não a checagem otimista do handler.
- `listEntries` — keyset com `limit + 1` e `count: "exact"`; o filtro
  "depois do cursor" é
  `occurred_at.lt.X , and(occurred_at.eq.X, id.gt.Y)`, espelhando o
  `ORDER BY occurred_at DESC, id ASC`.
- `markEmbeddingReady` / `markEmbeddingFailed`, `findEntryById`,
  `findEntryByChatMessageId`, `findEntriesByFilters`, `searchEntriesByEmbedding`.

**`chat-repo.ts`** — sessões (`createChatSession`, `findChatSessionById`,
`listChatSessions` keyset por `updated_at DESC, id ASC`,
`setSessionTitleIfEmpty` com guarda `.eq("title","")`, `touchSessionUpdatedAt`),
mensagens (`listChatMessages` por `seq ASC`, `nextSeq`, `insertMessage`,
`updateMessage`, `findMessageBySeq`, `findMessageById`) e insights
(`insertInsightIfNotExists` tratando `23505` como "já existe",
`updateInsightResult`).

**`profiles-repo.ts`** — `fetchServerRevision`, `fetchPersona`. Documenta a
leitura adotada para `serverRevision`: é coluna de `profiles`, não de `entries`;
cada `Entry` reporta o valor **atual** do perfil no momento da resposta.

**`dashboard-repo.ts`** — `periodStartFor(period, now)` (`7d`/`30d`/`90d`/`all`,
`all` → `null`), `fetchAggregateCounts` (RPC), `fetchEntriesForNarrative`
(limite `MAX_ENTRIES_FOR_NARRATIVE = 100`, `occurred_at DESC, id ASC`).

**`export-repo.ts`** — duas metades explicitamente separadas no arquivo:
- *de app* (`DbClient`, atrás da RLS): `countEntriesInPeriod`,
  `createExportJob`, `findExportJobById`.
- *de worker* (`SupabaseClient` com `service_role`, **sempre** filtrando
  `user_id` à mão porque a RLS não vale): `getExportJobForWorker`,
  `updateExportJob`, `fetchEntriesForExport` (ordem `occurred_at ASC, id ASC`).

### 5.13 `pdf.ts`

Escreve um PDF válido sem dependência externa (o `deno.json` declara só
`zod`, `@supabase/supabase-js`, `yaml`, `postgres`). Letter 612×792pt, margem
56, Helvetica 11pt, quebra de linha por contagem de caracteres
(`AVG_CHAR_WIDTH = FONT_SIZE * 0.52`), paginação automática, xref e trailer
calculados a partir dos offsets reais.

Bug real registrado no arquivo: `encodeLatin1` existe porque `TextEncoder`
(sempre UTF-8) codificaria acentuação em 2+ bytes, deslocando todo `/Length`
e todo offset do xref — o PDF abriria corrompido. `toLatin1` substitui
qualquer code point > 255 por `?`.

### 5.14 `_test_utils.ts`

Asserções mínimas locais (`assert`, `assertEquals`, `assertNotEquals`,
`assertThrowsAsync`, `assertThrowsSync`, `deepEqual`). Sem `jsr:@std/assert`
de propósito: jsr.io estava bloqueado no sandbox onde o projeto foi escrito, e
um util local garante que `deno test` roda igual em qualquer máquina, sem rede.

---

## 6. Camada de endpoints

### 6.1 Convenção de diretório

```
supabase/functions/<nome-do-endpoint>/
  index.ts        fiação: Deno.serve + runGateway. Sem regra de negócio.
  handler.ts      a regra. Testável sem Deno.serve.
  <local>.ts      módulo só deste endpoint (pii, embedding, ocr, generation, cursor)
  *.test.ts       testes de unidade Deno
```

**`index.ts` segue sempre a mesma forma:**
```ts
const contract = ENDPOINTS.find((e) => e.id === "<id>")!;
const env = readAppEnv();               // ou readAiEnv/readOcrEnv — uma vez, fora do handler
Deno.serve((req) => runGateway(req, contract, params, handler, buildGatewayDeps(req, env)));
```

**Extração de params** (o gateway não roteia):

| Forma | Funções |
|---|---|
| `{}` (sem param) | auth (5), `entries-create`, `entries-list`, `entries-search`, `media-ocr`, `chat-sessions-create`, `chat-sessions-list`, dashboard (2), account (2) |
| último segmento da URL | `entries-get` (`id`), `chat-messages-list` (`id`), `chat-messages-send` (`id`), `chat-insight-create` (`id`), `export-status-get` (`jobId`), `export-download-get` (`jobId`) |
| dois últimos segmentos | `chat-messages-retry` (`id`, `userMessageId`) |

### 6.2 Auth (5)

| Endpoint | Handler | Comportamento |
|---|---|---|
| `POST /auth/signup` | `auth-signup` | Proxy do GoTrue. `GoTrueApiError` → `AUTH_INVALID` com detalhe extraído (`msg`/`error_description`/`error`/`error_code`). Checagem defensiva: sem `access_token` na resposta → `AUTH_INVALID` ("confirmação de e-mail pode estar habilitada") |
| `POST /auth/login` | `auth-login` | Proxy. Erro → `AUTH_INVALID` |
| `POST /auth/refresh` | `auth-refresh` | Proxy. Erro → **`AUTH_EXPIRED`** (distinção deliberada: o motivo típico é refresh token que não vale mais). Devolve só `session`, descarta `user` |
| `GET /auth/session` | `auth-session` | **Único com lógica própria.** `decodeJwtClaims` (sem rede) + `fetchServerRevision` |
| `POST /auth/logout` | `auth-logout` | Proxy. `GoTrueApiError` é **engolido** — sempre `{ok:true}`; devolver erro por "sua sessão já estava encerrada" seria pior UX |

### 6.3 Entradas e mídia (5)

**`POST /entries` (`entries-create`)** — sequência dos 7 passos:
1. validação Zod (gateway)
2–3. se `chatMessageId`, `findEntryByChatMessageId` → se existe, 200 com
   `meta.idempotentReplay: true`, encerra (checagem **otimista**, só economiza
   uma chamada ao Haiku)
4. `detectPii` → falha lança `PII_CHECK_FAILED`, **nada é gravado**
5. `insertEntry` com `embedding_status='pending'`; colisão `23505` aqui ainda
   devolve a linha vencedora com `idempotentReplay: true` (garantia real do RF10)
6. `generateEntryEmbedding` → `markEmbeddingReady` ou `markEmbeddingFailed`
7. 200 com `serverRevision` anexado

Módulos locais:
- `pii.ts` — Haiku 4.5 com *tool use* (`report_pii_spans`), `toolChoice`
  forçado. `maxTokens: 4096`. `status: spans.length > 0 ? "flagged" : "clean"`.
  Três caminhos para `PII_CHECK_FAILED`: chamada falhou, sem bloco `tool_use`,
  ou saída fora do schema. **Anota, nunca remove** — `content` gravado é o
  original.
- `embedding.ts` — **nunca lança**: falha da Voyage vira `{status:"failed"}`.
  `inputType: "document"` sempre.

**`GET /entries` (`entries-list`)** — `DEFAULT_LIMIT = 20`, keyset, tags
embutidas, `meta: {nextCursor, total}`, header `X-Data-Version`. `hasMore` vem
do `limit + 1`; o cursor aponta para a última linha que **fica** na página.

**`GET /entries/:id` (`entries-get`)** — `UUID_RE` barra id malformado como
`NOT_FOUND` (evita erro de sintaxe do Postgres virando 500). Não existe /
é de outro usuário → mesma resposta 404 (D7).

**`GET /entries/search` (`entries-search`)** — dois modos:
- `q` ausente/vazio → `findEntriesByFilters`, `meta.mode = "filter_only"`,
  **nunca chama a Voyage**
- `q` presente → embedding `inputType:"query"` atrás do cache → RPC
  `entries_search_by_embedding` → `meta.mode = "semantic"`, cada item com
  `similarity: 1 - distance`

Filtros `source`/`dateFrom`/`dateTo` combinam com AND nos dois modos.
`fetchServerRevision` é disparado em paralelo (`serverRevisionPromise`).

**`POST /media/ocr` (`media-ocr`)** — decodifica o base64 **antes** de checar
o tamanho (o limite é sobre bytes reais, não sobre a string ~33% maior).
Acima de `ocrMaxBytes` → `PAYLOAD_TOO_LARGE`. `ocr.ts` chama Haiku 4.5 com
bloco de imagem multimodal + tool use (`report_ocr_result`); texto vazio →
`OCR_NO_TEXT`. **A imagem nunca é persistida** (D17) — só o SHA-256 entra no
envelope de cache.

### 6.4 Chat (6)

| Endpoint | Notas |
|---|---|
| `POST /chat/sessions` | Lê `persona` do perfil e congela em `persona_snapshot`. `title` opcional |
| `GET /chat/sessions` | Keyset por `updated_at DESC, id ASC`, `meta.nextCursor` |
| `GET /chat/sessions/:id/messages` | `seq ASC`. Sessão inexistente/alheia → 404 |
| `POST /chat/sessions/:id/messages` | SSE — ver abaixo |
| `POST /chat/sessions/:id/messages/:userMessageId/retry` | SSE — ver abaixo |
| `POST /chat/sessions/:id/insight` | Nunca erro HTTP |

**`chat-messages-send`** — fase síncrona:
1. valida sessão; lê o histórico **antes** do insert (para nunca incluir a
   própria mensagem em `historySeqs`/`historyHash`)
2. `insertMessage` (role `user`, `status='complete'`, `seq = último + 1`)
3. `setSessionTitleIfEmpty` com `deriveSessionTitle` — truncamento
   determinístico em `TITLE_MAX_LENGTH = 60` + `…`, **sem chamada de IA**
   (não existe operação `title` no cache de replay)
4. `touchSessionUpdatedAt(ctx.now)`
5. `runRag` — pode lançar `EMBEDDING_FAILED` como erro HTTP normal
6. `insertMessage` (role `assistant`, `content: ""`, `status='streaming'`)
7. `buildChatEnvelope` + `buildChatPrompt` + `peekChatCacheStatus`
8. devolve `{stream, headers: {"X-Replay-Status": prefetch.status}}` e dispara
   `runChatTurnStream`

`seq` no payload de `message_created` é o **do assistente** — é essa linha que
o cliente observa mudar de `streaming` para `complete`/`failed`.

**`chat-messages-retry`** (D15) — corpo vazio (`z.object({}).strict()`).
Relê a última mensagem `role='user'` da sessão; se `:userMessageId` não for
ela → `VALIDATION_ERROR` (código nomeado pelo próprio plano para esta
checagem, diferente do `NOT_FOUND` de D7). **Reaproveita a mesma linha** do
assistente (`seq` seguinte): `content=''`, `status='streaming'`,
`retry_count + 1`. Histórico = tudo com `seq < userMessage.seq`. RAG é
recomputado (determinístico). Mesmo histórico + mesma pergunta + mesmo RAG ⇒
mesma `cache_key` ⇒ `X-Replay-Status: hit`.

**`chat-insight-create`** (RF08) — `insertInsightIfNotExists`; conflito na
UNIQUE `(session_id, trigger_type, trigger_key)` → 200 com a linha existente,
qualquer que seja o status, **sem gerar de novo**. `triggerKey` é calculado
pelo cliente e não é recalculado aqui. `generation.ts` **nunca lança**:
`INSIGHT_MAX_TOKENS = 256`, `forceFailure` para o fault `ai_timeout`, e
qualquer falha vira `{status:"failed"}` → HTTP **200** com
`status='failed'` e `errorCode: "AI_GENERATION_TIMEOUT"`.

### 6.5 Exportação (3)

**`POST /export/summary`** — `countEntriesInPeriod` **síncrono**; zero →
`EXPORT_EMPTY_PERIOD` (400) sem criar job nem enfileirar (assimetria
deliberada com o dashboard, onde zero entradas não é erro). Caso contrário:
`createExportJob` (com `entry_count` já resolvido; `narrative_status` nasce
`pending` ou `skipped`), `rpc("export_enqueue")`, e — se
`ctx.fault?.type === "ai_timeout"` — `rpc("export_mark_fault")`. Responde
**202**.

**`GET /export/:jobId/status`** — `downloadAvailable` é resolvido no servidor
(`status ∈ {data_ready, done}`); o app não precisa conhecer a regra.

**`GET /export/:jobId/download`** — 302 para URL assinada
(`SIGNED_URL_TTL_SECONDS = 60`), criada com o cliente do **próprio usuário**
(a política do bucket já concede `select` ao dono do caminho). `format=pdf`
(default) cai para `raw` se `pdf_file_path` for nulo. Job não pronto → 404
(lacuna preenchida: não há código para "ainda não está pronto"). Falha de
narrativa **nunca** produz 4xx/5xx aqui.

### 6.6 Dashboard (2)

**`GET /dashboard/aggregate`** — `periodStartFor(period, ctx.now)` + RPC
`dashboard_aggregate_counts`. `buildBuckets` pivota (dia × origem) num `Map`
(que preserva a ordem de inserção, já vinda ordenada do SQL) e soma `totals`.
**Sempre 200**, inclusive `buckets: []`. Header `X-Data-Version`.

**`GET /dashboard/narrative`** — independente do agregado. Busca até 100
entradas do período, monta o prompt sem persona, chama Haiku atrás do cache.
`ctx.fault?.type === "ai_timeout"` pula a chamada. Texto vazio ou exceção →
`AI_GENERATION_TIMEOUT` (504). `generatedAt = ctx.now`.

### 6.7 Conta (2)

**`PATCH /account/settings`** — `email` já é barrado pelo `.strict()` do Zod
no gateway. `camelToSnake(ctx.body)` vira o patch; só faz `UPDATE` se houver
chave. Sempre relê e devolve o perfil.

**`DELETE /account`** — exige `{confirmation: "DELETE"}`. Duas etapas:
1. `purgeExportsBucket` — lista `<userId>/` e `<userId>/<job>/`, remove os
   objetos. Envolvido em `.catch(() => {})`: **falha aqui não bloqueia a
   exclusão** (perder a conta do usuário por causa de arquivo órfão seria pior).
2. `rpc("delete_own_account")` — apaga a própria linha em `auth.users`; a
   cascata cuida do resto.

### 6.8 `export-worker` (fora do registro)

Não é um dos 23, não passa por `runGateway`, não tem Zod/`X-Test-Fault`/
`X-Test-Now`. Único "gateway" é a comparação
`bearer === env.workerSecret` (`EXPORT_WORKER_SECRET`). Nunca loga o bearer
recebido nem o segredo.

`worker.ts::processExportJob` — **nunca lança**:
```
getExportJobForWorker → (job sumiu? return)
status='processing'
fetchEntriesForExport → raw.json → upload → status='data_ready', raw_file_path
narrative_status==='skipped' ? status='done' : tryGenerateNarrative(...)
catch externo → status='error' + console.error
```
`tryGenerateNarrative` — lê `export_get_fault` (repasse do `ai_timeout`),
monta envelope `narrative`, chama Haiku (`EXPORT_NARRATIVE_MAX_TOKENS = 512`),
gera o PDF, faz upload e marca `done`. No `catch`: `narrative_status='failed'`,
`narrative_error_code='AI_GENERATION_TIMEOUT'`, **`status` permanece
`data_ready`** — o bruto já está disponível.

---

## 7. Camada de dados

### 7.1 As 20 migrações

| # | Arquivo | Conteúdo |
|---|---|---|
| 0001 | `extensions` | `pgcrypto`, `vector`, `pgtap` (schema `extensions`); `pg_cron`, `pgmq` (schema próprio) |
| 0002 | `profiles` | Tabela + trigger `on_auth_user_created` |
| 0003 | `chat_sessions_chat_messages` | Duas tabelas + trigger de contador |
| 0004 | `entries` | Tabela + índice de timeline + índice único de idempotência + trigger `bump_server_revision` |
| 0005 | `tags_entry_tags` | Duas tabelas + índice único `(user_id, lower(name))` |
| 0006 | `insights` | Tabela + UNIQUE que implementa o RF08 |
| 0007 | `export_jobs` | Tabela; `status` e `narrative_status` sem DEFAULT |
| 0008 | `experiment_schema` | Schema `experiment` + `ai_replay_cache` + `fault_injection_log`, trancados |
| 0009 | `rls_policies` | ENABLE+FORCE RLS, 4 políticas e GRANT/REVOKE nas 8 tabelas com dono |
| 0010 | `experiment_rpc` | 3 funções `SECURITY DEFINER` de superfície mínima |
| 0011 | `entries_search_rpc` | `entries_search_by_embedding` (`SECURITY INVOKER`) |
| 0012 | `chat_stale_streaming_job` | `mark_stale_streaming_chat_messages` + cron `* * * * *` |
| 0013 | `export_storage` | Bucket `exports` + 3 políticas de Storage |
| 0014 | `export_queue` | `pg_net`, fila pgmq, `worker_config`, `export_enqueue`, `export_dispatch_pending_jobs` + cron `15 seconds` |
| 0015 | `dashboard_aggregate_rpc` | `dashboard_aggregate_counts` (`SECURITY INVOKER`) |
| 0016 | `export_worker_replay_grants` | GRANT das RPCs de cache para `service_role` |
| 0017 | `account_delete_rpc` | `delete_own_account()` |
| 0018 | `export_ai_timeout_fault` | `experiment.export_fault` + `export_mark_fault` / `export_get_fault` |
| 0019 | `export_worker_shared_secret` | Renomeia `service_role_key` → `shared_secret`; recria o dispatcher |
| 0020 | `export_worker_table_grants` | `GRANT SELECT,UPDATE ON export_jobs` e `SELECT ON entries` para `service_role` |

### 7.2 Tabelas

**`profiles`** — `id` (FK `auth.users` ON DELETE CASCADE), `email`,
`display_name`, `biometric_enabled`, `persona` (CHECK 3 valores),
`server_revision bigint default 0`, `created_at`, `updated_at`.

**`entries`** — `content` (CHECK `char_length between 1 and 20000`), `source`
(CHECK 4 valores), `chat_message_id` (FK ON DELETE SET NULL), `occurred_at`,
`embedding vector(1024)`, `embedding_model/dim/input_type`, `embedding_status`
(CHECK), `pii_status` (CHECK 4), `pii_spans jsonb default '[]'`,
`media_duration_seconds`, `created_at`, `updated_at`.
- CHECK `entries_source_chat_message_coherence`: `(source='chat') = (chat_message_id is not null)`
- Índice `entries_user_occurred_idx (user_id, occurred_at desc, id asc)`
- **Índice único parcial** `entries_chat_message_uniq (user_id, chat_message_id) WHERE chat_message_id is not null` — a garantia do RF10

**`chat_sessions`** — `title`, `persona_snapshot` (CHECK),
`user_message_count`, `last_user_message_at`, `created_at`, `updated_at`.

**`chat_messages`** — `session_id`, `user_id` (denormalizado para a RLS
filtrar sem join), `role` (CHECK), `content`, `seq`, `status` (CHECK 3),
`retry_count`, `created_at`. UNIQUE `(session_id, seq)`. **Sem `updated_at`.**

**`tags`** / **`entry_tags`** — `user_id` denormalizado em `entry_tags`; PK
composta `(entry_id, tag_id)`. Populadas **só pelo seed**.

**`insights`** — `trigger_type` (CHECK 2), `trigger_key`, `status` (CHECK 4),
`content`, `error_code`, `dismissed_at`. UNIQUE
`(session_id, trigger_type, trigger_key)`.

**`export_jobs`** — `period_start`/`period_end` (nulo = todo o período),
`status` (CHECK 5), `narrative_status` (CHECK 5), `entry_count`,
`raw_file_path`, `pdf_file_path`, `error_code`, `narrative_error_code`,
`completed_at`.

**`experiment.ai_replay_cache`** — PK `cache_key`, `operation`, `provider`,
`model`, `prompt_version`, `request_envelope jsonb`, `response jsonb`,
`hit_count`, `created_at`.
**`experiment.fault_injection_log`** — `request_id`, `endpoint`, `fault_type`,
`injected_at`.
**`experiment.worker_config`** — singleton (`id boolean PK` + CHECK), com
`functions_base_url` e `shared_secret`.
**`experiment.export_fault`** — `job_id` PK, `fault_type`.

### 7.3 Triggers

| Trigger | Tabela | Efeito |
|---|---|---|
| `on_auth_user_created` | `auth.users` AFTER INSERT | Cria a linha em `profiles` (SECURITY DEFINER) |
| `chat_messages_bump_session` | `chat_messages` AFTER INSERT | Se `role='user'`: incrementa `user_message_count` e grava `last_user_message_at` |
| `entries_bump_server_revision` | `entries` AFTER INSERT OR UPDATE | `profiles.server_revision += 1` do dono |

`chat_sessions.updated_at`, `chat_sessions.title` e `profiles.updated_at` **não
têm trigger** — são responsabilidade do endpoint.

### 7.4 RPCs — `SECURITY DEFINER` vs `INVOKER`

O critério é consistente no projeto:

| Função | Modo | Por quê |
|---|---|---|
| `experiment_log_fault_injection` | DEFINER | `experiment` é trancado para `authenticated` |
| `experiment_replay_cache_lookup` | DEFINER | idem; faz `UPDATE ... RETURNING` (lookup+incremento atômicos) |
| `experiment_replay_cache_store` | DEFINER | idem; `ON CONFLICT DO NOTHING` (primeira gravação vence) |
| `entries_search_by_embedding` | **INVOKER** | RLS de `entries` continua valendo; não recebe `user_id` |
| `dashboard_aggregate_counts` | **INVOKER** | idem |
| `mark_stale_streaming_chat_messages` | DEFINER, **sem GRANT** | só `pg_cron` chama |
| `export_enqueue` | DEFINER | `pgmq` não é exposto; checa `user_id = auth.uid()` por dentro |
| `export_dispatch_pending_jobs` | DEFINER, **sem GRANT** | só `pg_cron` |
| `delete_own_account` | DEFINER | `auth.uid()` embutido, sem parâmetro solto |
| `export_mark_fault` | DEFINER | checa posse do job |
| `export_get_fault` | DEFINER, GRANT só `service_role` | só o worker lê |

**Pegadinha registrada em 3 migrações:** toda função nova é `EXECUTE` por
`PUBLIC` no Postgres; revogar só de `anon` não basta. O padrão do projeto é
`REVOKE ... FROM public` e depois `GRANT` ao papel certo.

As RPCs moram em `public` (com prefixo `experiment_`) porque o PostgREST só
expõe funções dos schemas listados em `config.toml` — e `experiment` está fora
dessa lista de propósito.

### 7.5 Fila, cron e `pg_net`

`pg_cron` sozinho não faz HTTP. O padrão adotado:
`pg_cron` → `export_dispatch_pending_jobs()` → `pgmq.read(fila, vt=60, qty=5)`
→ `net.http_post(cfg.functions_base_url || '/export-worker', Bearer
cfg.shared_secret, timeout 30s)` → `pgmq.delete(msg_id)`.

Dois jobs agendados:

| Job | Schedule |
|---|---|
| `mark-stale-streaming-chat-messages` | `* * * * *` |
| `export-dispatch-pending-jobs` | `15 seconds` |

`cron.schedule` com `jobname` é idempotente. Sem linha em
`experiment.worker_config`, o dispatcher faz `return` cedo — jobs ficam em
`pending`, sem erro. Não há retry de despacho (trade-off registrado na
migração).

### 7.6 Storage

Bucket privado `exports`. Convenção de caminho:
`<user_id>/<job_id>/raw.json` e `<user_id>/<job_id>/summary.pdf`.

Três políticas (`select`, `insert`, `delete`) com predicado
`bucket_id = 'exports' AND (storage.foldername(name))[1] = auth.uid()::text`.
**Sem política de UPDATE** — nenhum fluxo sobrescreve objeto gravado.

Achado registrado na migração 0013: `REVOKE ALL ON storage.objects FROM anon`
**não** tem o mesmo efeito que em `public.*` (o SELECT de fábrica do serviço de
Storage não é desfeito). Quem garante o isolamento é a RLS — sem política que
libere `anon`, a consulta devolve 0 linhas.

### 7.7 Schema `experiment`

Trancado para `anon` e `authenticated` (`REVOKE ALL` + `ALTER DEFAULT
PRIVILEGES`), fora de `[api].schemas`. Não é dado de usuário — é
infraestrutura de experimento: cache de replay, log de injeção de falha,
config do worker e repasse de fault.

### 7.8 Seed

`supabase/seed/seed.sql` (479 linhas), idempotente: todo ID é literal fixo e
toda escrita usa `ON CONFLICT DO NOTHING`.

- **Âncora temporal fixa:** `2026-09-23T09:41:00Z` (`supabase/seed/ancora.md`);
  todas as datas são relativas a ela.
- Três contas de cenário: `cenario-cheio@cerne.test` (A),
  `cenario-uma@cerne.test` (B), `cenario-vazio@cerne.test` (C), senha comum
  documentada em `ancora.md`.
- As entradas da conta A nascem com `embedding_status='pending'` — SQL puro
  não faz HTTP. `scripts/backfill-seed-embeddings.ts` preenche depois.
- Uma entrada é propositalmente deixada em `failed` e nunca é tocada pelo
  backfill.

---

## 8. Segurança

### 8.1 Fluxo de autenticação ponta a ponta

```
1. POST /auth/signup|login  → GoTrue emite {access_token, refresh_token, expires_at}
                              trigger on_auth_user_created cria a linha em profiles
2. App guarda os tokens. Toda chamada subsequente: Authorization: Bearer <access_token>
3. gateway.authenticate():
     sem header            → AUTH_EXPIRED (401)
     GET /auth/v1/user !ok → AUTH_INVALID (401)
     ok                    → AuthContext { userId, accessToken, db }
4. db = createUserClient(...) → PostgREST resolve o papel `authenticated`
     a partir do JWT, e a RLS decide o que a consulta enxerga
5. POST /auth/refresh quando expira; POST /auth/logout encerra
```

`verify_jwt = false` nas 24 funções (`config.toml`) é **deliberado**: sem isso
o motor de Edge Functions barraria requisições sem JWT antes do código rodar —
inclusive nos 3 endpoints sem sessão prévia — e com um erro genérico do
runtime, não o envelope do projeto. Quem decide o que é credencial válida é
`gateway.ts`.

### 8.2 Matriz de RLS

As 8 tabelas com dono têm o mesmo tratamento em `0009_rls_policies.sql`:
`ENABLE` + **`FORCE`** ROW LEVEL SECURITY, 4 políticas (SELECT/INSERT/UPDATE/
DELETE), `GRANT` explícito para `authenticated`, `REVOKE ALL` de `anon`.

| Tabela | Coluna de dono | Predicado |
|---|---|---|
| `profiles` | `id` | `auth.uid() = id` |
| `entries` | `user_id` | `auth.uid() = user_id` |
| `tags` | `user_id` | `auth.uid() = user_id` |
| `entry_tags` | `user_id` (denormalizado) | `auth.uid() = user_id` |
| `chat_sessions` | `user_id` | `auth.uid() = user_id` |
| `chat_messages` | `user_id` (denormalizado) | `auth.uid() = user_id` |
| `insights` | `user_id` (denormalizado) | `auth.uid() = user_id` |
| `export_jobs` | `user_id` | `auth.uid() = user_id` |

`FORCE` importa: sem ele, o dono da tabela ignoraria as políticas.
O `GRANT` explícito é necessário porque `auto_expose_new_tables = false` no
`config.toml` — sem GRANT de tabela a política não tem o que restringir.

A denormalização de `user_id` em `chat_messages`/`entry_tags`/`insights` existe
para a política filtrar **sem join**.

### 8.3 Papéis e a regra do `service_role`

| Papel | Onde aparece |
|---|---|
| `anon` | `createAnonClient` — só para logar fault nos 3 endpoints sem sessão |
| `authenticated` | `createUserClient` — **todos** os 23 endpoints |
| `service_role` | `worker-db.ts` → `export-worker` **apenas** |

A regra ("nunca `service_role` numa Edge Function que atende requisição do
aplicativo — só em workers de fila") é aplicada por **isolamento físico**: o
único módulo que cria esse cliente vive fora de `db.ts` e não é importado por
nenhum dos 23 diretórios.

Consequência registrada na migração 0020: `service_role` tem `BYPASSRLS`, mas
BYPASSRLS e GRANT de tabela são mecanismos independentes — bypassar RLS não
dispensa `GRANT SELECT/UPDATE`. Por isso `export-repo.ts` separa explicitamente
funções "de app" (que confiam na RLS) de funções "de worker" (que **sempre**
filtram `user_id` à mão).

### 8.4 Políticas de Storage

Ver 7.6. O download usa o cliente do próprio usuário para assinar a URL —
não há elevação de privilégio no caminho de leitura.

### 8.5 Superfície de teste

Três cabeçalhos, todos atrás de `X-Test-Key == TEST_FAULT_KEY`:

| Cabeçalho | Efeito |
|---|---|
| `X-Test-Key` | Gate. Sem coincidência, os outros dois são **ignorados em silêncio**, nunca rejeitados |
| `X-Test-Now` | Congela `now()` |
| `X-Test-Fault` | Um dos 6 tipos |

Sem `TEST_FAULT_KEY` no ambiente, o modo nunca liga. A comparação é em tempo
constante. Toda injeção reconhecida grava linha em
`experiment.fault_injection_log`.

**Superfície residual registrada** (migração 0010): as 3 RPCs de `experiment`
têm `GRANT EXECUTE` para `authenticated`, então um usuário autenticado poderia
chamá-las fora do gateway. Isso suja infraestrutura de experimento, nunca dado
de outro usuário — não é via de escalonamento de privilégio.

---

## 9. Regras de negócio implementadas

### 9.1 RF01 / RF10 / D4 — criação de entrada e idempotência

Sequência de 7 passos em `entries-create/handler.ts` (ver 6.3). A idempotência
é **garantida pelo banco, não pelo código**: o índice único parcial
`entries_chat_message_uniq`. A checagem `findEntryByChatMessageId` antes do
Haiku é otimização, não garantia — se houver corrida, `insertEntry` captura o
`23505` e devolve a linha vencedora com `meta.idempotentReplay: true`. O
trabalho de PII feito na tentativa perdedora é descartado sem nunca ser gravado.

Nunca 409 — replay idempotente é **200**.

### 9.2 D3 / RNF02 — PII anota, nunca remove

`content` gravado é sempre o texto original, íntegro. `pii_spans` é a lista de
`{start,end,type}`. `pii_status='flagged'` é caminho **normal**; encontrar PII
num diário é esperado. `PII_CHECK_FAILED` significa que a **verificação**
falhou, não que encontrou algo — e nesse caso nada é gravado.
Entradas `flagged` entram no RAG normalmente.

### 9.3 D8 — embeddings e fallback

`voyage-4`, 1024 dimensões, `input_type='document'` ao salvar e `'query'` ao
buscar. Falha da Voyage → `embedding_status='failed'`, **a entrada permanece**
(falhar `POST /entries` por causa do embedding está na lista de armadilhas a
evitar). `generateEntryEmbedding` nunca lança.

### 9.4 RF06 — busca semântica e filtros

Varredura **exata** por distância de cosseno (`<=>` do pgvector), nunca índice
aproximado (HNSW/IVFFlat estão proibidos por regra e são checados por
`scripts/schema-hash.ts`). Desempate por `id ASC`. Filtros aplicados no `WHERE`
**antes** do ranqueamento, dentro da própria RPC. Modo `filter_only` nunca
chama a Voyage. Sem throttle no servidor — o debounce é do app.

### 9.5 RF02 / D17 — OCR sem persistência

A imagem trafega em base64, é decodificada em memória para checar
`OCR_MAX_BYTES`, vai para o Haiku como bloco multimodal, e **não toca disco,
Storage nem banco**. Só o SHA-256 entra no envelope de cache. Sem texto legível
→ `OCR_NO_TEXT`.

### 9.6 D12 / D15 — chat streaming e retry

Ordem fixa `message_created → context → token* → done|error`, imposta em
runtime pela máquina de estados do `sse.ts`. Falha na fase síncrona = erro HTTP;
falha depois = evento `error` no stream, com o texto parcial preservado em
`chat_messages` (`status='failed'`).

Retry (D15): mesma pergunta + mesmo histórico + mesmo RAG ⇒ mesma `cache_key`
⇒ hit no cache, custo zero. Reaproveita a mesma linha do assistente (não existe
estado "substituída" no CHECK). Rede de segurança: job pg_cron marca `failed`
qualquer mensagem presa em `streaming` há mais de 60s.

### 9.7 RF08 — insight de disparo único

A UNIQUE `(session_id, trigger_type, trigger_key)` é o mecanismo. Conflito →
200 com a linha existente, sem regerar. **Nunca erro HTTP**: falha de geração
vira 200 com `status='failed'` e `errorCode`. `triggerKey` é responsabilidade
do cliente.

### 9.8 RF05 — exportação assíncrona resiliente

Dados e narrativa evoluem **independentes**. Zero entradas → `EXPORT_EMPTY_PERIOD`
(400), sem job. Caso contrário 202 + fila. O worker publica o bruto e marca
`data_ready` **antes** de tentar a narrativa; se a narrativa falhar,
`narrative_status='failed'` e `status` permanece `data_ready` — o download
continua funcionando (caindo para `raw`). Download nunca devolve 4xx/5xx por
falha de narrativa.

### 9.9 RF09 — dashboard

Agregado **sempre 200**, inclusive com zero entradas (`buckets: []`) — nunca
`NOT_FOUND`. Narrativa é endpoint separado; falha dela não derruba o agregado.

### 9.10 D7 — `NOT_FOUND` em vez de 403

Aplicado uniformemente: `entries-get`, `chat-messages-list`,
`chat-messages-send`, `chat-insight-create`, `export-status-get`,
`export-download-get`. Todos rejeitam id não-UUID como `NOT_FOUND` antes de
consultar o banco (evita erro de sintaxe do Postgres virando 500). Não existe
nem existirá 403 na taxonomia.

### 9.11 D9 / RF07 — selo de sincronização

O servidor não guarda estado de sincronização (arquitetura cloud-only). Expõe
`serverRevision` (contador monotônico por **usuário**, incrementado pelo
trigger em `entries`) e `updatedAt`. O selo é derivado inteiramente no app.
Header `X-Data-Version` em `entries-list` e `dashboard-aggregate-get`.
*(Ver seção 15, D-06 e D-07, para o que diverge aqui.)*

### 9.12 D5 — prompts no servidor, versionados

O app nunca vê nem envia texto de sistema, histórico formatado ou contexto de
RAG. `PROMPT_VERSION` entra na `cache_key` como **proxy** do template — a chave
não depende do texto literal produzido.

---

## 10. Contratos de API

### 10.1 Convenções comuns

| Item | Valor |
|---|---|
| Sucesso | `{ data, meta? }` |
| Erro | `{ code, message, retryable, requestId }` |
| Correlação | `X-Request-Id` (ecoado ou gerado) em toda resposta |
| Versão de dados | `X-Data-Version` (só `entries-list` e `dashboard-aggregate-get`) |
| Replay | `X-Replay-Status: hit|miss|off` (só os 2 endpoints SSE) |
| Datas | ISO 8601 com offset |
| Campos | `camelCase` |
| Paginação | keyset, cursor opaco base64url, `meta.nextCursor` |

**URL real:** `{FUNCTIONS_BASE_URL}/<nome-do-diretório>/<params>`.
Ex.: `POST {base}/entries-create`, `GET {base}/entries-get/<id>`,
`POST {base}/chat-messages-retry/<sessionId>/<userMessageId>`.

### 10.2 Os 23 endpoints

| # | Método | Caminho (contrato) | Função | Auth | Sucesso |
|---|---|---|---|---|---|
| 1 | POST | `/auth/signup` | `auth-signup` | não | 200 `{session,user}` |
| 2 | POST | `/auth/login` | `auth-login` | não | 200 `{session,user}` |
| 3 | POST | `/auth/refresh` | `auth-refresh` | não | 200 `{session}` |
| 4 | GET | `/auth/session` | `auth-session` | sim | 200 `{user,expiresAt,serverRevision}` |
| 5 | POST | `/auth/logout` | `auth-logout` | sim | 200 `{ok:true}` |
| 6 | POST | `/entries` | `entries-create` | sim | 200 `Entry` + `meta.idempotentReplay?` |
| 7 | GET | `/entries` | `entries-list` | sim | 200 `Entry[]` + `meta{nextCursor,total}` |
| 8 | GET | `/entries/:id` | `entries-get` | sim | 200 `Entry` |
| 9 | GET | `/entries/search` | `entries-search` | sim | 200 `Entry[]`+`similarity?` + `meta.mode` |
| 10 | POST | `/media/ocr` | `media-ocr` | sim | 200 `{text,confidence}` |
| 11 | POST | `/chat/sessions` | `chat-sessions-create` | sim | 200 `ChatSession` |
| 12 | GET | `/chat/sessions` | `chat-sessions-list` | sim | 200 `ChatSession[]` + `meta.nextCursor` |
| 13 | GET | `/chat/sessions/:id/messages` | `chat-messages-list` | sim | 200 `ChatMessage[]` |
| 14 | POST | `/chat/sessions/:id/messages` | `chat-messages-send` | sim | 200 **SSE** |
| 15 | POST | `/chat/sessions/:id/messages/:userMessageId/retry` | `chat-messages-retry` | sim | 200 **SSE** |
| 16 | POST | `/chat/sessions/:id/insight` | `chat-insight-create` | sim | 200 `Insight` |
| 17 | POST | `/export/summary` | `export-summary-create` | sim | **202** `{jobId,status:"pending"}` |
| 18 | GET | `/export/:jobId/status` | `export-status-get` | sim | 200 `ExportStatus` |
| 19 | GET | `/export/:jobId/download` | `export-download-get` | sim | **302** `Location` |
| 20 | GET | `/dashboard/aggregate` | `dashboard-aggregate-get` | sim | 200 `{buckets,totals}` |
| 21 | GET | `/dashboard/narrative` | `dashboard-narrative-get` | sim | 200 `{text,generatedAt}` |
| 22 | PATCH | `/account/settings` | `account-settings-update` | sim | 200 `Profile` |
| 23 | DELETE | `/account` | `account-delete` | sim | 200 `{ok:true}` |

### 10.3 Payloads principais

**`Entry`**
```jsonc
{ "id", "content", "source", "chatMessageId": null,
  "occurredAt", "tags": [{"id","name"}],
  "piiStatus": "pending|clean|flagged|failed",
  "piiSpans": [{"start","end","type"}],
  "embeddingStatus": "pending|ready|failed",
  "mediaDurationSeconds": null, "serverRevision",
  "createdAt", "updatedAt" }
```

**`POST /entries` (request)** — `content` (1–20000), `source`,
`chatMessageId?`, `occurredAt?`, `mediaDurationSeconds?`.
Refinamento Zod: `source === 'chat'` ⟺ `chatMessageId` presente.

**`GET /entries` (query)** — `cursor?`, `limit?` (1–50), `source?`,
`dateFrom?`, `dateTo?`.

**`GET /entries/search` (query)** — `q?`, `source?`, `dateFrom?`, `dateTo?`,
`limit?`. `meta.mode ∈ {filter_only, semantic}`.

**`POST /media/ocr`** — `{image: base64, mimeType: "image/jpeg|png|webp"}` →
`{text, confidence: "high"|"low"}`.

**`POST /chat/sessions/:id/insight`** — `{triggerType, triggerKey}` →
`Insight{id,sessionId,triggerType,triggerKey,status,content,errorCode,dismissedAt,createdAt}`.

**`POST /export/summary`** — `{periodStart: string|null, periodEnd: string|null,
includeNarrative: boolean}` → 202 `{jobId, status:"pending"}`.

**`GET /export/:jobId/status`** — `{jobId, status, narrativeStatus, entryCount,
errorCode, narrativeErrorCode, downloadAvailable}`.

**`PATCH /account/settings`** — `{displayName?, persona?, biometricEnabled?}`,
schema `.strict()` (qualquer outra chave, `email` inclusive → `VALIDATION_ERROR`).

**`DELETE /account`** — `{confirmation: "DELETE"}`.

### 10.4 Taxonomia de erros — onde cada código nasce

| Código | HTTP | Origem no código |
|---|---|---|
| `AUTH_EXPIRED` | 401 | gateway (sem `Authorization`); `auth-refresh` |
| `AUTH_INVALID` | 401 | gateway (token rejeitado); `auth-signup`, `auth-login` |
| `VALIDATION_ERROR` | 400 | gateway (Zod/JSON); cursores; `chat-messages-retry` |
| `NOT_FOUND` | 404 | 6 handlers com `UUID_RE`/`findById`; `profiles-repo` (defensivo) |
| `PII_CHECK_FAILED` | 502 | `entries-create/pii.ts` (3 caminhos) |
| `EMBEDDING_FAILED` | 502 | `entries-search`, `rag.ts` |
| `AI_GENERATION_TIMEOUT` | 504 | `media-ocr/ocr.ts`, `dashboard-narrative-get`, insight (no corpo), worker (narrativa) |
| `OCR_NO_TEXT` | 400 | `media-ocr/ocr.ts` |
| `PAYLOAD_TOO_LARGE` | 413 | `media-ocr/handler.ts` |
| `EXPORT_EMPTY_PERIOD` | 400 | `export-summary-create` |
| `NETWORK_TIMEOUT` | 504 | **só** fault `timeout` |
| `RATE_LIMITED` | 429 | **só** fault `rate_limited` |
| `NETWORK_OFFLINE` | — | **nunca vira resposta**; fault `offline` não responde |

Fora da taxonomia: `REPLAY_MISS` (500, só em `replay_strict`) e
`INTERNAL_ERROR` (500, rede de segurança).

### 10.5 Contrato SSE

```
event: message_created
data: {"userMessageId":"…","assistantMessageId":"…","seq":4}

event: context
data: {"retrievedEntryIds":["…","…"]}

event: token
data: {"text":"pedaço de texto"}
        (zero ou mais, na ordem de geração ou fatiado 32c/15ms se hit)

event: done
data: {"assistantMessageId":"…","finishReason":"end_turn"}
   — ou —
event: error
data: {"code":"AI_GENERATION_TIMEOUT","message":"…","retryable":true}
```
`retrievedEntryIds` no evento `context` vem **ordenado por relevância**; a
cópia alfabética usada na `cache_key` não afeta esta lista.

---

## 11. Integrações externas

### 11.1 Anthropic

| Operação | Modelo | Mecanismo | `maxTokens` | Onde |
|---|---|---|---|---|
| PII | Haiku 4.5 | tool use forçado | 4096 | `entries-create/pii.ts` |
| OCR | Haiku 4.5 | tool use + imagem base64 | 4096 | `media-ocr/ocr.ts` |
| Chat | Sonnet 5 | **streaming** | 2048 | `_shared/chat-generation.ts` |
| Insight | Haiku 4.5 | texto | 256 | `chat-insight-create/generation.ts` |
| Narrativa (export) | Haiku 4.5 | texto | 512 | `export-worker/worker.ts` |
| Narrativa (dashboard) | Haiku 4.5 | texto | 512 | `dashboard-narrative-get/handler.ts` |

Endpoint `https://api.anthropic.com/v1/messages`, header
`anthropic-version: 2023-06-01`, `x-api-key`. Timeout de 30s via
`AbortSignal.timeout` em ambos os caminhos (JSON e streaming).
Tratamento de erro: `AnthropicApiError` é convertido pelo **módulo de negócio**,
nunca pelo cliente — daí `PII_CHECK_FAILED` num caso e
`AI_GENERATION_TIMEOUT` noutro.

### 11.2 Voyage

`https://api.voyageai.com/v1/embeddings`, `voyage-4`, `output_dimension: 1024`,
`input_type` `document`|`query`. Timeout de 30s. Valida o tamanho do vetor
recebido. Consumidores: `entries-create/embedding.ts` (nunca lança),
`entries-search` e `rag.ts` (lançam `EMBEDDING_FAILED`),
`scripts/backfill-seed-embeddings.ts`.

### 11.3 GoTrue

`/auth/v1/signup`, `/auth/v1/token?grant_type=password`,
`/auth/v1/token?grant_type=refresh_token`, `/auth/v1/logout`, `/auth/v1/user`.
O último é chamado pelo gateway **a cada requisição autenticada**.

### 11.4 PostgREST e Storage

Todo acesso a dados passa pelo `supabase-js` (PostgREST). Onde o construtor de
query fluente não dá conta, o projeto usa RPC — foi essa limitação que motivou
`entries_search_by_embedding` (não ordena por expressão arbitrária) e
`dashboard_aggregate_counts` (não faz `GROUP BY`).

Storage: `upload` (worker, `service_role`), `createSignedUrl` (download,
cliente do usuário), `list`/`remove` (purga da conta, cliente do usuário).

### 11.5 Cache de replay e determinismo

O que torna a IA reprodutível entre `ciclo-a` e `ciclo-b`:

1. `PROMPT_VERSION` fixa o template (D5, prompts montados no servidor).
2. O envelope canônico normaliza a entrada de cada operação (seção 5.7).
3. `cache_key = sha256(json canônico com chaves ordenadas)`.
4. Grava-se o cache **uma vez** (`record` em `ciclo-a`), exporta-se
   (`replay-cache-export.ts`) e importa-se em `ciclo-b`
   (`replay-cache-import.ts`, que **se recusa** a importar sobre cache não
   vazio sem `--force`).
5. Em `replay_strict`, qualquer miss vira `REPLAY_MISS` — o gate falha em vez
   de silenciosamente chamar a IA de verdade.

Gravar o cache duas vezes anula o mecanismo: a IA não é determinística entre
chamadas reais, e os dois ciclos deixariam de ser comparáveis sem que nada no
HTTP acusasse.

---

## 12. Testes

### 12.1 Unidade (Deno) — 56 arquivos `*.test.ts`

Cobrem `contracts/zod/`, `supabase/functions/_shared/` (incluindo `ai/`), cada
`handler.ts` e módulo local, `scripts/` e `tests/determinism/`.
Sem dependência externa de asserção (`_shared/_test_utils.ts`).
Injeção de dependência é o padrão que torna isso possível: `fetchImpl`,
`delayFn`, `verifyAccessToken`, `logFaultInjection`, `nowIso`, `replayDelayFn`.

```bash
deno test -A --parallel        # tarefa "test" do deno.json
```

### 12.2 pgTAP — 20 arquivos

```bash
supabase test db
```

| Arquivo | Cobre |
|---|---|
| `rls_profiles`, `rls_entries`, `rls_tags`, `rls_entry_tags`, `rls_chat_sessions`, `rls_chat_messages`, `rls_insights`, `rls_export_jobs` | Mesmo roteiro de 6 asserções: RLS habilitada, RLS **forçada**, isolamento positivo, isolamento negativo (0 linhas, não erro), escrita cruzada bloqueada, `anon` sem leitura |
| `rls_experiment` | `authenticated`/`anon` sem acesso a nenhuma tabela de `experiment` |
| `rls_storage_exports` | Mesmo roteiro, aplicado à política do bucket |
| `constraints` | Índice de idempotência do RF10, UNIQUE de insight, CHECK `source`/`chat_message_id`, UNIQUE `(session_id, seq)` |
| `triggers` | `server_revision` incrementa; `user_message_count` só em `role='user'` |
| `cascade_delete` | Apagar `auth.users` não deixa órfão em nenhuma das 8 tabelas |
| `entries_search_rpc` | Ordem por distância, desempate `id ASC`, isolamento por RLS |
| `dashboard_aggregate_rpc` | Agregação por dia/origem, filtro de período, isolamento |
| `experiment_rpc` | As 3 RPCs funcionam para `authenticated` sem acesso direto às tabelas |
| `account_delete_rpc` | `delete_own_account` só apaga a própria conta; sessão/refresh token somem junto |
| `chat_stale_streaming` | Mensagem presa > 60s vira `failed` |
| `export_queue` | Fila + consumidor (limitado: `pgmq`/`pg_net` indisponíveis no sandbox) |
| `export_fault` | Repasse do `ai_timeout` para o worker |

### 12.3 Contrato HTTP (Hurl) — 27 arquivos

```bash
hurl --jobs 1 --variable base_url=... --variable test_account_password=... tests/hurl/*.hurl
```
`--jobs 1` é obrigatório no projeto. Ver `tests/hurl/README.md` para
pré-requisitos (o worker só desperta com `experiment.worker_config` populada —
use `scripts/configure-worker.ts`).

Padrão por endpoint: caminho feliz, corpo inválido → `VALIDATION_ERROR`, sem
token → `AUTH_EXPIRED`, recurso alheio → `NOT_FOUND`. Mais as suítes nomeadas:
`idempotencia_rf10`, `tags_embutidas`, `busca_and`, `busca_semantica`,
`sse_ordem`, `retry_chat`, `insight_unico`, `insight_falha`,
`export_resiliente`, `export_vazio`, `dashboard_degradado`, `email_readonly`,
`falhas_15`.

`falhas_15.hurl` cobre **10 dos 15** cenários (`timeout` + `malformed` × 5
endpoints); os 5 de `offline` estão em `scripts/verify-fault-injection-log.ts`
— o Hurl não consegue "esperar que uma requisição nunca responda" sem
`--max-time`, que é cli-only e derrubaria as entradas de `timeout`. Custo
esperado: ~3 min (5 × 35s).

Os 5 endpoints congelados de injeção: `POST /entries`,
`POST /chat/sessions/:id/messages`, `POST /media/ocr`, `POST /export/summary`,
`POST /chat/sessions/:id/insight`.

### 12.4 Determinismo

```bash
bash tests/determinism/run.sh
```

Fluxo: uma passada em `record` (popula o cache chamando a IA de verdade) →
`replay-cache-export.ts` → duas execuções independentes, banco recém-criado
cada uma, ambas em `replay_strict` com o cache importado → `compare.ts`.
Zero `REPLAY_MISS` esperado; qualquer um falha o job.

`normalize.ts` transforma cada relatório `--report-json` do Hurl num
transcript comparável com `===`:

| Regra | Motivo |
|---|---|
| UUID e timestamp ISO → placeholder **posicional** (`<uuid:N>`, `<ts:N>`), contador único por execução | Pega não só "os valores mudam" mas "a **relação** entre eles mudou" |
| `VOLATILE_HEADERS`: `date`, `content-length`, `x-kong-proxy-latency`, `x-kong-upstream-latency` | Latência do Kong nunca é reproduzível — derrubou a 1ª comparação real |
| `Location` de download: query string → `?token=<url-assinada-sempre-nova>` | URL assinada embute `iat`/`exp` e HMAC |
| Corpo de `auth-login`/`refresh`/`signup` → placeholder | Sessão GoTrue nova a cada chamada, por desenho |
| Resposta de `export-status-get` com status **não terminal** → excluída inteira | O `pg_cron` acorda em relógio de parede; duas execuções pegam `pending`/`processing` em tentativas diferentes |
| Posição de **saída**, não `entry.index` do Hurl | Se uma execução precisar de menos tentativas que a outra, tudo depois continuaria deslocado |
| Timestamp aceita `Z` **e** `+00:00` | O Postgres serializa `timestamptz` com offset numérico; o código gera `Z` |

### 12.5 Scripts de verificação

- `verify-fault-injection-log.ts` — dispara os 5 `offline` com timeout de
  cliente curto e confere as 15 combinações em `fault_injection_log`.
  Pré-requisito: rodar `falhas_15.hurl` antes.
- `prove-rf06.ts` — prova que pelo menos 1 dos 3 pares semânticos plantados
  aparece no top-5.
- `schema-hash.ts` — texto canônico + SHA-256 da estrutura de `public` e
  `experiment` (extensões, colunas, RLS, constraints, índices, triggers,
  funções, políticas, grants de tabela), para comparar `dev`/`ciclo-a`/`ciclo-b`.
  Falha alto se qualquer índice usar `USING hnsw`/`USING ivfflat`.
  Não cobre `EXECUTE` de função por papel (limitação documentada).

### 12.6 CI

`.github/workflows/ci.yml` — `push` em `main`, `pull_request`,
`workflow_dispatch`.

| Job | Faz |
|---|---|
| `contracts` | `deno test -A --parallel` + regenera o OpenAPI + `git diff --exit-code` |
| `determinism` | Instala Hurl 6.1.1, monta `.env.local` a partir de secrets, `supabase start`, gera as vars de OCR, roda `run.sh` |

---

## 13. Scripts operacionais

| Script | Função |
|---|---|
| `gen-openapi.ts` | Gera `contracts/openapi.yaml` de `contracts/zod/` |
| `openapi/zod-to-json-schema.ts` | Conversor Zod → JSON Schema usado acima |
| `gen-handoff-docs.ts` | Gera `docs/handoff/*` (taxonomia de erro de `errors.ts`, mapa de estados, selo, README) |
| `build-handoff-package.sh` | Monta o pacote completo num diretório externo. Nunca copia `supabase/functions/`, `contracts/zod/` ou `scripts/`; nunca toca credenciais |
| `schema-hash.ts` | Hash/diff de estrutura entre ambientes |
| `replay-cache-export.ts` | Exporta `ai_replay_cache` ordenado por `cache_key` |
| `replay-cache-import.ts` | Importa; **recusa** destino não vazio sem `--force`; ignora `hit_count`/`created_at` |
| `backfill-seed-embeddings.ts` | Preenche embeddings pendentes da conta A, **atrás do mesmo cache de replay** |
| `configure-worker.ts` | Popula `experiment.worker_config` sem depender de `psql` |
| `verify-fault-injection-log.ts` | Os 5 cenários `offline` + conferência das 15 linhas |
| `prove-rf06.ts` | Prova de viabilidade do RF06 |

Todos que tocam o banco conectam **direto no Postgres** (não via PostgREST),
porque `experiment` não é exposto pela API e ler catálogo do sistema não tem
rota.

Nota registrada no `backfill-seed-embeddings.ts`: antes de ser religado ao
cache, ele chamava a Voyage a cada `db reset`, e a Voyage **não** garante o
mesmo vetor bit a bit — `entries-search` devolvia a mesma entrada na mesma
ordem, mas com `similarity` diferente entre ciclos (0,4852 vs 0,4845),
derrubando a comparação byte a byte.

---

## 14. Padrões e convenções de código

**Estruturais**
1. `index.ts` é só fiação; regra fica em `handler.ts`, testável sem `Deno.serve`.
2. Módulo local quando a lógica é de um endpoint só (`pii`, `embedding`, `ocr`,
   `generation`, `cursor`); promoção para `_shared/` quando um segundo endpoint
   precisa (foi o caso de `chat-generation.ts`).
3. Repositório por domínio; nenhum handler escreve SQL/PostgREST direto — com
   duas exceções conscientes (`account-settings-update` e as chamadas `rpc()`
   em `export-summary-create`/`account-delete`).
4. `env` lido **uma vez** no topo do `index.ts`, fora do handler de requisição.

**De erro**
5. `throwError(...)` é o único ponto de lançamento; nunca `throw new CerneError`.
6. Cliente genérico nunca decide taxonomia — `AnthropicApiError`/`VoyageApiError`/
   `GoTrueApiError` são convertidos pelo módulo de negócio.
7. Módulos de fallback **nunca lançam**: `embedding.ts` e
   `chat-insight-create/generation.ts` devolvem `{status:"failed"}`.
8. `NOT_FOUND` uniforme para recurso inexistente ou alheio; `UUID_RE` barra id
   malformado antes do banco.

**De determinismo**
9. Nenhum `new Date()` fora de `clock.ts` (exceto `export-worker`).
10. Toda ordenação tem desempate explícito por `id ASC`.
11. Paginação keyset, nunca OFFSET.
12. Toda chamada de IA passa por `withReplay` (exceto o streaming, documentado).

**De testabilidade**
13. Dependência externa sempre injetável (`fetchImpl`, `delayFn`, `nowIso`, …).
14. Constantes congeladas exportadas para o teste conferir o valor exato
    (`TIMEOUT_FAULT_DELAY_MS`, `RAG_TOP_K`, `REPLAY_CHUNK_SIZE`).

**De estilo**
15. TypeScript `strict` + `noUncheckedIndexedAccess`; `readonly` em interfaces
    de dados; `deno fmt` com `lineWidth: 100`.
16. Linhas do banco continuam `snake_case` até a borda de serialização.
17. Comentário de cabeçalho em todo arquivo com: tarefa de origem, seção do
    plano, decisões tomadas e **achados reais** (o que quebrou e por quê).
    Este é o padrão mais forte e mais consistente do repositório.
18. Todo comentário em português; identificadores em inglês.

---

## 15. Observações técnicas

Divergências, inconsistências e áreas frágeis observadas na leitura do código.
**Esta seção apenas reporta.** Cada item tem um identificador estável
(`D-NN`); as propostas de correção estão em
[`DIVERGENCIAS_E_INCONSISTENCIAS.md`](DIVERGENCIAS_E_INCONSISTENCIAS.md).

### Contrato publicado × implementação

- **D-01** — `contracts/openapi.yaml` publica caminhos REST
  (`/entries/{id}`, `/chat/sessions/{id}/messages/{userMessageId}/retry`) que
  **não existem em runtime**: a URL real é `{base}/entries-get/<id>`,
  `{base}/chat-messages-retry/<id>/<userMessageId>`. O YAML também **não tem
  bloco `servers:`**, então nenhuma URL base é derivável dele. O próprio código
  registra a divergência em `chat-messages-retry/index.ts:8-13`.
- **D-02** — No YAML, `/entries/{id}` aparece antes de `/entries/search`. Num
  roteador REST convencional, `search` seria capturado como `:id`. Não afeta o
  deploy atual (uma função por endpoint).
- **D-03** — `errorResponseSchema` fecha `code` nos 13 códigos, mas o gateway
  pode devolver `REPLAY_MISS` e `INTERNAL_ERROR` (500), e o fault `malformed`
  devolve HTTP 200 com corpo fora de qualquer envelope (este último é
  deliberado — é o objetivo da falha).
- **D-04** — `entries-search` calcula `similarity: 1 - distance`. A distância
  de cosseno do pgvector vai de 0 a 2, então o valor pode ser **negativo**, mas
  `searchResultSchema` exige `min(0).max(1)`.
- **D-05** — `limit` em `cursorPaginationQuerySchema`,
  `listEntriesQuerySchema` e `searchEntriesQuerySchema` é
  `.default(20).optional()`. O `.optional()` envolve o `.default()`, então o
  default **nunca se aplica** quando a chave está ausente. Os handlers
  compensam com `?? DEFAULT_LIMIT`, mas o OpenAPI publica um default que o Zod
  não aplica.
- **D-11** — `export_jobs.error_code` nunca é preenchido: o `catch` externo do
  worker grava só `status='error'` e `completed_at`. O contrato expõe
  `errorCode` como string livre; na prática só `narrativeErrorCode` recebe
  valor (sempre `AI_GENERATION_TIMEOUT`).

### Campos e estados sem caminho de escrita

- **D-06** — `entries.updated_at` **nunca é reescrito**. Nem
  `markEmbeddingReady` nem `markEmbeddingFailed` tocam a coluna, e não há
  trigger. Na prática `Entry.updatedAt` é sempre igual a `createdAt`.
- **D-07** — `docs/handoff/selo_sincronizacao.md` (entregue aos dois ciclos)
  define `updatedAt` como "timestamp da última escrita no servidor para aquela
  entrada" — descrição que D-06 torna falsa. Somado a isso, `X-Data-Version`
  só é emitido por `entries-list` e `dashboard-aggregate-get`; `entries-create`,
  `entries-get` e `entries-search` carregam `serverRevision` no corpo mas não
  emitem o header.
- **D-08** — `serverRevision` é campo de `Entry` no contrato, mas é coluna de
  `profiles`, não de `entries`. Todos os itens de uma página trazem o mesmo
  número, e não existe sinal de mudança **por entrada**.
- **D-09** — `insights.status='dismissed'` e `insights.dismissed_at` existem no
  schema e no contrato, mas nenhum endpoint os escreve. O documento de
  requisitos (`ux/Requisitos_e_Fluxo_de_Telas_TCC.md:63`) trata "descartar o
  insight" como comportamento de tela, satisfazível no cliente — a coluna fica
  sem uso.
- **D-10** *(contexto, não defeito)* — `tags`/`entry_tags` são populadas só
  pelo seed; nenhum endpoint cria, apaga ou filtra por tag. Isso é **decisão
  documentada e intencional** (`ux/Requisitos_e_Fluxo_de_Telas_TCC.md:43,167`):
  a categorização não recebe implementação funcional em nenhum dos dois ciclos.
  Registrado aqui só para quem ler o schema e estranhar.
- **D-17** — `chat-repo.nextSeq` é exportada e testada, mas não é usada no
  caminho de produção: `chat-messages-send` calcula o `seq` a partir do
  histórico que já carregou.

### Consistência interna

- **D-12** — Intervalo de data inconsistente: `listEntries` e
  `findEntriesByFilters` usam `lte` para `dateTo`; `dashboard_aggregate_counts`,
  `fetchEntriesForNarrative`, `countEntriesInPeriod` e `fetchEntriesForExport`
  usam `<` para `periodEnd`. Uma entrada exatamente no limite aparece na lista
  e não no agregado.
- **D-13** — Os dois endpoints de dashboard sempre passam `periodEnd: null`. O
  parâmetro existe nas RPCs e nos repositórios, mas nunca é exercitado por
  nenhum endpoint.
- **D-14** — `withReplay` trata `record` e `replay` de forma **idêntica**. A
  distinção existe só no processo de operação, não no código.
- **D-18** — Duplicação estrutural: `UUID_RE` repetido em 6 handlers;
  `base64UrlEncode`/`Decode` em 3 arquivos (`entries-list/cursor.ts`,
  `chat-sessions-list/cursor.ts`, `_shared/gotrue.ts`);
  `DOWNLOADABLE_STATUSES` em 2; `piiSpanSchema` em `contracts/zod/common.ts`
  e em `entries-create/pii.ts`; `RetrievedEntry` em `prompts.ts` e `rag.ts`;
  `ReplayStatus` em `replay.ts` e `chat-generation.ts`; `UNIQUE_VIOLATION`
  em `entries-repo.ts` e `chat-repo.ts`.

### Áreas frágeis

- **D-15** — `PROMPT_VERSION` desconhecido faz `templateFor` lançar `Error`
  comum **dentro do handler** — vira 500 `INTERNAL_ERROR`, não um erro de
  configuração diagnosticável na subida da função.
- **D-16** — `export-worker` não passa por `clock.ts`: usa `new Date()` e
  portanto ignora `X-Test-Now`. Sem impacto no gate de determinismo atual (o
  roteiro baixa com `?format=raw`, e `completed_at` é normalizado), mas o
  timestamp impresso no PDF é relógio de parede real.
- **D-19** — As 3 RPCs de `experiment` têm `GRANT EXECUTE` para
  `authenticated`: um usuário autenticado pode escrever no log de falhas e no
  cache de replay fora do gateway. Trade-off registrado na própria migração
  0010 — suja infraestrutura de experimento, nunca dado de outro usuário.
- **D-20** — `cron.schedule('export-dispatch-pending-jobs', '15 seconds', …)`
  usa sintaxe de intervalo sub-minuto, que exige **pg_cron ≥ 1.5**. Nenhuma
  migração fixa ou verifica a versão.
- **D-21** — O dispatcher lê da fila com `vt=60` mas chama `pgmq.delete`
  imediatamente após um `net.http_post` **assíncrono**, sem confirmação de
  entrega. Não há retry de despacho: um job cujo POST falhe fica preso em
  `pending` indefinidamente. Trade-off registrado na migração 0014.
- **D-22** — `ai_timeout` é consumido por apenas 3 handlers
  (`chat-insight-create`, `dashboard-narrative-get`, `export-summary-create`).
  `entries-create` (PII) e `media-ocr` estão entre os 5 endpoints congelados de
  injeção de falha, mas ignoram esse tipo.
- **D-30** — O gateway faz `GET /auth/v1/user` no GoTrue a **cada requisição
  autenticada**, sem verificação local de assinatura nem cache. É uma ida à
  rede no caminho quente de todos os 20 endpoints com sessão.
- **D-31** — `account-delete` envolve `purgeExportsBucket` em
  `.catch(() => {})`. Se a purga falhar, a conta é apagada mesmo assim e os
  objetos ficam sem dono no bucket (inacessíveis por política, mas residuais).
  Trade-off registrado no cabeçalho do handler.
- **D-32** — `createExportJob` congela `entry_count` no instante do pedido; o
  worker não recalcula. Se entradas forem criadas entre o pedido e o
  processamento, `entryCount` e o conteúdo do arquivo divergem.
- **D-34** — `POST /entries` aguarda a Voyage **de forma síncrona** antes de
  responder. O fallback existe (nunca falha a entrada), mas a latência do
  endpoint fica acoplada à do provedor, limitada pelos 30s do `AbortSignal`.
- **D-35** — `mark_stale_streaming_chat_messages` marca `failed` qualquer
  mensagem em `streaming` criada há mais de 60s, medindo a partir de
  `created_at` (`chat_messages` não tem `updated_at`). Uma geração legítima que
  passe de 60s seria marcada `failed` **enquanto ainda está transmitindo** —
  o stream continuaria e o passo 8 sobrescreveria para `complete`, mas há uma
  janela de estado inconsistente.
- **D-33** — `entries_search_by_embedding` e `dashboard_aggregate_counts` são
  `SECURITY INVOKER` e não recebem `user_id`: o isolamento depende
  **inteiramente** da RLS, sem o filtro explícito redundante que o resto do
  código mantém. Correto por desenho, registrado por ser o único ponto sem
  defesa em profundidade.

### Processo e ambiente

- **D-23** — O CI tem apenas `contracts` e `determinism`. **pgTAP e Hurl não
  rodam no CI** — lacuna assumida no comentário do próprio workflow.
- **D-24** — Contradição interna de status: `.github/workflows/ci.yml` afirma
  que faltam 4 secrets ("sem eles este job falha"), mas
  `tests/determinism/normalize.ts` documenta achados reais da "1ª execução real
  do job `determinism` no GitHub Actions após o congelamento da Fase 7".
  Um dos dois textos está desatualizado.
- **D-25** — `docs/roteiro_de_validacao.md:3` está marcado como "rascunho do
  agente, pendente de aprovação do Wagner", apesar de o roteiro ter sido
  executado e a Fase 7 ter congelado. O arquivo vai no pacote de handoff.
- **D-26** — `scripts/prove-rf06.ts` importa `postgres` por URL
  (`https://deno.land/x/postgresjs@v3.4.5/mod.js`) em vez do import map do
  `deno.json`, divergindo dos outros scripts de banco. O `deno.json` declara
  `postgres`, mas nenhum código em `supabase/functions/` o usa — é dependência
  exclusiva de `scripts/`.
- **D-27** — `verify_jwt = false` nas 24 funções, inclusive nas 20 que exigem
  sessão. Deliberado e documentado no `config.toml`, mas significa que a
  autenticação é 100% responsabilidade do código do projeto.
- **D-28** — `NETWORK_OFFLINE` tem `http: null` e nunca vira resposta;
  `NETWORK_TIMEOUT` e `RATE_LIMITED` só nascem de injeção de falha. Nenhuma
  condição real do servidor produz esses três códigos.
- **D-29** — `auth-logout` **engole** qualquer `GoTrueApiError` e sempre
  devolve `{ok:true}`. Decisão deliberada e documentada, registrada aqui
  porque o cliente não consegue distinguir logout efetivado de logout que
  falhou no provedor.
