# Documentação didática — backend Cerne

> Versão explicativa, para quem tem pouca experiência com backend. Cobre o
> mesmo conteúdo da [`DOCUMENTACAO_TECNICA.md`](DOCUMENTACAO_TECNICA.md), mas
> explicando o **porquê** de cada decisão, não só o **quê**.
> As divergências da seção 13 têm proposta de correção em
> [`DIVERGENCIAS_E_INCONSISTENCIAS.md`](DIVERGENCIAS_E_INCONSISTENCIAS.md).

## Sumário

1. [Para quem é este documento e como usá-lo](#1-para-quem-é-este-documento-e-como-usá-lo)
2. [O que o Cerne faz, em uma página](#2-o-que-o-cerne-faz-em-uma-página)
3. [Glossário rápido — leia antes do resto](#3-glossário-rápido--leia-antes-do-resto)
4. [A arquitetura explicada](#4-a-arquitetura-explicada)
5. [Camada por camada, com o "porquê"](#5-camada-por-camada-com-o-porquê)
6. [Grupo de arquivos por grupo de arquivos](#6-grupo-de-arquivos-por-grupo-de-arquivos)
7. [As regras de negócio, explicadas](#7-as-regras-de-negócio-explicadas)
8. [A API explicada](#8-a-api-explicada)
9. [Segurança explicada](#9-segurança-explicada)
10. [Integrações externas explicadas](#10-integrações-externas-explicadas)
11. [Testes: o que cada suíte prova e como rodar](#11-testes-o-que-cada-suíte-prova-e-como-rodar)
12. [Convenções de código do repositório](#12-convenções-de-código-do-repositório)
13. [Observações técnicas](#13-observações-técnicas)
14. [Glossário completo](#14-glossário-completo)

---

## 1. Para quem é este documento e como usá-lo

Se você já trabalhou com backend por anos, vá direto para a
`DOCUMENTACAO_TECNICA.md` — ela diz as mesmas coisas em um terço do espaço.

Este documento é para quem precisa **entender** o backend do Cerne: por que ele
foi montado assim, o que cada pedaço resolve, e o que aconteceria se o pedaço
não existisse.

**Sugestão de leitura:**
1. Seções 2 e 3 (contexto + glossário) — sem elas o resto fica mais difícil.
2. Seção 4 (arquitetura) — o mapa mental.
3. Depois, o que você precisar: seção 5 para entender uma camada, seção 6 para
   achar um arquivo, seção 7 para entender uma regra de negócio.

Uma coisa importante sobre este repositório: **os comentários no código são
excelentes**. Quase todo arquivo começa explicando de onde veio, que decisão
foi tomada e — o mais valioso — que erro real aconteceu durante a construção.
Quando este documento falar de um módulo, vale abrir o arquivo e ler o
cabeçalho. Você vai aprender mais ali do que aqui.

---

## 2. O que o Cerne faz, em uma página

O Cerne é um app de **diário reflexivo com IA**. O usuário escreve (ou dita,
ou fotografa uma página de caderno), e o app guarda isso. Além de guardar, ele:

- conversa com o usuário sobre o que foi escrito (um chat com IA que **lembra**
  dos registros anteriores);
- gera "insights" automáticos sobre a conversa;
- deixa o usuário buscar registros por **significado**, não por palavra exata
  ("ansiedade" encontra um texto que fala de aperto no peito sem usar a palavra);
- mostra um painel com a evolução ao longo do tempo;
- exporta tudo em PDF.

Este repositório é **só o backend** — o servidor. O app em si (Flutter) é outro
projeto.

### Por que o backend é do jeito que é

Aqui está o detalhe que explica quase todas as decisões estranhas que você vai
encontrar: **este backend é um instrumento de pesquisa.**

Ele foi construído uma vez e entregue **idêntico** a dois times, que vão
construir o mesmo app usando **metodologias de desenvolvimento diferentes**
(GitHub Spec Kit × BMAD-METHOD). No fim, compara-se o resultado dos dois. Isso
é um TCC.

Para essa comparação valer alguma coisa, o backend precisa se comportar
**exatamente igual** para os dois times. E aí está o problema: **IA não é
determinística**. Se você fizer a mesma pergunta duas vezes ao mesmo modelo, as
respostas vêm diferentes. Se o time A recebe uma resposta e o time B recebe
outra, a comparação fica contaminada — a diferença pode ser da metodologia ou
pode ser só da IA.

A solução está espalhada por todo o código e se chama **cache de replay**
(seção 10.5). É a peça que faz este backend ser diferente de um backend normal.
Vários comportamentos que parecem exagero — congelar o relógio, ordenar chaves
de JSON antes de fazer hash, proibir índice vetorial aproximado, desempatar
toda ordenação por `id` — existem por causa disso.

---

## 3. Glossário rápido — leia antes do resto

Só o mínimo para a seção 4 fazer sentido. O glossário completo está na seção 14.

**Edge Function** — um pedacinho de código que roda na nuvem quando alguém faz
uma requisição HTTP, e depois some. Você não administra servidor: escreve a
função e a plataforma (aqui, Supabase) cuida do resto. Pense num porteiro que
só existe enquanto alguém está tocando a campainha.

**RLS (Row Level Security)** — uma trava que fica **dentro do banco de dados**
e decide, linha por linha, quem pode ver o quê. Sem RLS, se você escrever
`SELECT * FROM entries` e esquecer o `WHERE user_id = ...`, você vê os diários
de todo mundo. Com RLS, o banco recusa sozinho: mesmo pedindo tudo, você recebe
só o que é seu. É a diferença entre "eu prometo que filtro" e "o banco não me
deixa não filtrar".

**JWT** — um crachá digital. Quando você faz login, o servidor te dá um texto
assinado dizendo "esta pessoa é o usuário X, válido até tal hora". Você manda
esse crachá em toda requisição seguinte.

**Embedding** — a tradução de um texto para uma lista de 1024 números. A graça
é que textos com significado parecido viram listas de números parecidas. Isso
permite buscar por sentido: "ansiedade" e "meu peito estava apertado" ficam
perto no espaço de números, mesmo sem nenhuma palavra em comum.

**RAG (Retrieval-Augmented Generation)** — antes de perguntar algo à IA, você
busca no seu banco os trechos mais relevantes e os cola no pedido. É a diferença
entre perguntar "o que você acha disso?" e "olha estes 5 registros anteriores
da pessoa; agora, o que você acha disso?". É assim que o chat do Cerne "lembra".

**SSE (Server-Sent Events)** — normalmente o servidor responde uma vez e fecha.
Com SSE, ele mantém a conexão aberta e vai mandando pedaços. É o que faz o texto
da IA aparecer palavra por palavra em vez de tudo de uma vez depois de 10
segundos de tela branca.

**Fila (queue)** — uma lista de tarefas para fazer depois. Se algo demora muito
(gerar um PDF, por exemplo), você não segura o usuário esperando: anota "preciso
fazer isso", responde "ok, estou processando", e um trabalhador em segundo plano
pega da lista.

**Determinismo** — dar sempre exatamente o mesmo resultado para a mesma entrada.
É a propriedade central deste projeto (ver 2).

---

## 4. A arquitetura explicada

### 4.1 Por que "camadas" e o que cada uma resolve

Imagine um restaurante. Você poderia ter uma pessoa só que atende, anota, cozinha,
serve e cobra. Funciona com um cliente. Com cinquenta, vira caos — e se essa
pessoa faltar, ninguém sabe fazer nada.

Restaurantes reais separam papéis: garçom, cozinha, caixa. Cada um sabe fazer
uma coisa muito bem e conversa com os vizinhos por uma interface combinada
(a comanda).

Backend em camadas é a mesma ideia. Cada camada tem **uma** responsabilidade:

| Camada | Papel no restaurante | O que faz |
|---|---|---|
| **Contratos** | O cardápio | Define o que pode ser pedido e o que volta |
| **Gateway** | O maître | Recebe todo mundo, confere reserva, valida o pedido |
| **Endpoints** | O chef de cada prato | A receita específica de cada pedido |
| **Compartilhada** | A cozinha (fogão, facas) | Ferramentas que todos os pratos usam |
| **Dados** | A despensa trancada | Guarda tudo e não deixa ninguém pegar o que não é seu |
| **Worker** | O preparo da véspera | O que demora demais para fazer com o cliente esperando |

**O ganho concreto:** quando você precisa mudar o formato de erro da API, você
muda em **um** arquivo (`_shared/errors.ts`) e os 23 endpoints mudam junto.
Se cada endpoint tivesse seu próprio formato de erro, você mudaria 23 vezes,
erraria em 3, e ninguém perceberia até o app quebrar.

### 4.2 A viagem de uma requisição, passo a passo

Vamos seguir um pedido real: **o usuário salva um registro novo no diário.**

```
[App] POST {base}/entries-create
      Authorization: Bearer <crachá>
      { "content": "hoje foi um dia difícil", "source": "manual" }
         │
         ▼
① entries-create/index.ts
   "Chegou alguém. Não sei nada sobre diários, só sei chamar o portão."
         │
         ▼
② _shared/gateway.ts — O PORTÃO
   • gera um número de protocolo (X-Request-Id)
   • confere o crachá com o GoTrue → "é mesmo o usuário X"
   • valida o corpo contra o contrato → content tem entre 1 e 20000 caracteres? ok
   • monta um "contexto" com tudo pronto e chama o chef
         │
         ▼
③ entries-create/handler.ts — A RECEITA
   • já existe esse registro? (idempotência — passo 2/3)
   • manda o texto para a IA procurar dados pessoais (PII)
   • grava no banco
   • gera o embedding (a lista de 1024 números)
   • devolve o registro pronto
         │
         ▼
④ _shared/entries-repo.ts + _shared/ai/*
   quem realmente fala com o banco e com as IAs
         │
         ▼
⑤ Postgres — e aqui a RLS confere de novo, sozinha
```

**Duas coisas dessa viagem merecem atenção:**

**(a) O portão é um só.** Todos os 23 endpoints passam por `gateway.ts`. Isso
significa que "toda requisição tem número de protocolo", "todo corpo é validado"
e "todo erro sai no mesmo formato" são verdades que você não precisa conferir 23
vezes. Elas são verdade por **construção**.

**(b) A ordem dos passos do portão é obrigatória**, e um deles está fora de
ordem de propósito. O portão processa a simulação de "usuário sem internet"
**antes** de conferir o crachá. Por quê? Porque se o usuário está offline de
verdade, a requisição nem chega ao servidor — então simular offline depois de
autenticar seria uma simulação mentirosa.

### 4.3 Por que existem dois caminhos diferentes

O fluxo acima é o caminho comum: pedido → resposta → fim. Dois casos não cabem
nele.

**Caso 1: o chat.** A IA leva alguns segundos para escrever uma resposta. Se o
servidor esperasse tudo para só então responder, o usuário olharia para uma tela
parada. Então o chat usa **SSE**: o servidor responde imediatamente com uma
conexão aberta e vai empurrando pedaços de texto conforme a IA gera.

Isso cria um problema interessante, e a solução dele está no código: **depois
que o primeiro byte da resposta sai, você não pode mais mudar os cabeçalhos**.
Mas o servidor precisa avisar no cabeçalho `X-Replay-Status` se a resposta veio
do cache ou foi gerada na hora. Solução: o handler consulta o cache **antes** de
abrir o stream (`peekChatCacheStatus`), decide o cabeçalho, e só então começa a
mandar bytes.

**Caso 2: a exportação em PDF.** Juntar todos os registros, pedir um resumo à
IA e montar um PDF pode levar bastante tempo — e Edge Functions têm limite de
duração. Então:

```
1. O app pede a exportação.
2. O servidor conta as entradas (rápido), cria um "job" e responde
   "202 — aceito, estou processando". O usuário já pode fechar a tela.
3. Um relógio dentro do banco (pg_cron) verifica a fila a cada 15 segundos.
4. Achou trabalho? Chama o worker.
5. O worker junta os dados, salva o arquivo bruto e já marca "dados prontos".
6. Só então tenta a narrativa com IA. Se falhar, tudo bem: os dados
   continuam disponíveis para download.
7. O app pergunta "já ficou pronto?" de vez em quando (GET /export/:id/status).
```

O passo 5 é a parte esperta. Os dados ficam disponíveis **antes** de a IA ser
chamada. Se a IA falhar, o usuário ainda consegue baixar seu diário — só sem o
resumo bonito. Isso é o que "resiliente" significa na prática: a parte que pode
falhar não derruba a parte que funciona.

### 4.4 Por que existe um diretório por endpoint

Num backend tradicional (Express, FastAPI, Rails), você tem um **roteador**: um
arquivo que diz "`/entries` vai para cá, `/entries/:id` vai para lá".

Aqui **não existe roteador**. Cada endpoint é uma Edge Function separada, com seu
próprio diretório, seu próprio deploy. O nome do diretório **é** o endereço.

Isso tem uma consequência prática que confunde quase todo mundo na primeira vez:

```
O contrato diz:      GET /entries/:id
A URL de verdade é:  GET {base}/entries-get/<id>
```

Não são a mesma coisa. O caminho "bonito" (`/entries/:id`) existe nos contratos
e na documentação OpenAPI porque é assim que a API foi **desenhada**. Mas a URL
que o app realmente chama usa o nome do diretório da função.

> ⚠️ **Isso é uma divergência real e importante** — o arquivo OpenAPI entregue
> aos dois times publica os caminhos bonitos, que não funcionam se você chamar
> literalmente. Ver seção 13, item D-01.

Como não há roteador, quem extrai o `:id` da URL é o `index.ts` de cada função:
pega o último pedaço do caminho. O `chat-messages-retry` pega os dois últimos
(`:id` e `:userMessageId`).

---

## 5. Camada por camada, com o "porquê"

### 5.1 Contratos: por que os schemas vêm antes do código

Em `contracts/zod/` moram os **schemas**: descrições formais de "como é um
pedido válido" e "como é uma resposta".

```ts
export const createEntryRequestSchema = z.object({
  content: z.string().min(1).max(20000),
  source: sourceEnum,
  chatMessageId: uuidSchema.optional(),
  // ...
}).refine((body) => (body.source === "chat") === (body.chatMessageId !== undefined));
```

**Por que isso e não um `if` no handler?** Três motivos.

**(1) A validação fica em um lugar só.** O gateway valida usando o schema, antes
do handler rodar. O handler recebe dados **já garantidos** — ele nunca precisa
perguntar "será que veio `content`?".

**(2) A documentação é gerada, não escrita.** `scripts/gen-openapi.ts` lê os
schemas e produz `contracts/openapi.yaml`. E o CI confere: se você mudar um
schema e não regenerar o YAML, o build quebra. Isso resolve o problema mais
comum de documentação de API — ela envelhecer e ninguém perceber. Aqui é
**impossível** a documentação divergir do código, porque ela *é* o código.

**(3) Regra de negócio expressa como schema.** Olhe este detalhe, que é elegante:

```ts
export const updateAccountSettingsRequestSchema = z.object({
  displayName: ..., persona: ..., biometricEnabled: ...,
}).strict();
```

A regra "o usuário não pode mudar o próprio e-mail" não está implementada em
lugar nenhum como código. O `.strict()` diz "qualquer chave que não esteja nesta
lista é erro" — e `email` não está na lista. A regra é consequência do schema.
Menos código = menos bug.

**O registro.** `contracts/zod/registry.ts` é a lista dos 23 endpoints. Cada
entrada amarra: identificador, método, caminho, se exige login, schema do corpo,
schema da query, forma da resposta. É a fonte da verdade — o gateway e o gerador
de OpenAPI leem daí.

### 5.2 Gateway: por que tudo passa pelo mesmo portão

`_shared/gateway.ts` faz 9 coisas em ordem fixa. Vale entender **por que cada
uma existe**:

| Passo | Sem ele, o que quebra |
|---|---|
| 1. Número de protocolo | Um erro reportado pelo usuário é irrastreável no log |
| 2-3. Congelar o relógio em teste | Nenhum teste de "o que aconteceu nos últimos 7 dias" seria reproduzível |
| 4. Simular falhas | Não dá para testar como o app reage a servidor lento/offline |
| 5. Autenticar | Qualquer um lê o diário de qualquer um |
| 6. Validar | Handlers cheios de checagem defensiva repetida |
| 7. Handler | (é o trabalho de verdade) |
| 8. Serializar | Cada endpoint inventaria seu próprio formato de resposta |
| 9. Tratar exceção | Um bug vaza detalhe interno (nome de tabela, stack trace) para o cliente |

**Um detalhe do passo 9 que vale aprender.** O gateway tem três níveis de erro:

```ts
if (err instanceof CerneError)     → um dos 13 códigos conhecidos
if (err instanceof ReplayMissError) → erro de infraestrutura de experimento
else                                → console.error(...) + 500 genérico
```

O terceiro caso é a rede de segurança: um bug de verdade não pode inventar um
dos 13 códigos (mentindo para o app sobre o que aconteceu) nem vazar detalhe
interno. Mas repare no `console.error` — ele foi **acrescentado depois**, e o
comentário conta por quê: antes dele, um erro de banco não deixava rastro nem
na resposta (por desenho) nem no log. O bug existia e era invisível. Uma linha
resolveu.

**O detalhe mais curioso do arquivo** está no `finally`:

```ts
finally {
  if (req.body && !req.bodyUsed) { await req.arrayBuffer().catch(() => {}); }
}
```

Tradução: "se a requisição tinha um corpo e ninguém leu, leia e jogue fora".
Parece inútil. Não é. Existe um bug conhecido do Deno em que responder sem ler
o corpo **trava a conexão** quando o corpo é grande. O sintoma real foi o teste
de OCR pendurando por 150 segundos: uma imagem de vários MB enviada sem crachá
válido era rejeitada no passo 5, antes do passo 6 ler o corpo. Esse `finally`
foi a correção.

### 5.3 Compartilhada: por que nada é reimplementado por endpoint

`_shared/` tem 22 módulos (mais 2 em `ai/`). A regra é simples: **se dois endpoints precisam da
mesma coisa, ela mora aqui.**

Um exemplo concreto de por que isso importa. `_shared/serialize.ts` é o único
lugar do projeto que converte entre os dois jeitos de nomear campos:

```
banco: chat_message_id   (snake_case, convenção do Postgres)
API:   chatMessageId     (camelCase, convenção de JSON)
```

Se cada endpoint fizesse essa conversão sozinho, um deles escreveria
`chatMessageID` (com D maiúsculo), o app quebraria só naquele endpoint, e
levaria horas para achar. Com um módulo só, ou está certo em todos ou está
errado em todos — e o teste pega.

E olhe o comentário dentro dele, que ensina algo real sobre regex:

> A primeira versão usava `/([a-z0-9])([A-Z])/`, que colapsa sequências como
> "aBC" (de "a_b_c") em "a_bc" em vez de "a_b_c" — perde a volta.

Ou seja: a conversão ida-e-volta não era reversível. Trocaram por "cada
maiúscula vira `_` + minúscula" e ficou bijetiva. Esse tipo de erro é
exatamente o que um módulo centralizado permite achar e corrigir uma vez só.

**A história de um módulo que nasceu aqui depois.** `chat-generation.ts`
começou dentro de `chat-messages-send/`. Quando o `retry` foi implementado,
descobriu-se que os passos 4 a 9 eram **idênticos** nos dois. Em vez de copiar,
moveram para `_shared/`. É o padrão do repositório: começa local, promove
quando o segundo consumidor aparece.

### 5.4 Endpoints: o que é fiação e o que é regra

Cada diretório de endpoint tem dois arquivos com papéis bem separados:

**`index.ts` — a fiação.** Não tem regra de negócio nenhuma. Lê as variáveis de
ambiente uma vez, extrai os parâmetros da URL e chama o gateway:

```ts
const contract = ENDPOINTS.find((e) => e.id === "entries.create")!;
const env = readAiEnv();
Deno.serve((req) => runGateway(req, contract, {}, (ctx) => handleCreateEntry(ctx, env), ...));
```

**`handler.ts` — a regra.** É uma função normal que recebe um contexto e devolve
um resultado. **Não sabe que HTTP existe.**

Por que separar? Porque assim o handler é testável sem subir servidor nenhum.
Você monta um contexto de mentira, chama a função, confere o retorno. São 53
arquivos de teste no projeto que funcionam por causa dessa separação.

**Quando um endpoint tem lógica só dele**, ela vira um módulo local:
`entries-create/pii.ts`, `media-ocr/ocr.ts`, `chat-insight-create/generation.ts`.
Fica perto de quem usa, e só sobe para `_shared/` se um segundo endpoint
precisar.

### 5.5 Dados: por que o banco é quem garante as regras críticas

Este é o conceito mais importante desta seção.

Existem regras que você **não pode** garantir no código da aplicação. O exemplo
clássico do projeto é a idempotência (regra RF10): "se o app mandar o mesmo
registro duas vezes, tem que criar só um".

A tentação é escrever:

```ts
const existente = await buscar(chatMessageId);
if (existente) return existente;      // já existe, devolve
return await criar(...);              // não existe, cria
```

Isso **parece** certo e está errado. Se duas requisições chegarem no mesmo
instante, as duas fazem a busca, as duas não encontram nada, as duas criam.
Duplicata. A janela entre "verificar" e "agir" é onde o bug mora — e ela é
pequena demais para você notar em teste manual, mas grande o bastante para
acontecer em produção.

A solução do projeto é deixar o **banco** garantir:

```sql
create unique index entries_chat_message_uniq
  on public.entries (user_id, chat_message_id)
  where chat_message_id is not null;
```

Agora é fisicamente impossível existirem duas linhas com o mesmo par. Se duas
requisições correrem, uma ganha e a outra recebe um erro do Postgres (código
`23505`). E o código trata esse erro **como sucesso**:

```ts
if (error.code === UNIQUE_VIOLATION && args.chatMessageId) {
  const existing = await findEntryByChatMessageId(...);
  if (existing) return { entry: existing, idempotentReplay: true };
}
```

"Você tentou criar e já existia? Tudo bem, aqui está o que já existe."

E a verificação otimista lá de cima **continua no código** — mas com outro
propósito, explicado no comentário: ela economiza uma chamada cara à IA no caso
comum de retry. Ela é **otimização**, não garantia. A garantia é o índice.

> **A lição geral:** regras de integridade (unicidade, obrigatoriedade, faixa de
> valores, relacionamento) pertencem ao banco. Regras de fluxo (a ordem dos
> passos, o que fazer quando a IA falha) pertencem ao código.

O mesmo padrão aparece no insight único (RF08): a `UNIQUE (session_id,
trigger_type, trigger_key)` é quem garante que o mesmo gatilho não gera dois
insights. E aparece na RLS (seção 9.2), que é a mesma ideia aplicada à
segurança.

### 5.6 Worker: por que uma parte roda fora da requisição

`export-worker` é a única função que não atende o app. Ela é chamada **pelo
próprio banco de dados**, e é diferente de tudo:

| Todas as outras funções | `export-worker` |
|---|---|
| Passam pelo gateway | Não passa |
| Validam com Zod | Não valida |
| Usam o crachá do usuário | Usa `service_role` (vê tudo) |
| Estão no registro dos 23 | Não está |
| Respondem a um humano esperando | Ninguém está esperando |

**Por que ela precisa de `service_role`?** Porque não existe usuário logado. O
`pg_cron` acordou a função 40 segundos depois de o usuário ter fechado o app.
Não há crachá. Para ler as entradas de um usuário qualquer, a função precisa de
um acesso que ignora a RLS.

**E por que isso não é um buraco de segurança?** Porque o poder está isolado
fisicamente:

- O cliente `service_role` é criado em **um** arquivo: `_shared/worker-db.ts`
  (28 linhas).
- Esse arquivo é importado por **um** consumidor: `export-worker/index.ts`.
- Nenhum dos 23 diretórios de endpoint o importa.

Se alguém tentar usar `service_role` num endpoint de app, vai precisar importar
esse módulo — e isso aparece no diff, gritando. A regra vira visível em vez de
depender de disciplina.

**Detalhe importante:** porque `service_role` ignora a RLS, as funções "de
worker" em `export-repo.ts` **sempre filtram `user_id` à mão**. O arquivo separa
as duas metades explicitamente, com comentário, justamente para ninguém
confundir uma com a outra. Esquecer esse filtro numa função de worker seria
vazar dados entre usuários.

---

## 6. Grupo de arquivos por grupo de arquivos

Onde achar as coisas, o que cada pasta faz, e como nomear algo novo.

### `contracts/zod/` — os schemas

**Propósito:** definir o formato de todo pedido e toda resposta.

```
common.ts     primitivos e envelopes compartilhados
auth.ts       account.ts     entries.ts
chat.ts       export.ts      dashboard.ts       (um por área da API)
registry.ts   a lista dos 23 endpoints
```

**Convenções:** campos sempre em `camelCase`; um arquivo por área; `common.ts`
só recebe o que aparece em mais de uma área. `registry.ts` importa todos e é o
único que o resto do projeto precisa conhecer.

**Ao acrescentar um endpoint:** schema no arquivo da área, entrada no
`registry.ts`, e rode `deno run -A scripts/gen-openapi.ts`.

### `contracts/openapi.yaml` — gerado, não editar

Tem um aviso na primeira linha. O CI regenera e compara; editar à mão quebra o
build. Se precisa mudar, mude o schema.

### `supabase/migrations/` — a estrutura do banco

**Propósito:** cada arquivo é uma mudança de estrutura, aplicada em ordem, uma
única vez por ambiente.

**Convenção:** `NNNN_nome_descritivo.sql`, numeração sequencial.

**A regra mais importante:** *nunca edite uma migração já aplicada*. Se a 0014
está errada, a correção é uma 0019 nova. O projeto faz exatamente isso — a 0019
renomeia uma coluna criada pela 0014, e a 0016 e a 0020 só acrescentam permissões
que faltaram. O motivo é simples: outros ambientes já rodaram a 0014. Editá-la
faria eles ficarem diferentes do seu, silenciosamente.

### `supabase/functions/_shared/` — a caixa de ferramentas

| Grupo | Arquivos |
|---|---|
| Portão e erro | `gateway.ts`, `errors.ts`, `serialize.ts` |
| Instrumentação de teste | `clock.ts`, `test-mode.ts`, `faults.ts` |
| Clientes e ambiente | `db.ts`, `worker-db.ts`, `deps.ts` |
| Integrações | `gotrue.ts`, `ai/anthropic.ts`, `ai/voyage.ts` |
| Determinismo e IA | `replay.ts`, `prompts.ts`, `rag.ts` |
| Chat | `sse.ts`, `chat-generation.ts` |
| Acesso a dados | `entries-repo.ts`, `chat-repo.ts`, `profiles-repo.ts`, `dashboard-repo.ts`, `export-repo.ts` |
| Utilidades | `pdf.ts`, `_test_utils.ts` |

**Convenção de nome:** `*-repo.ts` acessa dados; `ai/*` fala com provedor de IA;
o resto tem nome do que faz. Todo módulo recebe suas dependências por parâmetro
(nunca importa `Deno.env` direto) — é isso que os torna testáveis.

### `supabase/functions/<endpoint>/` — os 23 endpoints

```
index.ts       fiação (sem regra)
handler.ts     a regra
<local>.ts     lógica só deste endpoint
*.test.ts      testes
```

**Convenção de nome do diretório:** `<recurso>-<ação>` —
`entries-create`, `chat-messages-retry`, `export-status-get`. Lembre que esse
nome **é o endereço público** da função.

### `supabase/tests/` — testes do banco (pgTAP)

Um arquivo por assunto: `rls_<tabela>.sql`, `constraints.sql`, `triggers.sql`,
`cascade_delete.sql`, `<coisa>_rpc.sql`. Os 8 `rls_*.sql` seguem exatamente o
mesmo roteiro de 6 asserções — se você criar uma tabela nova com dono, copie um
deles e troque o nome.

### `tests/hurl/` — testes de contrato HTTP

Arquivos `.hurl` são requisições HTTP em texto, com asserções. Um por endpoint
ou por cenário nomeado. Leia o `README.md` da pasta antes de rodar — ele tem
cinco "achados reais" que economizam horas.

### `tests/determinism/` — o gate mais importante

`run.sh` orquestra, `normalize.ts` limpa o que muda legitimamente,
`compare.ts` decide passa/falha, `roteiro_validacao.hurl` é a jornada testada.

### `scripts/` — ferramentas de operação

Coisas que uma pessoa roda à mão em algum momento: gerar OpenAPI, gerar docs de
handoff, exportar/importar cache, configurar o worker, comparar schema entre
ambientes. Todos têm instruções de uso no cabeçalho.

### `docs/`, `context/`, `plan/`, `ux/`, `fixtures/`

Não é código. `docs/handoff/` é **gerado** (`gen-handoff-docs.ts`). `ux/` tem o
protótipo congelado e o documento de requisitos. `fixtures/` tem os textos e
imagens usados nos testes.

---

## 7. As regras de negócio, explicadas

Cada regra abaixo tem um código (`RF` = requisito funcional, `D` = decisão de
arquitetura) que aparece nos comentários do código.

### Criar um registro — e não criar dois (RF01, RF10, D4)

**O cenário:** o usuário escreve no chat, gosta da própria frase e salva como
registro. O app manda `POST /entries` com o `chatMessageId`. A internet cai no
meio. O app tenta de novo. **Não pode virar dois registros.**

**Como funciona:** ver 5.5. O índice único no banco garante; o código traduz a
colisão em "aqui está o que já existe", com `meta.idempotentReplay: true` para
o app saber que foi uma repetição.

**Detalhe que vale notar:** o replay devolve **200**, não 409 (Conflito). A
taxonomia de erros do projeto nem tem código de conflito. A razão é de
experiência do usuário: do ponto de vista dele nada deu errado — o registro
está salvo. Erro seria mentira.

### PII: anotar, nunca apagar (D3, RNF02)

**O cenário:** o usuário escreve "briguei com a Marina hoje". "Marina" é o nome
de uma pessoa real — dado pessoal.

**A decisão:** o servidor **anota** onde está o dado pessoal, e nunca altera o
texto. `content` guarda a frase exata. `pii_spans` guarda
`[{start: 12, end: 18, type: "nome"}]`.

**Por quê?** É o diário da pessoa. Censurar o diário de alguém "para proteger"
essa mesma pessoa não faz sentido — inclusive porque o nome que importa para ela
é justamente o que seria apagado. A anotação serve para o app decidir o que fazer
(avisar antes de exportar, por exemplo).

**A confusão que o código evita:** `PII_CHECK_FAILED` significa que a
**verificação** falhou (a IA não respondeu), não que encontrou algo. Encontrar é
o caminho normal (`status: 'flagged'`). O comentário do arquivo diz isso com
todas as letras, porque é fácil inverter.

### Buscar por significado (RF06)

**O cenário:** o usuário busca "ansiedade". Um registro diz "meu peito estava
apertado e eu não conseguia dormir". Nenhuma palavra em comum — mas é isso que
ele procura.

**Como funciona:** todo registro tem um embedding (1024 números). A busca gera o
embedding da pergunta e procura os registros cujos números estão mais "perto".

**Três detalhes que existem por causa do determinismo:**

1. **Varredura exata, nunca índice aproximado.** Bancos vetoriais oferecem
   índices (HNSW, IVFFlat) que são muito mais rápidos, mas **aproximados** —
   podem devolver resultados ligeiramente diferentes. Aqui isso é proibido, e
   `scripts/schema-hash.ts` falha se alguém criar um. Com dezenas de registros,
   a varredura exata é instantânea de qualquer forma.
2. **Desempate por `id`.** Se dois registros empatam em distância, sem desempate
   o Postgres pode devolvê-los em qualquer ordem. Todo `ORDER BY` do projeto
   termina com `id ASC`.
3. **`input_type` diferente ao salvar e ao buscar** (`document` × `query`) — o
   modelo Voyage é otimizado para isso.

**E se o usuário não digitar nada?** Modo `filter_only`: só os filtros de data e
origem, **sem chamar a IA**. `meta.mode` diz ao app qual modo foi usado.

### OCR: a foto não fica guardada (RF02, D17)

O usuário fotografa uma página de caderno. A imagem vai em base64, o servidor
decodifica na memória, checa o tamanho, manda para a IA e devolve o texto. **A
imagem não é gravada em lugar nenhum** — nem disco, nem Storage, nem banco.

O único vestígio é o SHA-256 da imagem, usado como chave de cache. Um hash não
permite reconstruir a imagem.

Detalhe de implementação com motivo: o limite de tamanho é checado **depois** de
decodificar, porque base64 é ~33% maior que os bytes reais. Checar antes
rejeitaria imagens legítimas.

### Chat: streaming e retry (D12, D15)

**A ordem dos eventos é fixa:**
```
message_created → context → token, token, token... → done (ou error)
```

E é **garantida em tempo de execução** por uma máquina de estados em `sse.ts`.
Se algum código tentar emitir fora de ordem, ele lança exceção em vez de mandar
um stream errado. Isso protege o app cliente, que pode confiar na ordem.

**O retry é a parte mais elegante do projeto.** Quando a resposta da IA falha,
o app pode pedir para tentar de novo — **sem reenviar a pergunta**. O servidor
relê a pergunta que já está gravada, refaz o RAG (que é determinístico) e monta
exatamente o mesmo pedido de antes.

Mesmo pedido ⇒ mesma impressão digital ⇒ **acerta o cache**. O retry custa zero
em IA e devolve exatamente a mesma resposta. O cabeçalho `X-Replay-Status: hit`
confirma.

E o retry reaproveita a **mesma linha** do banco (mesmo `id`, mesmo `seq`),
limpando o conteúdo e voltando para `streaming`. Não existe estado "substituída"
— foi decisão consciente, para não inventar um estado que o banco não prevê.

**Rede de segurança:** se o processo morrer no meio (o runtime pode matar uma
função), a mensagem ficaria `streaming` para sempre. Um job roda a cada minuto e
marca `failed` o que estiver preso há mais de 60 segundos.

### Insight: gerar uma vez só (RF08)

**O cenário:** a cada 5 mensagens, o app pede um insight. Se o usuário girar o
celular e a tela recarregar, o app pede de novo. **Não pode gerar duas vezes** —
custa dinheiro e confunde.

**Como funciona:** mesma ideia da idempotência. Uma `UNIQUE (session_id,
trigger_type, trigger_key)` no banco. Tenta inserir; se colidir, devolve o que
já existe.

**A regra mais forte deste endpoint:** ele **nunca** devolve erro HTTP. Se a IA
falhar, a resposta é **200** com `status: "failed"` no corpo. O motivo está no
comentário: *"o chat não pode quebrar"*. Um insight é um extra; se ele falha, o
app mostra um aviso discreto e a conversa continua. Se fosse um erro HTTP, o app
poderia tratar como falha da tela inteira.

### Exportação resiliente (RF05)

Ver 4.3. A ideia central: **dados prontos não esperam a narrativa**. Os dois
estados (`status` e `narrative_status`) evoluem independentes.

Uma assimetria proposital: exportar um período **vazio** é erro
(`EXPORT_EMPTY_PERIOD`), mas ver o dashboard de um período vazio **não é**.
Faz sentido: um PDF em branco não serve para nada, mas um gráfico vazio é uma
informação legítima ("você não registrou nada essa semana").

### Dashboard (RF09)

Dois endpoints separados de propósito: números (`/aggregate`) e texto de IA
(`/narrative`). Se a IA cair, o usuário ainda vê os gráficos.

O agregado **sempre** responde 200, mesmo sem nenhum dado (`buckets: []`).
Nunca 404. "Não há dados" é uma resposta, não um erro.

### Nunca 403, sempre 404 (D7)

**O cenário:** o usuário A tenta abrir o registro do usuário B.

A resposta óbvia seria 403 (Proibido). O projeto usa **404** (Não encontrado).

**Por quê?** Porque 403 é uma confirmação. "Proibido" significa "isso existe,
mas não é seu" — e isso já é informação vazada. Alguém poderia varrer IDs e
descobrir quais existem. Com 404 uniforme, não existe e não é seu produzem
respostas indistinguíveis.

Detalhe: os handlers rejeitam IDs que nem são UUID válido **antes** de consultar
o banco. Sem isso, o Postgres devolveria erro de sintaxe, que viraria um 500 —
entregando, pela diferença de resposta, a informação que o 404 queria esconder.

### O selo de sincronização (D9, RF07)

O servidor **não** guarda estado de sincronização. Não há coluna `sync_status`.
A arquitetura é cloud-only: se está no servidor, está sincronizado — por
definição.

O servidor expõe dois campos e o app deriva o selo sozinho a partir deles.

> ⚠️ Há uma divergência real aqui: dos dois campos oferecidos, `updatedAt` nunca
> muda e `serverRevision` é por usuário, não por registro. Ver seção 13,
> itens D-06, D-07 e D-08.

### Prompts montados no servidor (D5)

O app manda **só** o texto que o usuário digitou. Todo o resto — instrução de
sistema, voz da persona, histórico formatado, registros do RAG — é montado no
servidor, em `_shared/prompts.ts`.

**Por quê?** Se os dois times montassem os prompts no app, eles montariam
pacotes diferentes, e o cache de replay teria acerto perto de zero. Todo o
mecanismo de determinismo dependeria de dois times independentes formatarem
texto de forma idêntica — o que nunca aconteceria.

Os templates são **versionados** (`PROMPT_VERSION`). Pedir uma versão que não
existe lança erro, em vez de cair silenciosamente num template qualquer. O
próprio arquivo admite o que não consegue impedir: alguém editar a wording da
`v1` em vez de criar uma `v2`. Isso é disciplina humana, nenhum código detecta.

---

## 8. A API explicada

### 8.1 Como ler um endpoint

Toda resposta de sucesso tem a mesma forma:

```json
{ "data": { ... }, "meta": { ... } }
```

`data` é o conteúdo. `meta` é informação **sobre** a resposta (qual a próxima
página, se foi replay idempotente, qual modo de busca). Separar os dois evita a
bagunça de misturar dado com metadado no mesmo nível.

Todo erro tem a mesma forma:

```json
{ "code": "VALIDATION_ERROR", "message": "content: String must contain at least 1 character(s)",
  "retryable": false, "requestId": "3f2a..." }
```

- `code` — o app decide o que fazer a partir daqui, nunca do texto.
- `message` — para humano ler no log. Pode mudar; não programe contra ele.
- `retryable` — **o servidor já decidiu** se vale tentar de novo. O app não
  precisa ter uma tabela própria de "que erros valem retry".
- `requestId` — o número de protocolo. Aparece também no cabeçalho
  `X-Request-Id`. É o que liga o erro que o usuário viu ao log do servidor.

**Lembre da URL real:** `{base}/<nome-da-função>/<params>`, não o caminho do
contrato (ver 4.4 e a divergência D-01).

### 8.2 Os 23 endpoints

| Área | Endpoints |
|---|---|
| **Autenticação** (5) | cadastro, login, renovar token, sessão atual, logout |
| **Entradas** (4) + mídia (1) | criar, listar, buscar por id, busca semântica, OCR |
| **Chat** (6) | criar sessão, listar sessões, listar mensagens, enviar (SSE), retry (SSE), insight |
| **Exportação** (3) | pedir, consultar status, baixar |
| **Dashboard** (2) | números, narrativa |
| **Conta** (2) | atualizar preferências, apagar conta |

A tabela completa com método, caminho, nome da função e forma da resposta está
na seção 10.2 da `DOCUMENTACAO_TECNICA.md`.

**Três respostas fogem do padrão JSON:**
- os dois endpoints de chat devolvem **stream SSE**;
- o download devolve **302** (um redirecionamento para uma URL temporária do
  Storage, válida por 60 segundos);
- pedir exportação devolve **202** ("aceito, ainda processando"), não 200.

### 8.3 Erros: o que cada código significa para o app

| Código | HTTP | O que o app deveria fazer |
|---|---|---|
| `AUTH_EXPIRED` | 401 | Renovar o token; se falhar, mandar para o login |
| `AUTH_INVALID` | 401 | Mandar para o login |
| `VALIDATION_ERROR` | 400 | Bug do app (ou entrada não validada na tela). Não repetir igual |
| `NOT_FOUND` | 404 | Recurso não existe **ou** não é do usuário. Voltar para a lista |
| `PII_CHECK_FAILED` | 502 | A verificação de dados pessoais falhou; nada foi salvo. Oferecer "tentar de novo" |
| `EMBEDDING_FAILED` | 502 | A busca não pôde ser feita. Oferecer "tentar de novo" |
| `AI_GENERATION_TIMEOUT` | 504 | A IA falhou. Oferecer "tentar de novo" |
| `OCR_NO_TEXT` | 400 | Não achou texto na foto. Pedir outra foto |
| `PAYLOAD_TOO_LARGE` | 413 | Imagem grande demais. Comprimir antes de enviar |
| `EXPORT_EMPTY_PERIOD` | 400 | Não há nada no período. Sugerir outro |
| `RATE_LIMITED` | 429 | Esperar e tentar de novo |
| `NETWORK_TIMEOUT` | 504 | Tentar de novo |
| `NETWORK_OFFLINE` | — | Nunca chega como resposta (a conexão simplesmente não responde) |

**Duas ausências propositais:** não existe **403** (ver 7, D7) e não existe
**409** (replay idempotente é 200).

**Curiosidade:** os três últimos códigos (`RATE_LIMITED`, `NETWORK_TIMEOUT`,
`NETWORK_OFFLINE`) só aparecem quando alguém **injeta** uma falha de teste.
Nenhuma condição real do servidor os produz. Eles existem para que os dois times
possam testar como o app se comporta nessas situações.

### 8.4 Streaming: o que o app recebe, na ordem

```
event: message_created
data: {"userMessageId":"...","assistantMessageId":"...","seq":4}
  → "Gravei sua mensagem e criei a linha da resposta. Aqui estão os ids."

event: context
data: {"retrievedEntryIds":["...","..."]}
  → "Estes são os registros anteriores que usei como contexto."
     (o app pode mostrar "baseado em 3 registros seus")

event: token
data: {"text":"Entendo"}
event: token
data: {"text":" que hoje"}
  → o texto chegando aos pedaços. Zero ou mais destes.

event: done
data: {"assistantMessageId":"...","finishReason":"end_turn"}
  → acabou bem.

    ou

event: error
data: {"code":"AI_GENERATION_TIMEOUT","message":"...","retryable":true}
  → deu errado no meio. O texto parcial já foi salvo no banco.
```

**Detalhe bonito:** quando a resposta vem do cache, o servidor **não** manda
tudo de uma vez. Ele fatia o texto em pedaços de 32 caracteres e manda um a cada
15 milissegundos, imitando a digitação. O usuário não percebe diferença entre
uma resposta gerada na hora e uma vinda do cache — e, porque os pedaços dependem
só do tamanho do texto, a sequência de eventos é **idêntica** em toda execução.

---

## 9. Segurança explicada

### 9.1 Como o servidor sabe quem é você

```
1. Você faz login. O GoTrue devolve dois tokens:
     access_token   — o crachá (vale 1 hora)
     refresh_token  — o direito de pedir um crachá novo
2. Toda requisição leva: Authorization: Bearer <access_token>
3. O gateway pergunta ao GoTrue "esse crachá é válido? de quem é?"
4. Sendo válido, o gateway cria um cliente de banco que carrega esse crachá.
5. Toda consulta feita com esse cliente é vista pelo banco como "o usuário X
   está perguntando" — e a RLS decide o que ele enxerga.
```

**O passo 4 é a parte que importa.** O crachá não fica só na aplicação: ele é
**repassado ao banco**. É isso que faz a RLS funcionar.

### 9.2 RLS: a trava que o banco aplica sozinho

Suponha que um bug faça um endpoint executar:

```sql
select * from entries;     -- sem WHERE nenhum!
```

Num banco comum, isso devolve o diário de todos os usuários. Com RLS ligada, o
banco reescreve a consulta por baixo dos panos:

```sql
select * from entries where auth.uid() = user_id;
```

O programador **não consegue** esquecer o filtro, porque não é ele quem aplica.

No projeto, todas as 8 tabelas com dono têm o mesmo tratamento:
- `ENABLE ROW LEVEL SECURITY` — liga a trava;
- `FORCE ROW LEVEL SECURITY` — vale até para o dono da tabela (sem isso, haveria
  uma porta dos fundos);
- uma política para cada operação (ler, inserir, atualizar, apagar);
- `GRANT` explícito para `authenticated` e `REVOKE ALL` de `anon`.

**Por que o `GRANT` explícito?** Porque o `config.toml` tem
`auto_expose_new_tables = false`. Nada é exposto por padrão — você precisa
liberar de propósito. É o oposto do padrão "abre tudo e depois fecha o que
lembrar".

**Um detalhe de desenho:** `chat_messages`, `entry_tags` e `insights` guardam
uma cópia do `user_id` mesmo já tendo como chegar nele por relacionamento. É
duplicação de dado de propósito: assim a política de segurança filtra **sem
join**, o que a torna mais simples e mais rápida.

### 9.3 Os três papéis e a regra do `service_role`

| Papel | Poder | Onde é usado |
|---|---|---|
| `anon` | quase nada | Só para registrar injeção de falha nos 3 endpoints sem login |
| `authenticated` | vê só o que é seu (RLS decide) | **Os 23 endpoints** |
| `service_role` | **vê tudo, ignora a RLS** | Só o `export-worker` |

A regra do projeto: *"nunca `service_role` numa Edge Function que atende
requisição do aplicativo — só em workers de fila"*.

Ver 5.6 para como essa regra é garantida na prática (isolamento físico do
módulo), e por que o worker precisa desse poder.

**Uma armadilha real que o projeto documentou** (migração 0020): `service_role`
ignora RLS, mas **isso não é a mesma coisa que ter permissão na tabela**. São
dois mecanismos diferentes do Postgres. O worker quebrou com
`permission denied for table export_jobs` mesmo tendo `BYPASSRLS` — faltava um
`GRANT` comum. A migração 0020 existe só para consertar isso.

### 9.4 O modo de teste e por que ele é seguro

Os dois times precisam testar como o app reage a servidor lento, offline, ou
respondendo lixo. Então o backend oferece três cabeçalhos especiais:

| Cabeçalho | Efeito |
|---|---|
| `X-Test-Key` | A chave que libera os outros dois |
| `X-Test-Now` | Congela o relógio do servidor num instante escolhido |
| `X-Test-Fault` | Simula uma falha (`timeout`, `offline`, `malformed`, `slow:500`, `rate_limited`, `ai_timeout`) |

**Por que isso não é um perigo:**

1. Só funciona se `X-Test-Key` bater exatamente com o segredo do ambiente.
2. Se o segredo não estiver configurado, o modo **nunca liga**.
3. A comparação é feita em tempo constante — não dá para descobrir o segredo
   medindo quanto tempo a resposta demora.
4. Chave errada não gera erro: os cabeçalhos são **ignorados em silêncio**. Isso
   é intencional — um erro confirmaria que o mecanismo existe.
5. Toda injeção aceita é registrada numa tabela de auditoria.

**Detalhe de ordem que ensina algo:** a falha `offline` é processada **antes** da
autenticação; as outras, depois. Porque se o usuário estivesse offline de
verdade, a requisição nem teria chegado — então processar o token antes tornaria
a simulação mentirosa.

---

## 10. Integrações externas explicadas

### 10.1 Anthropic (Claude) — todo o "pensamento" do app

Usada em **seis** lugares, com dois modelos diferentes:

| Onde | Modelo | Por que esse |
|---|---|---|
| Detectar dados pessoais | Haiku 4.5 | Tarefa mecânica, texto curto — modelo rápido e barato basta |
| Ler foto de caderno (OCR) | Haiku 4.5 | Idem, com visão |
| Conversar (chat) | **Sonnet 5** | A conversa é o produto — vale o modelo melhor |
| Gerar insight | Haiku 4.5 | Texto curto (2 a 4 frases) |
| Narrativa da exportação | Haiku 4.5 | Resumo curto |
| Narrativa do dashboard | Haiku 4.5 | Resumo curto |

**Dois padrões que valem aprender:**

**(a) Saída estruturada (*tool use*).** Para PII e OCR, o servidor não pede "me
diga onde estão os dados pessoais" e depois tenta interpretar o texto livre. Ele
**declara uma ferramenta** com formato fixo e obriga o modelo a usá-la:

```ts
tools: [PII_TOOL],
toolChoice: { type: "tool", name: "report_pii_spans" }
```

A resposta volta como JSON estruturado, validado por um schema Zod. Se não
bater, é erro — nunca "tenta adivinhar o que o modelo quis dizer". É a diferença
entre parsear texto livre (frágil) e receber dados (confiável).

**(b) Timeout obrigatório.** Toda chamada tem `AbortSignal.timeout(30_000)`.
O comentário conta o motivo real: `fetch` não tem timeout próprio. Sem ele, uma
chamada travada na rede fica pendurada até o runtime **matar a função inteira**,
e o que aparece no log é "early termination", não um erro compreensível. Com o
sinal, a chamada falha em 30 segundos com um erro normal, que o código sabe
converter.

### 10.2 Voyage AI — só os embeddings

Modelo `voyage-4`, 1024 dimensões, fixados por decisão (trocar mudaria todos os
embeddings já gravados e invalidaria o cache inteiro).

Dois usos, com um parâmetro diferente: `input_type: "document"` ao salvar,
`"query"` ao buscar. O modelo é treinado sabendo dessa distinção, e usar o
mesmo tipo nos dois lados piora a qualidade da busca.

**O comportamento mais importante:** se a Voyage falhar ao salvar um registro,
**o registro é salvo mesmo assim**, com `embeddingStatus: "failed"`. Ele só não
aparece na busca semântica.

Perder o texto que a pessoa escreveu porque um serviço de terceiro estava fora
do ar seria inaceitável — está explicitamente na lista de armadilhas a evitar do
projeto. Por isso `entries-create/embedding.ts` **nunca lança exceção**: ele
devolve `{status: "failed"}` e o fluxo continua.

### 10.3 GoTrue — autenticação

O serviço de autenticação do Supabase. Quatro dos cinco endpoints de auth são
"proxy fino": recebem o pedido, repassam, convertem a resposta para `camelCase`
e devolvem. O servidor não inventa lógica de senha.

O quinto (`GET /auth/session`) tem lógica própria, e uma otimização que vale
explicar: ele precisa dos dados do usuário e da hora de expiração do token.
Poderia perguntar ao GoTrue de novo — mas **decodifica o próprio crachá**, que
já carrega essa informação. Sem verificar a assinatura, porque o gateway já
verificou esse mesmo token nesta mesma requisição. Uma ida à rede a menos.

**Um caso de decisão de produto no código:** o logout **engole** erros do
GoTrue e sempre responde `{ok: true}`. Se o token já expirou ou a sessão já foi
encerrada em outro aparelho, tecnicamente o logout "falhou" — mas o que o
usuário queria (não estar mais logado) aconteceu. Devolver erro aqui seria
tecnicamente correto e praticamente inútil.

### 10.4 Supabase (banco, Storage, PostgREST)

**PostgREST** transforma o banco numa API REST automaticamente. O
`supabase-js` monta consultas com métodos encadeados:

```ts
db.from("entries").select("*").eq("user_id", id).order("occurred_at", {ascending: false})
```

**Onde isso não dá conta, o projeto usa RPC** (funções SQL chamadas pela API).
Foram duas situações reais:
- ordenar por uma expressão (`embedding <=> $1`) — o construtor só ordena por
  nome de coluna → virou `entries_search_by_embedding`;
- fazer `GROUP BY` — não é suportado → virou `dashboard_aggregate_counts`.

As duas são `SECURITY INVOKER`: rodam com o crachá de quem chamou, então a RLS
continua valendo. E nenhuma delas **recebe `user_id` como parâmetro** — não há
como pedir os dados de outra pessoa nem por engano.

**Storage:** um bucket privado `exports`, com caminho
`<user_id>/<job_id>/arquivo`. A política de acesso confere se o primeiro pedaço
do caminho é o id de quem está pedindo. O download não expõe o arquivo: gera uma
**URL assinada** válida por 60 segundos e redireciona.

### 10.5 O cache de replay: o truque que torna a IA determinística

Esta é a peça mais importante do projeto. Vale a pena entender bem.

**O problema.** Dois times constroem o mesmo app contra dois ambientes. O time A
manda "estou ansioso" para o chat e recebe uma resposta. O time B manda a mesma
coisa e recebe **outra** resposta, porque IA não é determinística. Quando o TCC
comparar os dois resultados, parte da diferença não será da metodologia — será
só ruído da IA.

**A solução, em uma frase:** chame a IA **uma vez**, guarde a resposta, e sirva
essa mesma resposta guardada para todo mundo dali em diante.

**Como o servidor sabe que dois pedidos são "o mesmo"?** Ele monta um envelope
com tudo que caracteriza a chamada e tira uma impressão digital:

```
{ operation: "chat",
  provider: "anthropic",
  model: "claude-sonnet-5",
  promptVersion: "v1",
  personaSnapshot: "empatico",
  input: { historyHash, historySeqs, userMessage, retrievedEntryIds } }
        ↓
  ordenar todas as chaves alfabeticamente
        ↓
  JSON.stringify  →  SHA-256  →  cache_key
```

**Por que ordenar as chaves?** Porque `JSON.stringify` respeita a ordem em que
as propriedades foram criadas. Dois trechos de código que montassem o mesmo
objeto preenchendo os campos em ordem diferente gerariam textos diferentes — e
portanto impressões digitais diferentes — para uma entrada **idêntica**. Seria
exatamente o bug que o mecanismo existe para impedir.

**Por que hashes de histórico em vez do histórico inteiro?** Porque uma conversa
longa geraria uma chave gigante. `historyHash` é o SHA-256 de todas as mensagens
concatenadas: qualquer mudança no histórico muda o hash, mas o tamanho é sempre
o mesmo.

**Os quatro modos:**

| Modo | O que faz | Quando se usa |
|---|---|---|
| `off` | Sempre chama a IA, não usa cache | Desenvolvimento normal |
| `record` | Usa cache; se não tiver, chama e **guarda** | Ao popular o cache pela primeira vez |
| `replay` | Igual a `record` | Uso normal com cache pronto |
| `replay_strict` | Usa cache; se não tiver, **falha** | No teste de determinismo |

`replay_strict` é o modo do gate de CI. Se qualquer chamada não encontrar
resposta no cache, o teste falha com `REPLAY_MISS` — em vez de silenciosamente
chamar a IA de verdade e produzir um resultado não reproduzível.

**Como isso vira o experimento:**

```
ciclo-a, modo record  → cache populado com respostas reais da IA
        ↓ replay-cache-export.ts
    arquivo JSON
        ↓ replay-cache-import.ts
ciclo-b               → mesmo cache, sem nunca chamar a IA
```

O script de importação **se recusa** a importar sobre um cache que já tem dados,
a menos que você force. Isso protege contra o pior cenário possível: alguém
rodar o roteiro em `record` no `ciclo-b` por engano, gerando respostas próprias
diferentes das do `ciclo-a`. Nada no HTTP acusaria — os dois ambientes
responderiam normalmente, só que com conteúdos diferentes, e a comparação
inteira estaria contaminada sem ninguém saber.

**Uma história real do projeto que mostra como isso é delicado.** O script que
preenche os embeddings do seed chamava a Voyage **fora** do cache. A cada reset
de banco, ele gerava embeddings novos para os mesmos 33 textos. A Voyage não
promete o mesmo vetor bit a bit em duas chamadas — e o resultado foi que a busca
devolvia a **mesma entrada, na mesma ordem**, mas com uma pontuação de
similaridade levemente diferente entre os ciclos (0,4852 contra 0,4845). Isso
derrubava a comparação byte a byte por um campo que nenhum provedor jamais
prometeu manter estável. A correção foi religar o script ao mesmo cache do resto
do projeto.

---

## 11. Testes: o que cada suíte prova e como rodar

O projeto tem **quatro** tipos de teste, e cada um prova algo que os outros não
conseguem.

### Testes de unidade (Deno) — 56 arquivos

```bash
deno test -A --parallel
```

Testam funções isoladas, sem banco e sem rede. Cobrem os schemas, todos os
módulos compartilhados, cada handler e os scripts.

**Como testam algo que fala com a internet, sem internet?** Injeção de
dependência. Toda função que precisaria de `fetch` recebe um `fetchImpl` como
parâmetro opcional. Em produção fica `undefined` e usa o `fetch` real; no teste,
você passa uma função de mentira que devolve o que quiser.

O mesmo truque aparece em vários lugares: `delayFn` (para não esperar 35
segundos de verdade num teste de timeout), `nowIso`, `verifyAccessToken`. É por
isso que a suíte roda em segundos.

### Testes do banco (pgTAP) — 20 arquivos

```bash
supabase test db
```

Testam o que só o banco pode provar. Os oito arquivos `rls_*.sql` seguem o mesmo
roteiro de 6 asserções para cada tabela:

1. a RLS está habilitada;
2. a RLS está **forçada**;
3. o usuário X vê a própria linha;
4. o usuário Y **não** vê a linha do X — e recebe **zero linhas, não erro**;
5. o usuário Y não consegue escrever na linha do X;
6. `anon` não lê nada.

O item 4 é o mais sutil. "Zero linhas" e "erro de permissão" parecem
equivalentes, mas não são: um erro **confirma** que a linha existe. Zero linhas
é indistinguível de "não existe". É a mesma lógica do 404 em vez de 403.

Os outros arquivos provam constraints, triggers, a cascata de exclusão, as RPCs
e a fila.

### Testes de contrato (Hurl) — 27 arquivos

```bash
hurl --jobs 1 --variable base_url=... tests/hurl/*.hurl
```

Arquivos `.hurl` são requisições HTTP escritas em texto, com asserções. Provam
que a API **de verdade**, rodando, responde o combinado. Cada endpoint tem o
mesmo roteiro base: caminho feliz, corpo inválido, sem token, recurso alheio.

> **Leia `tests/hurl/README.md` antes de rodar.** Ele tem cinco "achados reais"
> documentados que economizam horas — incluindo por que `127.0.0.1` não funciona
> na configuração do worker (o `pg_cron` roda **dentro** do container do
> Postgres, e de lá `127.0.0.1` é o próprio container).

### Teste de determinismo — o gate mais importante

```bash
bash tests/determinism/run.sh
```

Prova a propriedade central do projeto: **rodar a mesma jornada duas vezes,
contra bancos recém-criados, produz exatamente o mesmo resultado.**

```
1. Uma passada em modo record → popula o cache chamando a IA de verdade
2. Exporta o cache
3. Reset do banco → importa o cache → roda a jornada (replay_strict)
4. Reset do banco → importa o cache → roda de novo
5. Compara os dois resultados caractere por caractere
```

**O problema óbvio:** ids e timestamps mudam a cada execução por natureza. Como
comparar então? `normalize.ts` substitui cada UUID e cada timestamp por um
marcador **posicional**: o primeiro UUID vira `<uuid:0>`, o segundo `<uuid:1>`, e
o **mesmo** valor reaparecendo depois vira o **mesmo** marcador.

Isso é mais esperto do que simplesmente apagar os ids. Ele pega não só "os
valores mudaram" (óbvio, são gerados) mas **"a relação entre eles mudou"** — por
exemplo, se o id devolvido na criação deixasse de ser o mesmo id usado numa
leitura logo depois. Esse é um bug de determinismo real que um apagamento
simples não pegaria.

E os comentários desse arquivo contam **quatro falhas reais** que aconteceram na
primeira execução de verdade, cada uma com a correção:
- a latência do proxy Kong entrava na comparação (é tempo de CPU, nunca
  reproduzível);
- a URL assinada do download muda a cada geração, por desenho de segurança;
- o Postgres serializa datas com `+00:00` e o código gera `Z` — só metade dos
  timestamps normalizava;
- as tentativas intermediárias de "já ficou pronto?" pegavam o job em estados
  diferentes, porque o `pg_cron` acorda em relógio de parede.

Ler esses comentários é a melhor aula de "o que realmente dá errado em teste de
determinismo" que este repositório oferece.

### O que roda automaticamente

O CI (`.github/workflows/ci.yml`) tem dois jobs: `contracts` (testes de unidade
+ OpenAPI em dia) e `determinism`.

> ⚠️ pgTAP e Hurl **não** rodam no CI — precisam ser executados à mão.
> Ver seção 13, item D-23.

---

## 12. Convenções de código do repositório

Se você for mexer neste código, siga estes padrões — eles são consistentes em
todo o repositório.

**Organização**
1. `index.ts` é só fiação. Se você está escrevendo um `if` de negócio nele, está
   no arquivo errado.
2. Lógica de um endpoint só fica no diretório dele. Quando um segundo endpoint
   precisar, aí sim promova para `_shared/`.
3. Nenhum handler fala com o banco diretamente — vai pelo repositório do domínio.
4. Variáveis de ambiente são lidas **uma vez**, no topo do `index.ts`.

**Erros**
5. Sempre `throwError("CODIGO", "mensagem")`. Nunca `throw new CerneError(...)`.
6. Clientes genéricos (`ai/`, `gotrue`) lançam erro **próprio**; quem decide
   qual dos 13 códigos aquilo vira é o módulo de negócio. O mesmo erro da
   Anthropic vira `PII_CHECK_FAILED` num lugar e `AI_GENERATION_TIMEOUT` noutro.
7. Módulos de fallback **nunca lançam** — devolvem `{status: "failed"}`.
8. Recurso inexistente e recurso alheio dão a mesma resposta: 404.

**Determinismo** (o conjunto mais específico deste projeto)
9. Nunca `new Date()` fora de `clock.ts`.
10. Todo `ORDER BY` termina com `id ASC` como desempate.
11. Paginação por cursor, nunca `OFFSET`.
12. Toda chamada de IA passa por `withReplay`.

**Testabilidade**
13. Toda dependência externa é injetável.
14. Constantes congeladas são exportadas para o teste conferir o valor exato.

**Estilo**
15. TypeScript em modo estrito; `readonly` em interfaces de dados;
    `deno fmt` com largura de 100.
16. Comentários em português, identificadores em inglês.
17. **Todo arquivo começa com um comentário de cabeçalho** dizendo de onde veio,
    que decisão foi tomada, e — o mais valioso — **que erro real aconteceu**.

O item 17 é a melhor característica deste repositório. Compare:

> ❌ `// Adiciona timeout na chamada`
>
> ✅ `// fetch não tem timeout próprio — sem um signal, uma chamada que trava na
> rede nunca falha sozinha; fica pendurada até o teto externo do runtime matar o
> isolate inteiro. Achado rodando de verdade (media_ocr.hurl, T-041): as
> sub-requisições que não chegam a chamar a Anthropic respondem na hora; só as
> duas que chegam aqui travavam.`

O segundo ensina. O primeiro repete o que o código já diz. Se você acrescentar
código aqui, escreva no estilo do segundo.

---

## 13. Observações técnicas

Coisas que chamam atenção na leitura do código. **Esta seção só reporta** — as
propostas de correção estão em
[`DIVERGENCIAS_E_INCONSISTENCIAS.md`](DIVERGENCIAS_E_INCONSISTENCIAS.md), com os
mesmos identificadores (`D-NN`).

### A mais importante

**D-01 — O arquivo OpenAPI entregue publica endereços que não existem.**
Ele diz `/entries/{id}`; a URL de verdade é `{base}/entries-get/<id>`. E o
arquivo não tem bloco `servers:`, então nem a URL base está lá. Quem gerar um
cliente a partir dele vai tomar 404 em tudo. O próprio código registra a
divergência num comentário (`chat-messages-retry/index.ts:8-13`).

### Documentação que promete o que a API não entrega

- **D-07** — `docs/handoff/selo_sincronizacao.md` descreve `updatedAt` como
  "timestamp da última escrita no servidor para aquela entrada". Mas…
- **D-06** — …`entries.updated_at` **nunca é reescrito**. Nem quando o embedding
  é atualizado. Na prática, `updatedAt` é sempre igual a `createdAt`.
- **D-08** — …e `serverRevision` é contador **por usuário**, não por registro.
  Todos os itens de uma página trazem o mesmo número.
- Somando: dos dois campos que o documento oferece para reconciliação, nenhum dá
  sinal de mudança por registro. Além disso, o cabeçalho `X-Data-Version` só sai
  em 2 dos 5 endpoints de entrada.

### Contrato × implementação

- **D-02** — No OpenAPI, `/entries/{id}` vem antes de `/entries/search`. Num
  roteador REST comum, "search" seria confundido com um id. Aqui não dá
  problema (não há roteador), mas é armadilha para cliente gerado.
- **D-03** — O contrato diz que o campo `code` do erro é um dos 13. Mas um 500
  pode trazer `REPLAY_MISS` ou `INTERNAL_ERROR`, que não estão na lista. (A
  falha `malformed` também responde fora do envelope — isso é **de propósito**,
  é o objetivo dela.)
- **D-04** — A busca calcula `similarity: 1 - distance`. Como a distância de
  cosseno pode passar de 1, o valor pode ficar **negativo** — mas o schema exige
  entre 0 e 1.
- **D-05** — O `limit` está declarado como `.default(20).optional()`. O
  `.optional()` envolve o `.default()`, então o padrão nunca se aplica. Os
  handlers compensam com `?? 20`, mas o OpenAPI publica um padrão que o Zod não
  aplica.
- **D-11** — Quando a exportação falha fora da narrativa, o worker grava
  `status: "error"` mas **não preenche** `error_code`. O app recebe um erro sem
  código.

### Campos e estados sem uso

- **D-09** — `insights.status='dismissed'` e `dismissed_at` existem no banco e no
  contrato, mas nenhum endpoint os escreve. O documento de requisitos trata
  "descartar insight" como comportamento de tela, então funciona — as colunas é
  que ficam sem uso.
- **D-10** *(não é defeito)* — `tags` e `entry_tags` são preenchidas só pelo
  seed; nenhum endpoint cria ou filtra por tag. Isso é **decisão documentada e
  intencional** (`ux/Requisitos_e_Fluxo_de_Telas_TCC.md:167`) — a categorização
  não recebe implementação em nenhum dos dois ciclos. Registrado aqui só para
  quem ler o schema e estranhar.
- **D-13** — Os dois endpoints de dashboard sempre passam `periodEnd: null`. O
  parâmetro existe em toda a cadeia, mas nunca é usado.
- **D-17** — `chat-repo.nextSeq` é exportada e testada, mas o
  `chat-messages-send` calcula o `seq` por conta própria. A função não é usada
  em produção.

### Inconsistências internas

- **D-12** — Filtro de data diferente em lugares diferentes: a lista de entradas
  usa `<=` para `dateTo`; o dashboard, a exportação e a narrativa usam `<`. Uma
  entrada exatamente no limite aparece numa tela e não na outra.
- **D-14** — Os modos `record` e `replay` fazem **exatamente a mesma coisa** no
  código. A diferença existe só no processo de operação.
- **D-18** — Coisas repetidas que poderiam estar em um lugar só: a expressão
  regular de UUID (6 handlers), as funções de base64url (3 arquivos), a lista de
  status que permitem download (2), o schema de PII (2), e mais três tipos
  duplicados.

### Pontos frágeis

- **D-15** — Se `PROMPT_VERSION` tiver um valor desconhecido, o erro só aparece
  **dentro do handler**, virando um 500 genérico — em vez de falhar na subida da
  função com uma mensagem clara de configuração.
- **D-16** — O `export-worker` não usa o relógio congelável: ele chama
  `new Date()` direto e ignora `X-Test-Now`. Sem impacto no gate atual, mas o
  PDF sai com hora real.
- **D-19** — As três funções de `experiment` podem ser chamadas por qualquer
  usuário autenticado, fora do gateway. Isso sujaria infraestrutura de
  experimento, nunca dado de outro usuário — o trade-off está registrado na
  própria migração.
- **D-20** — O agendamento `'15 seconds'` exige uma versão razoavelmente nova do
  `pg_cron` (≥ 1.5). Nenhuma migração verifica isso.
- **D-21** — A fila apaga a mensagem logo depois de disparar a chamada HTTP, sem
  esperar confirmação. Se a chamada falhar, o job fica preso em `pending` para
  sempre — visível, mas sem nova tentativa automática.
- **D-22** — A falha `ai_timeout` é tratada por 3 handlers. Dois dos cinco
  endpoints "congelados" de injeção de falha (`entries-create` e `media-ocr`)
  simplesmente a ignoram.
- **D-30** — O gateway pergunta ao GoTrue "esse token é válido?" a **cada**
  requisição autenticada, sem cache nem verificação local da assinatura. É uma
  ida à rede no caminho de todas as chamadas.
- **D-31** — Ao apagar a conta, se a limpeza do bucket falhar, a conta é apagada
  do mesmo jeito e os arquivos ficam sem dono. Decisão consciente e documentada
  (perder o dado do usuário seria pior), registrada aqui pela consequência.
- **D-32** — A contagem de entradas é congelada no momento do pedido de
  exportação; o worker não recalcula. Se registros forem criados no meio, o
  número informado e o arquivo divergem.
- **D-33** — As duas RPCs de busca e agregação dependem **inteiramente** da RLS,
  sem o filtro explícito redundante que o resto do código mantém. É correto por
  desenho — registrado por ser o único ponto sem defesa em profundidade.
- **D-34** — `POST /entries` espera a Voyage responder antes de devolver. O
  fallback protege o dado, mas a rapidez do endpoint depende do provedor.
- **D-35** — O job que marca mensagens travadas mede o tempo desde a **criação**
  da mensagem (não existe `updated_at` em `chat_messages`). Uma geração legítima
  que passe de 60 segundos seria marcada `failed` **enquanto ainda transmite**.

### Processo e ambiente

- **D-23** — pgTAP e Hurl não rodam no CI. Só os testes de unidade e o gate de
  determinismo.
- **D-24** — O `ci.yml` diz que faltam secrets e que o job de determinismo
  falharia; o `normalize.ts` documenta achados de uma **execução real** desse
  mesmo job no GitHub Actions. Um dos dois textos está desatualizado.
- **D-25** — `docs/roteiro_de_validacao.md` ainda se declara "rascunho pendente
  de aprovação", e esse arquivo vai no pacote entregue aos dois ciclos.
- **D-26** — `prove-rf06.ts` importa a biblioteca de Postgres por URL, diferente
  dos outros scripts, que usam o mapa de importação.
- **D-27** — `verify_jwt = false` nas 24 funções. É a decisão certa e está
  documentada, mas significa que a autenticação é 100% responsabilidade do
  código.
- **D-28** — Três códigos de erro (`NETWORK_TIMEOUT`, `NETWORK_OFFLINE`,
  `RATE_LIMITED`) nunca surgem de condição real do servidor — só de injeção de
  falha.
- **D-29** — O logout esconde qualquer erro do GoTrue e sempre responde sucesso.
  Decisão deliberada; o cliente não consegue distinguir os dois casos.

---

## 14. Glossário completo

**`anon`** — papel do Postgres para quem não fez login. Neste projeto não lê
nada.

**`authenticated`** — papel do Postgres para quem fez login. É com ele que os 23
endpoints acessam o banco, sempre limitados pela RLS.

**base64** — jeito de representar dados binários (uma imagem) como texto, para
caber num JSON. Fica ~33% maior que o original.

**Cursor (paginação por)** — em vez de "me dê a página 3" (que muda se alguém
inserir dados), você diz "me dê o que vem **depois deste item**". Estável, e o
motivo de o projeto não usar `OFFSET`.

**Determinismo** — dar sempre o mesmo resultado para a mesma entrada. A
propriedade central deste projeto.

**Edge Function** — função que roda na nuvem sob demanda, sem servidor para
administrar.

**Embedding** — texto convertido em uma lista de 1024 números, onde significados
parecidos ficam numericamente próximos.

**Envelope** — o formato fixo que embrulha toda resposta: `{data, meta}` para
sucesso, `{code, message, retryable, requestId}` para erro.

**Fila (pgmq)** — lista de tarefas para processar depois. Aqui vive dentro do
próprio Postgres.

**Idempotência** — propriedade de uma operação que, repetida, dá o mesmo
resultado da primeira vez. Salvar o mesmo registro duas vezes cria um só.

**Injeção de dependência** — passar o que a função precisa como parâmetro em vez
de ela ir buscar. É o que permite testar sem rede e sem banco.

**JWT** — crachá digital assinado, com quem você é e até quando vale.

**Keyset pagination** — o mesmo que paginação por cursor.

**Migração** — arquivo SQL que muda a estrutura do banco, aplicado em ordem, uma
vez só por ambiente. Nunca se edita uma migração já aplicada.

**PII** — *Personally Identifiable Information*: dado que identifica uma pessoa
(nome, telefone, endereço, e-mail).

**pgvector** — extensão do Postgres que permite guardar embeddings e calcular
distância entre eles.

**pg_cron** — extensão que agenda tarefas dentro do próprio banco.

**pg_net** — extensão que permite ao banco fazer chamadas HTTP. Necessária
porque `pg_cron` sozinho só executa SQL, e acordar uma Edge Function exige HTTP.

**PostgREST** — serviço que expõe o Postgres como API REST automaticamente.

**Proxy fino** — endpoint que só repassa o pedido para outro serviço, sem lógica
própria. Os 4 endpoints de auth que falam com o GoTrue.

**RAG** — buscar trechos relevantes no seu próprio banco e incluí-los no pedido
à IA, para que ela responda com contexto.

**Replay (cache de)** — o mecanismo que guarda respostas de IA por impressão
digital da entrada, para que a mesma pergunta sempre produza a mesma resposta.
Ver 10.5.

**RLS** — trava dentro do banco que decide, linha a linha, quem pode ver o quê.

**RPC** — função SQL que pode ser chamada pela API. Usada quando o construtor de
consultas não dá conta.

**`SECURITY DEFINER` / `SECURITY INVOKER`** — uma função SQL `DEFINER` roda com
os privilégios de quem a **criou** (poderosa, usada com superfície mínima);
`INVOKER` roda com os de quem **chamou** (e portanto respeita a RLS).

**Seed** — dados de teste plantados no banco, iguais toda vez.

**`service_role`** — papel do Postgres que ignora a RLS e vê tudo. Neste projeto,
exclusivo do worker de exportação.

**SSE** — conexão que fica aberta com o servidor mandando pedaços conforme
produz. É o que faz o texto da IA aparecer aos poucos.

**Tool use (saída estruturada)** — pedir à IA que responda chamando uma
"ferramenta" com formato fixo, em vez de texto livre. Garante JSON válido.

**Trigger** — código que o banco executa sozinho quando algo acontece numa
tabela. Aqui: criar o perfil ao cadastrar usuário, incrementar contadores.

**UUID** — identificador único de 36 caracteres, aleatório o bastante para não
colidir.

**Zod** — biblioteca que descreve o formato esperado de um dado e valida. Os
schemas em `contracts/zod/` são feitos com ela.
