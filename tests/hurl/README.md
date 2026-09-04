# Suíte Hurl — Fase 3 (`T-034`–`T-041`)

Contrato de endpoint (§11.2 do plano técnico): caminho feliz, corpo
inválido → `VALIDATION_ERROR`, sem token → `AUTH_EXPIRED`, recurso de
outro usuário → `NOT_FOUND` (nunca `403`, D7). Mais as suítes específicas
nomeadas no plano: `idempotencia_rf10.hurl`, `tags_embutidas.hurl`,
`busca_and.hurl`, `busca_semantica.hurl`.

## Convenção de URL — importante

Os arquivos chamam `{{base_url}}/<nome-da-função>`, **não** o caminho REST
"bonito" do OpenAPI (`/entries/:id`, `/auth/login`, ...). Cada endpoint é
uma Edge Function própria (Seção 2: "um diretório por endpoint"), com nome
= o `id` do `registry.ts` (T-026) trocando `.` por `-` — decisão registrada
em `big-plan.md`, Fase 3. Ex.: `entries.get` → função `entries-get`,
chamada em `{{base_url}}/entries-get/<id>` (o `:id` vira o último segmento
da URL, extraído pelo próprio `index.ts`).

## Como rodar

Pré-requisitos: `supabase start` + `supabase functions serve --env-file
supabase/.env.local` rodando localmente (GATE-01, Docker), banco com o
seed da Fase 1 carregado (`supabase db reset`).

