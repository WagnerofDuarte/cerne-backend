# Divergências e inconsistências — backend Cerne

> Complemento das seções 15 de [`DOCUMENTACAO_TECNICA.md`](DOCUMENTACAO_TECNICA.md)
> e 13 de [`DOCUMENTACAO_DIDATICA.md`](DOCUMENTACAO_DIDATICA.md), que apenas
> **reportam**. Aqui cada item ganha uma proposta de solução.
>
> **Nada aqui foi aplicado.** São propostas para decisão do Wagner. O backend
> está congelado em `backend-v1.0-frozen`; qualquer mudança entra por PR
> (`CLAUDE.md`).

## Sumário

- [Como ler](#como-ler)
- [Quadro-resumo](#quadro-resumo)
- [P1 — Bloqueia os ciclos comparativos](#p1--bloqueia-os-ciclos-comparativos)
- [P2 — Custa tempo dos dois ciclos](#p2--custa-tempo-dos-dois-ciclos)
- [P3 — Consistência interna e áreas frágeis](#p3--consistência-interna-e-áreas-frágeis)
- [P4 — Higiene, sem impacto observável](#p4--higiene-sem-impacto-observável)
- [Contexto registrado, não é defeito](#contexto-registrado-não-é-defeito)

---

## Como ler

**Identificadores** (`D-01`…`D-35`) são estáveis e batem com os das duas
documentações.

**Prioridade:**

| Nível | Critério |
|---|---|
| **P1** | Impede ou distorce o trabalho de um dos ciclos comparativos — ameaça a validade do experimento |
| **P2** | Não impede, mas consome tempo dos dois times (simétrico, não distorce a comparação) |
| **P3** | Inconsistência interna ou fragilidade real, sem impacto visível hoje |
| **P4** | Higiene de código/processo |

**Custo** é esforço estimado de aplicação, não de decisão.

**Toca backend?** distingue o que muda comportamento do servidor (exige
reabrir o congelamento com cuidado) do que só muda documento ou arquivo gerado.

---

## Quadro-resumo

| ID | Assunto | Prioridade | Toca backend? | Custo |
|---|---|---|---|---|
| D-01 | OpenAPI publica caminhos inexistentes, sem `servers:` | **P1** | não (gerador/doc) | baixo |
| D-07 | `selo_sincronizacao.md` promete sinal por entrada que não existe | **P2** | não (gerador) | baixo |
| D-24 | Contradição de status entre `ci.yml` e `normalize.ts` | **P2** | não (comentário) | trivial |
| D-25 | Roteiro de validação marcado como rascunho | **P2** | não (doc) | trivial |
| D-02 | Ordem de `paths` no YAML | P3 | não (gerador) | baixo |
| D-03 | Códigos fora do `errorCodeEnum` | P3 | não (contrato/doc) | baixo |
| D-04 | `similarity` pode ser negativo | P3 | sim (1 linha) | baixo |
| D-05 | `limit`: `.default().optional()` | P3 | sim (contrato) | baixo |
| D-06 | `entries.updated_at` nunca reescrito | P2 | sim (migração) | médio |
| D-08 | `serverRevision` é por usuário, não por entrada | P3 | não (doc) | baixo |
| D-11 | `error_code` nunca preenchido no worker | P3 | sim (1 linha) | baixo |
| D-12 | `lte` × `<` no filtro de data | P3 | sim (repos) | médio |
| D-13 | `periodEnd` sempre `null` | P4 | não | trivial |
| D-14 | `record` e `replay` idênticos | P4 | não (doc) | trivial |
| D-15 | `PROMPT_VERSION` inválido vira 500 | P3 | sim (1 checagem) | baixo |
| D-16 | Worker ignora `X-Test-Now` | P4 | sim | baixo |
| D-17 | `nextSeq` não usada | P4 | sim (remoção) | trivial |
| D-18 | Duplicação estrutural | P4 | sim (refactor) | médio |
| D-19 | RPCs de `experiment` abertas a `authenticated` | P3 | sim (migração) | médio |
| D-20 | `cron.schedule('15 seconds')` exige pg_cron ≥ 1.5 | P3 | não (verificação) | baixo |
| D-21 | Fila sem retry de despacho | P3 | sim (migração) | médio |
| D-22 | `ai_timeout` ignorado por 2 dos 5 endpoints | P3 | sim | baixo |
| D-23 | CI sem `db`/`api` | P2 | não (workflow) | médio |
| D-26 | `prove-rf06.ts` importa fora do import map | P4 | sim (script) | trivial |
| D-27 | `verify_jwt=false` nas 24 funções | P4 | não | — |
| D-28 | 3 códigos só existem por injeção | P4 | não (doc) | trivial |
| D-29 | `auth-logout` engole erro | P4 | não | — |
| D-30 | Ida ao GoTrue por requisição | P3 | sim (gateway) | médio |
| D-31 | Purga do bucket pode deixar resíduo | P4 | sim | médio |
| D-32 | `entry_count` congelado no pedido | P4 | sim (worker) | baixo |
| D-33 | RPCs sem filtro redundante de `user_id` | P4 | não | — |
| D-34 | `POST /entries` síncrono na Voyage | P3 | sim (arquitetura) | alto |
| D-35 | Job de stale pode marcar `failed` stream vivo | P3 | sim (migração) | baixo |
| D-09 | `dismissed` sem endpoint | contexto | não | — |
| D-10 | `tags` sem endpoint | contexto | não | — |

---

## P1 — Bloqueia os ciclos comparativos

### D-01 — O OpenAPI entregue publica caminhos que não existem

**O que é.** `contracts/openapi.yaml` publica `/entries/{id}`,
`/chat/sessions/{id}/messages/{userMessageId}/retry` etc. A URL real é
`{base}/entries-get/<id>`, `{base}/chat-messages-retry/<id>/<userMessageId>` —
uma Edge Function por endpoint, sem roteador. O arquivo também não tem bloco
`servers:`, então nem a URL base é derivável dele.

**Por que é P1.** O `build-handoff-package.sh` entrega esse YAML como *o*
contrato da API. Um time que gere cliente a partir dele toma 404 em toda
chamada. Eles se recuperam olhando `testes_contrato/*.hurl` (que tem as URLs
reais), mas o custo **não é simétrico**: penaliza justamente o ciclo que se
apoia mais na especificação — e "qual metodologia entrega mais rápido" é a
variável medida. É ameaça à validade, não inconveniência.

**Proposta.** Em `scripts/gen-openapi.ts`, acrescentar:

1. Um bloco `servers:` com a URL base do ambiente
   (`{FUNCTIONS_BASE_URL}`, parametrizável por variável de servidor).
2. Em cada operação, um `x-cerne-function` com o nome do diretório, e a regra
   de montagem de URL no `info.description`.
3. Uma tabela **caminho do contrato → nome da função** no
   `docs/handoff/README.md` (gerado por `gen-handoff-docs.ts`).

Alternativa de custo zero em código, se preferir não mexer no gerador antes do
congelamento: publicar a tabela de mapeamento só no `README.md` do pacote de
handoff e no topo do `roteiro_de_validacao.md`. Resolve a confusão, mas não
conserta o cliente gerado automaticamente.

**Custo.** Baixo. Não muda comportamento do servidor — só o artefato gerado.

---

## P2 — Custa tempo dos dois ciclos

### D-07 — O documento do selo promete um sinal que a API não dá

**O que é.** `docs/handoff/selo_sincronizacao.md` define `updatedAt` como
"timestamp da última escrita no servidor para aquela entrada". Mas
`entries.updated_at` nunca é reescrito (D-06), e `serverRevision` é contador
**por usuário** (D-08). Nenhum dos dois campos oferecidos dá sinal de mudança
**por entrada**. Some-se a isso: `X-Data-Version` só sai em 2 dos 5 endpoints
de entrada.

**Impacto.** Os dois times implementam reconciliação a partir desse documento
e descobrem que o campo não se move. Na prática o selo ainda funciona, porque
`POST /entries` já devolve a linha no estado final — mas só depois de gastarem
tempo investigando.

**Proposta.** Corrigir o texto no gerador (`scripts/gen-handoff-docs.ts`),
deixando explícito:
- `serverRevision` é **por usuário** e é o único sinal que de fato se move;
- `updatedAt` de `Entry` hoje é igual a `createdAt` (entradas são imutáveis
  após criação — D3, não há `PATCH`/`DELETE /entries/:id`), então não serve
  como gatilho de reconciliação;
- `X-Data-Version` sai em `GET /entries` e `GET /dashboard/aggregate`.

Opcionalmente, emitir `X-Data-Version` também em `entries-create`,
`entries-get` e `entries-search` — são 3 linhas, e uniformiza o contrato.

**Custo.** Baixo (só doc) ou baixo+ (com as 3 linhas de header).

### D-24 — `ci.yml` e `normalize.ts` contam histórias diferentes

**O que é.** O workflow afirma que faltam 4 secrets e que "sem eles este job
falha". `tests/determinism/normalize.ts` documenta achados reais da "1ª
execução real do job `determinism` no GitHub Actions após o congelamento da
Fase 7". Os dois não podem estar certos.

**Impacto.** Quem ler o workflow conclui que o gate central do experimento
nunca rodou. Se o gate de fato rodou, o comentário está minando a credibilidade
do próprio instrumento.

**Proposta.** Confirmar qual está certo e atualizar o bloco de comentário do
`ci.yml`, com data: ou "secrets cadastrados em DD/MM, job verde desde então",
ou a lista do que ainda falta.

**Custo.** Trivial.

### D-25 — Roteiro de validação ainda marcado como rascunho

**O que é.** `docs/roteiro_de_validacao.md:3`: "Status: rascunho do agente,
pendente de aprovação do Wagner" — apesar de o roteiro ter sido executado e a
Fase 7 ter congelado. O arquivo vai no pacote de handoff.

**Impacto.** Os dois ciclos recebem, como parte do instrumento congelado, um
documento que se declara não aprovado.

**Proposta.** Como o próprio arquivo já prevê ("depois de aprovado, esta linha
deve virar uma confirmação com data"), substituir por
`Aprovado por Wagner em DD/MM/AAAA` — ou registrar o que falta aprovar.

**Custo.** Trivial.

### D-23 — pgTAP e Hurl não rodam no CI

**O que é.** O workflow tem só `contracts` e `determinism`. As 20 suítes pgTAP
e as 27 Hurl dependem de execução manual.

**Impacto.** Uma regressão de RLS ou de contrato HTTP só apareceria se alguém
lembrasse de rodar localmente. Com o backend congelado o risco cai muito, mas
qualquer PR pós-congelamento (inclusive de correção de defeito D16) passa sem
essa rede.

**Proposta.** Acrescentar um job `db` que faz `supabase start` +
`supabase test db`. O job `determinism` já prova que a orquestração do Supabase
CLI funciona no runner, então o custo incremental é pequeno. Um job `api`
(Hurl) é mais caro por causa dos ~3 min de `falhas_15.hurl` — vale separar
essa suíte e rodar o resto.

**Custo.** Médio.

---

## P3 — Consistência interna e áreas frágeis

### D-04 — `similarity` pode violar o próprio schema

`1 - distance` fica negativo quando a distância de cosseno passa de 1, mas o
schema exige `min(0).max(1)`.

**Proposta.** Grampear no handler: `Math.max(0, 1 - distance)` — uma linha em
`entries-search/handler.ts`. Alternativa: relaxar o schema para `min(-1)`.
Prefira o grampo: similaridade negativa não tem uso no app e um cliente com
validação estrita quebraria.

### D-05 — `limit` com `.default(20).optional()`

O `.optional()` envolve o `.default()`, então o default nunca se aplica. Os
handlers compensam, mas o OpenAPI publica um default fictício.

**Proposta.** Trocar por `.default(20)` sem o `.optional()` nos três schemas
(`common.ts`, `entries.ts`). O tipo resultante deixa de ser opcional na saída,
o que torna o `?? DEFAULT_LIMIT` dos handlers redundante — remover junto.

### D-06 — `entries.updated_at` nunca é reescrito

**Proposta.** Trigger `BEFORE UPDATE` em `entries` com
`new.updated_at = now()`, em migração nova (nunca editar migração aplicada).
Isso também torna verdadeira a descrição do D-07. Ponto de atenção: o trigger
passaria a mexer em toda atualização de embedding — o que é exatamente o
comportamento esperado.

Se preferir não tocar no schema congelado, a alternativa é só documentar
(ver D-07) que a coluna é estática por desenho.

### D-11 — `error_code` nunca preenchido no `catch` do worker

**Proposta.** No `catch` externo de `processExportJob`, gravar
`error_code: "EXPORT_FAILED"` (ou o código que o Wagner preferir) junto com
`status: "error"`. Uma linha. Sem isso, `GET /export/:jobId/status` devolve
`status:"error"` com `errorCode: null` — o app não tem o que mostrar.

### D-12 — `lte` × `<` no filtro de data

Uma entrada exatamente no limite superior aparece em `GET /entries` e não no
agregado do dashboard.

**Proposta.** Padronizar em **semiaberto** (`[início, fim)`), que é a convenção
já majoritária (dashboard, export, narrativa): trocar `.lte("occurred_at",
dateTo)` por `.lt(...)` em `listEntries` e `findEntriesByFilters`, e registrar
a convenção no contrato (`dateTo` é exclusivo). Mudança observável — só com
aprovação explícita, já que altera resposta de endpoint congelado.

### D-15 — `PROMPT_VERSION` inválido vira 500 genérico

**Proposta.** Validar na leitura do ambiente: `readAiEnv`/`readWorkerEnv`
chamam uma função `assertKnownPromptVersion(v)` exportada por `prompts.ts`.
Como o env é lido no topo do `index.ts`, a função falha **na subida**, com
mensagem clara, em vez de virar 500 na primeira requisição.

### D-19 — RPCs de `experiment` abertas a `authenticated`

**Proposta.** A saída limpa exige tirar essas chamadas do caminho da Edge
Function de app, o que muda a arquitetura de fila (fora do escopo do
congelamento). Enquanto isso, a mitigação barata é exigir o `X-Test-Key` também
no lado do banco — passar um parâmetro extra às RPCs e conferir contra um
`current_setting`. Dado que o impacto é sujar infraestrutura de experimento
(nunca dado de usuário), **a recomendação é manter como está e não gastar o
orçamento de mudança aqui** — o trade-off já está registrado na migração 0010.

### D-20 — `cron.schedule('15 seconds')` exige pg_cron ≥ 1.5

**Proposta.** Acrescentar `pg_cron` à comparação de versão que
`scripts/schema-hash.ts` já faz (ele lista extensão + versão e `pg_cron` já
está na allowlist) e tornar isso um passo explícito do checklist de criação de
`ciclo-a`/`ciclo-b`: rodar `schema-hash.ts` nos três ambientes **antes** de
liberar. A rede de detecção já existe; falta torná-la obrigatória no roteiro.

### D-21 — Fila sem retry de despacho

**Proposta.** Mover o `pgmq.delete` para depois de uma confirmação, ou usar
`pgmq.archive` + um job de varredura que re-enfileira jobs em `pending` há mais
de N minutos. Custo médio, e só vale se o cenário "job preso" aparecer de fato
durante os ciclos — hoje ele é visível e auditável em `export_jobs`.

### D-22 — `ai_timeout` ignorado por `entries-create` e `media-ocr`

**Proposta.** Se a intenção é que os 5 endpoints congelados respondam aos 4
tipos aplicáveis, acrescentar `forceFailure: ctx.fault?.type === "ai_timeout"`
em `detectPii` e `performOcr`, seguindo o padrão já usado em
`chat-insight-create/generation.ts`. Se a intenção sempre foi cobrir só
`timeout`/`malformed`/`offline` nesses dois, documentar isso na tabela de
cenários — hoje o leitor não consegue distinguir omissão de decisão.

### D-30 — Ida ao GoTrue a cada requisição autenticada

**Proposta.** Verificar a assinatura do JWT localmente (o segredo/JWKS do
projeto está disponível) e só cair na chamada de rede quando a verificação
local não bastar. Remove uma ida à rede do caminho quente de 20 endpoints.
Ponto de atenção: verificação local não detecta token revogado antes de expirar
— avaliar se isso importa para o escopo do TCC (provavelmente não).

### D-34 — `POST /entries` aguarda a Voyage de forma síncrona

**Proposta.** Mover o embedding para um job de fila, como já é feito na
exportação: gravar com `embedding_status='pending'`, responder, e deixar um
worker preencher. É a solução arquiteturalmente correta, mas **alto custo** e
muda o contrato observável (o cliente passaria a ver `pending` e precisaria
reconciliar). Recomendação: **não mexer** durante o TCC — o fallback já protege
o dado, e a latência é limitada pelos 30s do `AbortSignal`.

### D-35 — Job de stale pode marcar `failed` um stream vivo

**Proposta.** Duas opções:
- **(a)** Elevar o limiar do job (ex.: 180s), mantendo a rede de segurança e
  saindo da faixa de uma geração legítima.
- **(b)** Acrescentar `updated_at` a `chat_messages` e medir a partir dele,
  tocando a coluna a cada lote de tokens — mais correto, mais caro, e adiciona
  uma escrita por token.

Recomendação: **(a)**. O limiar de 60s veio do plano, mas o risco real de
marcar `failed` uma geração viva supera o ganho de detectar 2 minutos mais cedo
um isolate morto.

---

## P4 — Higiene, sem impacto observável

| ID | Proposta |
|---|---|
| **D-02** | Emitir os `paths` em ordem determinística com as rotas mais específicas primeiro (`/entries/search` antes de `/entries/{id}`) em `gen-openapi.ts`. Cosmético hoje, mas evita a armadilha em qualquer cliente gerado |
| **D-03** | Documentar no contrato que 500 pode trazer `REPLAY_MISS`/`INTERNAL_ERROR` fora do enum, e que o fault `malformed` é fora do envelope **por desenho**. Alternativa: acrescentar `responses."500"` explícito no gerador |
| **D-08** | Só documentação — ver D-07 |
| **D-13** | Remover `periodEnd` da assinatura dos repositórios de dashboard, ou expor `periodEnd` como query param. Hoje é parâmetro morto |
| **D-14** | Um comentário em `withReplay` já existe; acrescentar a distinção operacional (`record` = popular do zero, `replay` = consumir cache importado) ao `tests/hurl/README.md` |
| **D-16** | Passar um `nowIso` derivado de `clock.ts` ao worker quando a chamada vier do roteiro. Baixo valor: o gate atual já normaliza `completed_at` e usa `?format=raw` |
| **D-17** | Remover `chat-repo.nextSeq` e seu teste, ou usá-la em `chat-messages-send` no lugar do cálculo manual. Prefira **usar**: centraliza a regra |
| **D-18** | Extrair para `_shared/`: `UUID_RE` (→ `_shared/uuid.ts` ou `validation.ts`), `base64url` (→ `_shared/base64url.ts`), `DOWNLOADABLE_STATUSES` (→ `export-repo.ts`), `UNIQUE_VIOLATION` (→ `db.ts`). Fazer `entries-create/pii.ts` importar `piiSpanSchema` de `contracts/zod/common.ts`, `rag.ts` importar `RetrievedEntry` de `prompts.ts`, e `chat-generation.ts` importar `ReplayStatus` de `replay.ts` |
| **D-26** | Trocar o import por URL de `prove-rf06.ts` pelo especificador `postgres` do import map, igual aos outros scripts |
| **D-27** | Nada a fazer — decisão correta e já documentada. Manter o comentário do `config.toml` visível em qualquer revisão futura |
| **D-28** | Acrescentar à `taxonomia_erros.md` do handoff uma coluna "como o app observa este código", marcando os 3 que só surgem por injeção de falha |
| **D-29** | Nada a fazer. Se quiser rastreabilidade, um `console.warn` no `catch` (sem alterar a resposta) |
| **D-31** | Acrescentar uma varredura periódica de objetos sem dono no bucket, ou aceitar o resíduo. Recomendação: aceitar — já documentado |
| **D-32** | Recalcular `entry_count` no worker ao gravar `data_ready`, com o número real de entradas exportadas. Uma linha, e o `entryCount` do status passa a bater com o arquivo |
| **D-33** | Nada a fazer — é decisão de desenho correta. Registrado só por ser o único ponto sem defesa em profundidade |

---

## Contexto registrado, não é defeito

### D-09 — `insights.dismissed`/`dismissed_at` sem endpoint

As colunas existem e o contrato as expõe, mas nenhum endpoint as escreve. O
documento de requisitos (`ux/Requisitos_e_Fluxo_de_Telas_TCC.md:63`) trata
"descartar o insight" como comportamento de tela — satisfazível no cliente.

**Proposta.** Nenhuma mudança de código. Acrescentar uma nota ao pacote de
handoff dizendo que o descarte é local ao app e que os dois campos não têm
endpoint de escrita, para nenhum dos dois times procurar o endpoint que falta.

### D-10 — `tags`/`entry_tags` sem endpoint de escrita

**Decisão documentada e intencional**, não divergência:
`ux/Requisitos_e_Fluxo_de_Telas_TCC.md:167` — "Sem edição/exclusão de entrada,
nem endpoint de tag — intencional (D3/T-015)... não recebem implementação
funcional em nenhum dos dois ciclos". A correção do RF06 na linha 43 do mesmo
documento já removeu "categoria" das dimensões de filtro.

**Proposta.** Nenhuma. Listado aqui só para quem ler o schema, ver as duas
tabelas e estranhar a ausência de endpoints.
