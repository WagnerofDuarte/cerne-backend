<!-- Roteiro de execução do T-064 (Fase 7, Plano técnico §12) — escrito para o
Wagner rodar na máquina local, contra Docker + os 3 projetos Supabase de
verdade. Nenhum passo daqui foi executado de ponta a ponta contra
`ciclo-a`/`ciclo-b` reais — mesmo bloqueio de rede/Docker de todo T-0xxv
anterior. O ferramental novo (schema-hash.ts, gen-handoff-docs.ts,
build-handoff-package.sh) já foi validado contra Postgres real neste
sandbox; o resto segue o padrão já confirmado nas suítes Hurl/roteiro de
validação das Fases 3-6, só que pela primeira vez contra `ciclo-a`/
`ciclo-b`, não `dev`. -->

# Roteiro de congelamento (T-064) — passo a passo

Este documento cobre os 10 passos do Plano técnico §12, na ordem. Cada
passo diz o comando, o que esperar, e onde a leitura literal do
documento-fonte deixou uma ambiguidade que eu resolvi de um jeito
específico (marcado **⚠️ leitura assumida** — revisar se parecer errado,
regra nº4 do big-plan: não preencher lacuna calada).

**Antes de começar:** `git pull origin fase7` (este roteiro e o
ferramental dos passos 3/10 só existem a partir daí).

---

## Passo 0 — Preparação de `ciclo-a`/`ciclo-b` (não numerado no §12, mas obrigatório antes do passo 2)

Nenhuma fase anterior tocou `ciclo-a`/`ciclo-b` — só `dev` (local, via
Docker). Isso significa duas coisas que o §12 não escreve explicitamente
porque as trata como já resolvidas, mas que precisam acontecer aqui pela
primeira vez, por projeto (`ciclo-a` e depois `ciclo-b`):

1. **Configurar os segredos do projeto** (Supabase Dashboard → Project
   Settings → Edge Functions → Secrets, ou `supabase secrets set --project-ref <ref>`):
   `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `PROMPT_VERSION`, `TEST_FAULT_KEY`,
   `TEST_ACCOUNT_PASSWORD` (`Cerne-Teste-2026!`, o mesmo do seed —
   `supabase/seed/ancora.md`), `EXPORT_WORKER_SECRET` (qualquer string,
   mesmo valor que vai para o passo 0.3 abaixo), `OCR_MAX_BYTES`.
   ⚠️ **Decisão sua:** reaproveitar as MESMAS chaves `ANTHROPIC_API_KEY`/
   `VOYAGE_API_KEY` de `dev` (mesma conta, mesmo teto de gasto), ou gerar
   uma chave dedicada por ambiente? O big-plan não especifica. Reaproveitar
   é mais simples e o gasto de IA do projeto inteiro já foi estimado abaixo
   de US$20 (§14.5) — mas registrar aqui a escolha, para constar.

2. **Deploy das Edge Functions** — `supabase link --project-ref <ref-do-ciclo>`
   seguido de `supabase functions deploy` (todas de uma vez). É a
   **primeira vez** que este projeto roda `functions deploy` — até aqui só
   `functions serve` local. Se algum comportamento divergir entre o
   runtime local e o runtime de produção do Supabase, é um achado real,
   não um erro seu — documentar aqui.

3. **Configurar `experiment.worker_config`** (o worker de exportação não
   desperta sem isso — nota já registrada em `tests/hurl/README.md`
   desde a Fase 5):
   ```bash
   SUPABASE_DB_URL='<connection string do ciclo>' \
   FUNCTIONS_BASE_URL='https://<ref-do-ciclo>.supabase.co/functions/v1' \
   EXPORT_WORKER_SECRET='<o mesmo valor do passo 0.1>' \
     deno run --allow-net --allow-env scripts/configure-worker.ts
   ```
   Diferença do uso local: `FUNCTIONS_BASE_URL` aqui é a URL pública do
   projeto, não `host.docker.internal` (isso só existia porque
   `pg_net` local roda dentro do container Docker do Postgres; em produção
   gerenciada, `pg_net` já sai direto para a internet).

Repetir os 3 sub-passos para `ciclo-b`.

---

## Passo 1 — `dev`: `supabase db reset` do zero

```bash
supabase db reset
```
**Esperado:** as 20 migrações + o seed aplicam sem erro (mesmo resultado
já confirmado no `T-019v`/Fase 5 — só reconfirmando antes do congelamento
oficial).

---

## Passo 2 — Aplicar migrações em `ciclo-a` e `ciclo-b`

```bash
supabase link --project-ref <ref-do-ciclo>
supabase db push
```

⚠️ **Leitura assumida:** o §12 diz literalmente só "aplicar migrações",
mas o passo 6 (roteiro em `record`) depende da conta A do seed já existir
em `ciclo-a` com embeddings reais — e o passo 7 exige o mesmo em
`ciclo-b`. Interpreto que este passo também precisa (fora do texto
literal do §12, mas exigido pela mecânica dos passos seguintes):

```bash
# seed.sql é SQL puro — mesma conexão direta usada pelos outros scripts
psql '<connection string do ciclo>' -f supabase/seed/seed.sql