**O `--env-file` não é opcional** — sem ele, nenhuma variável de ambiente
(`ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `PROMPT_VERSION`, ...) chega até a
função, e `requireEnv` (`_shared/deps.ts`) lança um erro síncrono no
top-level do `index.ts`, fora de qualquer handler — isso derruba o worker
inteiro antes de processar a requisição, mesmo em endpoints/sub-passos
que não deveriam precisar de IA (ex.: a sub-requisição "sem token" do
`media_ocr.hurl`, que só checa auth). O sintoma na prática: a requisição
fica pendurada até o teto de wall-clock do runtime (150s local) e só
então volta um `504` — mesma aparência de trava que a nota abaixo
descreve, mas causa totalmente diferente (achado real, 04/09/2026).
`supabase/.env.local` está no `.gitignore` — nunca é versionado; precisa
de `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `PROMPT_VERSION`, `REPLAY_MODE`
(ver Seção 3.6 do plano técnico para a lista completa e onde conseguir
cada chave).

```bash
hurl --test \
  --variable base_url=http://127.0.0.1:54321/functions/v1 \
  --variable test_account_password='Cerne-Teste-2026!' \
  tests/hurl/*.hurl
```

`media_ocr.hurl` precisa de três variáveis extras, geradas a partir das
fixtures da `T-020` (não versionadas em base64 dentro do `.hurl` — os
arquivos de imagem já existem em `fixtures/media/`). **Usar
`--variables-file`, não `--variable`** — confirmado neste sandbox: o
valor em base64 da imagem "grande demais" (>5MB decodificados) estoura o
`ARG_MAX` do shell (2MB neste sistema) quando passado como argumento de
linha de comando; um arquivo de propriedades não tem esse limite.

Dois detalhes de portabilidade do `base64` entre sistemas (achados rodando
de verdade num Mac — confirmar antes de assumir que "é só rodar"):

- **Passar o arquivo por entrada padrão (`<`), não como argumento** — a
  variante do macOS (BSD) não aceita `base64 arquivo`, só `base64 -i
  arquivo` ou `base64 < arquivo`; a do Linux (GNU) aceita as duas formas.
  `<` funciona nas duas.
- **`| tr -d '\n'` é obrigatório** — sem isso, o `base64` quebra a saída em
  linhas de ~76 caracteres por padrão; um valor de propriedade com quebra
  de linha no meio vira uma linha nova sem `chave=`, e o Hurl reconstrói a
  variável errada. Confirmado num teste real: sem o `tr`, a requisição
  trava por ~2min e volta com um erro de timeout do motor de Edge
  Functions em vez do 401 esperado, porque o corpo da requisição fica
  malformado.

**Atualização — a trava voltou mesmo com o `.properties` correto (sem
quebra de linha), e a causa era outra:** o log local mostrava "wall clock
duration warning" seguido de "early termination has been triggered" — não
é um limite de tamanho de corpo, é o teto externo do próprio motor de Edge
Functions (150s local/free, 400s pago) matando o isolate à força quando
algo dentro dele nunca retorna. Investigando o código (`ai/anthropic.ts`,
`ai/voyage.ts`, T-032): a chamada `fetch` para a Anthropic/Voyage não
tinha nenhum timeout próprio — se a rede travar (egress do Docker local,
DNS, etc.), a promise nunca resolve nem rejeita sozinha, e só o teto
externo do runtime interrompe, produzindo esse log em vez do erro normal
do envelope do projeto. Bate exatamente com o sintoma: as sub-requisições
de `media_ocr.hurl` que nunca chegam a chamar a Anthropic (401 sem token,
413 de imagem grande) respondiam na hora; só as duas que chamam
`performOcr` de verdade (imagem ilegível, caminho feliz) travavam.
Corrigido adicionando `signal: AbortSignal.timeout(30_000)` nos dois
clientes (`ANTHROPIC_REQUEST_TIMEOUT_MS`/`VOYAGE_REQUEST_TIMEOUT_MS`) —
uma chamada presa agora falha em 30s com um erro normal (`AI_GENERATION_
TIMEOUT` no OCR; cai no fallback `status: 'failed'` já existente no
embedding de `POST /entries`, D8) em vez de segurar o isolate até ele ser
morto de fora. Se a trava ainda acontecer depois disso, o próximo suspeito
é egress de rede do container Docker local até `api.anthropic.com`/
`api.voyageai.com` (fora do que dá pra testar neste sandbox — sem acesso a
Docker/rede real).

```bash
{
  printf 'image_base64='; base64 < fixtures/media/ocr_fixture_01.png | tr -d '\n'; echo
  printf 'image_base64_illegible='; base64 < fixtures/media/ocr_fixture_ilegivel.png | tr -d '\n'; echo
  printf 'image_base64_oversized='; head -c 6000000 /dev/urandom | base64 | tr -d '\n'; echo
} > /tmp/hurl-ocr-vars.properties

hurl --test \
  --variable base_url=http://127.0.0.1:54321/functions/v1 \
  --variable test_account_password='Cerne-Teste-2026!' \
  --variables-file /tmp/hurl-ocr-vars.properties \
  tests/hurl/media_ocr.hurl
```

## Contas do seed usadas (Fase 1, `supabase/seed/seed.sql`)

| Conta | E-mail | `user_id` |
|---|---|---|
| A (`cenario-cheio`) | `cenario-cheio@cerne.test` | `a0000000-0000-0000-0000-000000000001` |
| B (`cenario-uma`) | `cenario-uma@cerne.test` | `b0000000-0000-0000-0000-000000000001` |

Senha única: `TEST_ACCOUNT_PASSWORD` (`Cerne-Teste-2026!`, documentado em
`supabase/seed/ancora.md`).

## Nota de ambiente

Escritos neste sandbox e validados em duas camadas, mas **nunca contra o
stack real do Supabase** (bloqueio de rede de Docker, mesma nota das
Fases 1/2/3):
1. Sintaxe: `hurlfmt --check` em todos os 10 arquivos.
2. Semântica das asserções: um mock HTTP local (Deno, descartado — não faz
   parte do repositório) imitando as respostas plausíveis dos 10
   endpoints, rodando a suíte inteira de ponta a ponta contra ele. Isso
   pegou dois erros reais de sintaxe jsonpath do Hurl que só apareceriam
   rodando de verdade — documentados como comentário em
   `tags_embutidas.hurl` (encadear `[0]` depois de um filtro `[?(...)]`
   não funciona como parece; a forma certa usa `[*]` + `count`/`contains`)
   — e a descoberta do `--variables-file` acima (`ARG_MAX` do shell).

Rodar contra o stack local de verdade (Docker, `supabase functions serve`)
é uma ação do Wagner. `entries_create.hurl`, `idempotencia_rf10.hurl`,
`busca_semantica.hurl` e `entries_search.hurl` fazem chamadas reais à
Anthropic/Voyage (nenhum cache de replay populado ainda — isso só
acontece no `T-060`, Fase 6) — custo pequeno, dentro do teto de gasto do
`GATE-04`/`GATE-05`.
