# Âncora de data do seed

```
ANCORA = 2026-09-23T09:41:00Z
```

Toda data usada em `seed.sql` é calculada como um deslocamento a partir desta
âncora (ex.: `ANCORA - interval '3 days'`), nunca uma data absoluta escrita à
mão. Isso mantém o seed determinístico independentemente de quando for
executado — rodar `supabase db reset` hoje ou em 2027 produz exatamente as
mesmas datas relativas.

`ANCORA` é o instante de congelamento do backend (Fase 7, 23/09/2026),
propositalmente no futuro em relação a todas as datas do seed — as 34
entradas da conta A ficam distribuídas nos 10 dias **anteriores** à âncora.

## Senha das três contas de teste

O plano técnico (§6.2) pede uma senha única controlada por
`TEST_ACCOUNT_PASSWORD`. Na prática, `seed.sql` é executado como SQL puro
pelo runner do Supabase CLI, sem suporte a metacomandos de shell/`psql`
(`\getenv`, `\set`) — não há como o arquivo ler uma variável de ambiente do
host em tempo de execução.

Por isso a senha está **fixada como literal dentro do `seed.sql`**:

```
Cerne-Teste-2026!
```

O secret/variável `TEST_ACCOUNT_PASSWORD` (GitHub Actions, `.env.local`, o
que for) precisa ser configurado com **exatamente esse valor** — é ele que os
testes Hurl e o roteiro de validação usam para logar nas três contas.

Se o Wagner preferir outra senha: trocar o literal em `seed.sql`, rodar
`supabase db reset` de novo, e atualizar `TEST_ACCOUNT_PASSWORD` para bater.

## Embeddings reais da conta A

Pelo mesmo motivo (SQL puro não faz chamada HTTP), `seed.sql` não chama a
Voyage diretamente. As entradas da conta A entram com `embedding_status =
'pending'` e `embedding = NULL`. Depois do `supabase db reset`, rodar uma vez:

```
deno run --allow-net --allow-env scripts/backfill-seed-embeddings.ts
```

O script busca as entradas `pending` da conta A, chama a Voyage
(`voyage-4`, 1024 dimensões, `input_type='document'`) e grava o embedding —
é idempotente, só toca em linhas ainda `pending`. A única entrada
propositalmente `embedding_status = 'failed'` (para os estados de UI
existirem, T-022) nunca é tocada por este script.