# backfill dos embeddings reais da conta A (idempotente — Fase 1, T-022)
SUPABASE_DB_URL='<connection string do ciclo>' VOYAGE_API_KEY='<...>' \
  deno run --allow-net --allow-env scripts/backfill-seed-embeddings.ts
```

Repetir os 3 comandos (link/push, seed, backfill) para `ciclo-b` também
— **antes** de seguir para o passo 3, para a comparação de estrutura já
nascer sobre uma base idêntica de verdade (o hash do passo 3 não olha
dado nenhum, só estrutura, então seed/backfill não mudam o resultado do
passo 3 — mas fazer isso agora evita ter que lembrar de voltar aqui
depois, antes do passo 6/7).

**Como confirmo:** `supabase db push` sem erro nos dois; `select count(*) from entries where user_id = 'a0000000-0000-0000-0000-000000000001'`
dá 34 nos dois, igual ao `dev`.

---

## Passo 3 — Hash do schema dos três ambientes

Ferramenta pronta e validada nesta sessão: `scripts/schema-hash.ts`.

```bash
SUPABASE_DB_URL='<connection string do dev>'     deno run -A scripts/schema-hash.ts --out /tmp/schema-dev.txt
SUPABASE_DB_URL='<connection string do ciclo-a>' deno run -A scripts/schema-hash.ts --out /tmp/schema-ciclo-a.txt
SUPABASE_DB_URL='<connection string do ciclo-b>' deno run -A scripts/schema-hash.ts --out /tmp/schema-ciclo-b.txt
```

**Como confirmo:** os 3 hashes impressos no stdout são **idênticos**. Se
não forem: `diff /tmp/schema-dev.txt /tmp/schema-ciclo-a.txt` (e o mesmo
par com `ciclo-b`) mostra exatamente qual objeto diverge — reportar antes
de seguir, nunca ajustar o script para "fazer bater" (regra do apêndice:
"ajustar um teste para fazê-lo passar destrói o valor do instrumento").

Se o script falhar com "Regra inviolável nº7 violada": pare — significa
que um índice vetorial aproximado (HNSW/IVFFlat) foi criado em algum lugar
fora das migrações versionadas.

---

## Passo 4 — `supabase test db` nos três

```bash
supabase test db                                      # dev (link já aponta pra ele por padrão)
supabase link --project-ref <ref-ciclo-a> && supabase test db
supabase link --project-ref <ref-ciclo-b> && supabase test db
```
**Esperado:** 100% verde nos três (mesma suíte de 20 arquivos pgTAP já
100% verde em `dev` desde a Fase 5 — `Files=20, Tests=127, Result: PASS`
era o último número confirmado).

---

## Passo 5 — Suíte Hurl completa contra `ciclo-a` e `ciclo-b`

Mesmo comando de sempre (`tests/hurl/README.md`), só trocando `base_url`
para o domínio público do projeto:

```bash
hurl --test --jobs 1 \
  --variable base_url=https://<ref-do-ciclo>.supabase.co/functions/v1 \
  --variable test_account_password='Cerne-Teste-2026!' \
  --variable test_fault_key='<TEST_FAULT_KEY configurado no passo 0.1>' \
  --variables-file /tmp/determinism-ocr-vars.properties \
  tests/hurl/*.hurl
```
(o arquivo de variáveis da fixture de OCR pode ser gerado como em
`ci.yml`: `{ printf 'ocr_image_base64='; base64 < fixtures/media/ocr_fixture_01.png | tr -d '\n'; echo; } > /tmp/determinism-ocr-vars.properties`)

Repetir para `ciclo-b`. **Esperado:** `Success` nos dois, mesmo total de
requisições já visto contra `dev` na Fase 5 (26 arquivos, ajustado pelos
retries do worker assíncrono).

---

## Passo 6 — Roteiro em `record` **só em `ciclo-a`**; exportar o cache

```bash
supabase secrets set --project-ref <ref-ciclo-a> REPLAY_MODE=record
```
⚠️ **Ponto de atenção, não confirmado nesta sessão:** não sei se um
secret novo exige redeploy da função para valer em produção gerenciada
(local, `functions serve --env-file` lê o arquivo a cada início). Se o
roteiro abaixo não gravar nada em `ai_replay_cache`, o primeiro passo a
checar é rodar `supabase functions deploy` de novo depois do `secrets set`.

```bash
hurl --test --jobs 1 \
  --variable base_url=https://<ref-ciclo-a>.supabase.co/functions/v1 \
  --variables-file /tmp/determinism-ocr-vars.properties \
  tests/determinism/roteiro_validacao.hurl
```

```bash
SUPABASE_DB_URL='<connection string do ciclo-a>' \
  deno run -A scripts/replay-cache-export.ts --out /tmp/cache-ciclo-a.json
```

**Como confirmo:** `Success` no roteiro; o export relata quantas linhas
saíram (esperar algo perto das 22 entradas/3 hits já vistos na 1ª
gravação real da Fase 6, T-060 — os números exatos podem variar um pouco
conforme a resposta da IA daquele dia, isso é esperado).

---

## Passo 7 — Reexecutar em `replay_strict` nos dois, zero `REPLAY_MISS`

```bash
# importar o MESMO cache em ciclo-b — nunca gravar de novo lá (armadilha
# do apêndice: "gravar o cache duas vezes anula o mecanismo de replay")
SUPABASE_DB_URL='<connection string do ciclo-b>' \
  deno run -A scripts/replay-cache-import.ts --in /tmp/cache-ciclo-a.json

supabase secrets set --project-ref <ref-ciclo-a> REPLAY_MODE=replay_strict
supabase secrets set --project-ref <ref-ciclo-b> REPLAY_MODE=replay_strict
```

Rodar `tests/determinism/roteiro_validacao.hurl` (mesmo comando do passo
6, trocando o `base_url`) contra **os dois**. **Como confirmo:** `Success`
nos dois, e nenhuma resposta com `X-Replay-Status: miss` — `replay_strict`
por design faz a chamada falhar alto num miss (Fase 2, `T-030`), então
qualquer coisa diferente de `Success` já é o sinal de um `REPLAY_MISS`.

Opcional, mas recomendado para ter o mesmo tipo de prova byte-a-byte já
feito na Fase 6: rodar `tests/determinism/compare.ts` entre o relatório
Hurl de `ciclo-a` e o de `ciclo-b` (normalizando IDs/timestamps, mesma
mecânica do job `determinism` do CI) — isso não está automatizado para
apontar a URLs externas ainda; se quiser, eu adapto `tests/determinism/run.sh`
para aceitar isso como um próximo passo, mas o `roteiro_validacao.hurl --test`
sozinho já produz um `report.json` por execução que dá pra comparar à mão
com `compare.ts <a>/report.json <b>/report.json`.

---

## Passo 8 — Job `determinism` verde

Não é uma execução nova contra `ciclo-a`/`ciclo-b` — é o job do
`ci.yml`, que sobe seu próprio Postgres efêmero dentro do runner (não
depende de `dev`/`ciclo-a`/`ciclo-b`). Já confirmado verde no GitHub
Actions real na Fase 6 (`T-062`/`T-063v`). **Como confirmo agora:**
reconferir que ele continua verde no commit/tag que vai ser congelado —
`workflow_dispatch` no branch `fase7` (ou já a tag, se `T-065` já tiver
rodado), mesmo gatilho manual que a Fase 6 deixou pronto em `ci.yml`.

---

## Passo 9 — `fault_injection_log`: os 15 cenários

⚠️ **Leitura assumida:** o §12 não diz em qual ambiente. Como isso prova
um mecanismo (injeção de falha), não um dado que precisa ser idêntico
entre ambientes, recomendo rodar em **`ciclo-a` e `ciclo-b`** (ambos vão
ser usados de verdade pelos ciclos comparativos) — mas se preferir só
confirmar em um dos dois para economizar os ~3 minutos de espera (5
timeouts de 35s) da segunda rodada, isso também atende a leitura literal.

```bash
TEST_FAULT_KEY='<...>' hurl --test --jobs 1 \
  --variable base_url=https://<ref-do-ciclo>.supabase.co/functions/v1 \
  --variable test_account_password='Cerne-Teste-2026!' \
  --variable test_fault_key='<TEST_FAULT_KEY>' \
  tests/hurl/falhas_15.hurl

SUPABASE_DB_URL='<connection string do ciclo>' \
BASE_URL='https://<ref-do-ciclo>.supabase.co/functions/v1' \
TEST_FAULT_KEY='<...>' \
  deno run -A scripts/verify-fault-injection-log.ts
```
**Como confirmo:** `Success` no `.hurl` (12/12); o script confirma os 5
`offline` sem resposta e as **15/15 combinações distintas** em
`experiment.fault_injection_log`.

---

## Passo 10 — Montar `docs/handoff/`

Ferramental pronto e testado nesta sessão:

```bash
deno run -A scripts/gen-handoff-docs.ts   # regenera os .md com o estado final

# clonar/criar o repositório de handoff vazio antes (ver T-065/GATE-11),
# depois:
bash scripts/build-handoff-package.sh --out <caminho-do-clone-do-handoff>
```

Dentro do clone: preencher `credenciais/ciclo-a.md`/`ciclo-b.md` à mão
(nunca gerado por script), revisar, `git add -A && git commit && git push`.

---

## Depois dos 10 passos — `T-065`/`GATE-11`

1. `git tag backend-v1.0-frozen && git push origin backend-v1.0-frozen`
2. Proteger o ramo principal (GitHub → Settings → Branches → Branch protection rules).
3. Publicar o repositório de handoff (eu crio via GitHub assim que você confirmar o nome — combinado: `cerne-backend-handoff`, privado).

---

## Pendência que atravessa este roteiro, não resolvida aqui

O item do checklist final "protótipo congelado, com hash registrado no
documento de requisitos" depende de arquivos que você disse que ia me
passar (`Cerne_-_prototipo_final.html`, `Requisitos_e_Fluxo_de_Telas_TCC.md`,
e o `Ciencia_Orientador_Divergencias_de_Escopo.md`) — ainda não recebidos
nesta sessão. Assim que chegarem, calculo o hash e registro onde os
documentos-fonte pedem.
