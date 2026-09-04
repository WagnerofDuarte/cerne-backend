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

Pré-requisitos: `supabase start` + `supabase functions serve` rodando
localmente (GATE-01, Docker), banco com o seed da Fase 1 carregado
(`supabase db reset`).

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
