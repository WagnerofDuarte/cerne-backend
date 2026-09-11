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

**Achados reais desta sessão, ao configurar `ciclo-a` — válidos também
para `ciclo-b`:**
- **"Direct connection" pode não resolver (`ENOTFOUND`)** — o host
  `db.<ref>.supabase.co` só existe via IPv6 em projetos novos, e nem toda
  rede tem IPv6 funcional. Usar a aba **Session pooler** da mesma tela de
  Connection String em vez de Direct connection —
  `postgresql://postgres.<ref>:<senha>@aws-0-<região>.pooler.supabase.com:5432/postgres`.
  Reparar que o usuário muda de `postgres` para `postgres.<ref>`.
- **Senha do banco com caractere `@` quebra a connection string** — `@` é
  o separador entre credencial e host numa URL; se a senha em si contém
  um `@`, precisa virar `%40` só na hora de montar essa URL (a senha real
  no Supabase não muda). Alternativa mais simples: resetar a senha do
  banco desse projeto (Database → Settings → Reset database password)
  pra uma sem `@`/`:`/`/`.
- **A ordem do Passo 0 original estava errada** — configurar
  `experiment.worker_config` (sub-passo 3) precisa vir **depois** do
  Passo 2 (migrações), não antes: essa tabela só existe depois que as
  migrações rodam. Corrigido abaixo.

---

## Passo 0 — Preparação de `ciclo-a`/`ciclo-b` (não numerado no §12, mas obrigatório antes do passo 2)

Nenhuma fase anterior tocou `ciclo-a`/`ciclo-b` — só `dev` (local, via
Docker). Isso significa coisas que o §12 não escreve explicitamente
porque as trata como já resolvidas, mas que precisam acontecer aqui pela
primeira vez, por projeto (`ciclo-a` e depois `ciclo-b`):

1. **Configurar os segredos do projeto** (Supabase Dashboard → Project
   Settings → Edge Functions → Secrets, ou `supabase secrets set --project-ref <ref>`):
   `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `PROMPT_VERSION`, `TEST_FAULT_KEY`,
   `TEST_ACCOUNT_PASSWORD` (`Cerne-Teste-2026!`, o mesmo do seed —
   `supabase/seed/ancora.md`), `EXPORT_WORKER_SECRET` (qualquer string,
   mesmo valor que vai para o passo 0.3 abaixo), `OCR_MAX_BYTES`
   (⚠️ **achado real** — o valor certo é **`5242880`**, 5MB, documentado
   no plano técnico §3.6; um valor pequeno de exemplo digitado à mão
   aqui fez `media_ocr.hurl` falhar com `413` em todo caso, inclusive o
   que deveria dar `400 OCR_NO_TEXT` — corrigido em `ciclo-a` rodando
   `supabase secrets set --project-ref <ref> OCR_MAX_BYTES=5242880`).
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

3. ⚠️ **Achado real desta sessão — ordem corrigida:** a versão original
   deste roteiro pedia pra configurar `experiment.worker_config` aqui, no
   Passo 0. Está errado: essa tabela só é CRIADA pelas migrações (Passo 2,
   abaixo) — tentar configurá-la antes disso falha com `relation
   "experiment.worker_config" does not exist` (confirmado rodando de
   verdade contra `ciclo-a`). **Este sub-passo foi movido pra depois do
   Passo 2** — ver lá.

Repetir os 2 sub-passos (1 e 2) para `ciclo-b`.

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
# PROMPT_VERSION é obrigatório aqui também (achado real desta sessão) —
# entra na chave do cache de replay (T-062), mesmo valor do passo 0.1.
SUPABASE_DB_URL='<connection string do ciclo>' \
VOYAGE_API_KEY='<...>' \
PROMPT_VERSION='<o mesmo valor do passo 0.1>' \
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

**Agora sim, com a estrutura já criada — o sub-passo 0.3 que tinha sido movido:**
```bash
SUPABASE_DB_URL='<connection string do ciclo>' \
FUNCTIONS_BASE_URL='https://<ref-do-ciclo>.supabase.co/functions/v1' \
EXPORT_WORKER_SECRET='<o mesmo valor do passo 0.1>' \
  deno run --allow-net --allow-env scripts/configure-worker.ts
```
Diferença do uso local: `FUNCTIONS_BASE_URL` aqui é a URL pública do
projeto, não `host.docker.internal` (isso só existia porque `pg_net`
local roda dentro do container Docker do Postgres; em produção
gerenciada, `pg_net` já sai direto para a internet). Repetir para
`ciclo-b` também.

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

⚠️ **Achado real, confirmado rodando contra `ciclo-a`: 3 coisas precisam
de atenção ANTES de rodar isto, senão 3 arquivos falham (nenhum é bug de
código):**

1. **"Confirm email" vem ligado por padrão num projeto Supabase novo na
   nuvem** — `supabase/config.toml` desliga isso (`enable_confirmations =
   false`) só para o stack local; não é aplicado a `ciclo-a`/`ciclo-b`
   por nenhum `db push`/`functions deploy`. Sem desligar, `auth-signup`
   não libera sessão (sintoma: `account_delete.hurl` falha com `401` em
   vez de `200` no signup). **Desligar manualmente**: painel do projeto →
   Authentication → Providers → Email → desligar "Confirm email".
2. **`media_ocr.hurl` precisa de 3 variáveis, não 1** — o bloco de
   `ci.yml`/`tests/determinism` (uma variável, `ocr_image_base64`) é de
   OUTRO arquivo. Para `tests/hurl/media_ocr.hurl`, gerar assim (bloco
   correto, já documentado em `tests/hurl/README.md`):
   ```bash
   {
     printf 'image_base64='; base64 < fixtures/media/ocr_fixture_01.png | tr -d '\n'; echo
     printf 'image_base64_illegible='; base64 < fixtures/media/ocr_fixture_ilegivel.png | tr -d '\n'; echo
     printf 'image_base64_oversized='; head -c 6000000 /dev/urandom | base64 | tr -d '\n'; echo
   } > /tmp/hurl-ocr-vars.properties
   ```
3. **`tests/hurl/retry_chat.hurl` não entra no `*.hurl` (roda sozinho)**
   — ele mesmo documenta isso no topo do arquivo: só passa com
   `REPLAY_MODE=record`/`replay`, e em `REPLAY_MODE=off` (o padrão)
   nunca bate `X-Replay-Status: hit`. Mesmo padrão usado em toda fase
   anterior — nunca foi bundlado com o resto.

```bash
hurl --test --jobs 1 \
  --variable base_url=https://<ref-do-ciclo>.supabase.co/functions/v1 \
  --variable test_account_password='Cerne-Teste-2026!' \
  --variable test_fault_key='<TEST_FAULT_KEY configurado no passo 0.1>' \
  --variables-file /tmp/hurl-ocr-vars.properties \
  $(ls tests/hurl/*.hurl | grep -v retry_chat.hurl)
```

Depois, `retry_chat.hurl` sozinho (pode deixar `REPLAY_MODE=record`
configurado a partir daqui — o passo 6 já precisa dele assim mesmo em
`ciclo-a`; para `ciclo-b`, lembrar de setar de volta antes do passo 7,
que já faz isso de qualquer forma):
```bash
supabase secrets set --project-ref <ref-do-ciclo> REPLAY_MODE=record

hurl --test --jobs 1 \
  --variable base_url=https://<ref-do-ciclo>.supabase.co/functions/v1 \
  --variable test_account_password='Cerne-Teste-2026!' \
  tests/hurl/retry_chat.hurl
```

Repetir tudo para `ciclo-b`. **Esperado:** `Success` em todos os arquivos
nos dois ambientes.

**✅ `ciclo-a` confirmado em 11/09/2026 — 27/27 arquivos verdes**, depois
dos 4 achados acima corrigidos (Confirm email, variáveis do OCR,
`OCR_MAX_BYTES`, `retry_chat.hurl` separado). `REPLAY_MODE` ficou em
`record` em `ciclo-a` desde então (necessário para o passo 6 de qualquer
forma). Faltando: repetir em `ciclo-b`, já com as 4 correções desde o
início (não deveria achar nada novo lá).

⚠️ **Antes do Passo 6:** esta suíte deixa entradas de teste na conta A
do seed (`entries_create.hurl`, `idempotencia_rf10.hurl`, etc.) — ver a
limpeza obrigatória no início do Passo 6, tanto em `ciclo-a` quanto,
depois, em `ciclo-b`.

---

## Passo 6 — Roteiro em `record` **só em `ciclo-a`**; exportar o cache

⚠️ **Achado real, confirmado em `ciclo-a`: rodar o Passo 5 antes deste
suja a conta A do seed.** Vários arquivos da suíte Hurl (`entries_create.
hurl`, `idempotencia_rf10.hurl`, etc.) criam entradas de verdade na conta
`cenario-cheio@cerne.test` — as mesmas 34 entradas fixas que o roteiro
deste passo espera encontrar. Sintoma: `dashboard-aggregate-get` no
roteiro falha com `totals.count` maior que 34. **Antes de rodar o
roteiro, sempre limpar as entradas extras** (todas as 34 do seed têm id
com o prefixo `a0000000-0000-0000-0004-`; qualquer outra pertencente à
conta A é resíduo de teste):

```bash
# 1. Conferir o que sobrou, sem apagar nada ainda:
psql '<connection string do ciclo>' \
  -c "select id, source, content, created_at from entries where user_id = 'a0000000-0000-0000-0000-000000000001' and id::text not like 'a0000000-0000-0000-0004-%' order by created_at;"

# 2. Apagar só o que aparecer ali (IDs específicos, nunca um DELETE genérico):
psql '<connection string do ciclo>' \
  -c "delete from entries where id in ('<id-1>', '<id-2>', ...);"

# 3. Confirmar que voltou a 34:
psql '<connection string do ciclo>' \
  -c "select count(*) from entries where user_id = 'a0000000-0000-0000-0000-000000000001';"
```
(A outra contagem do roteiro, mais adiante, já é `>= 38` — tolerante a
entradas extras, não precisa de limpeza. Só a de `totals.count == 34`
exige a conta intocada.)

```bash
supabase secrets set --project-ref <ref-ciclo-a> REPLAY_MODE=record
```
✅ **Confirmado nesta sessão:** um `secrets set` novo já vale sem precisar
de `functions deploy` de novo — não é preciso redeployar depois de trocar
`REPLAY_MODE`.

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

⚠️ **Achado real, confirmado — precisa "recriar o banco" antes de cada
reexecução, nos dois ambientes, mesmo `ciclo-a` (que já rodou o roteiro
uma vez no passo 6):** o roteiro (Bloco 7) cria entradas de verdade, e o
`seed.sql` é só aditivo (`on conflict do nothing`, nunca apaga nada) —
então rodar o roteiro de novo sem limpar antes falha a mesma asserção de
contagem fixa do Passo 5/6 (`dashboard-aggregate-get`, `totals.count`).
Como não existe `supabase db reset` contra um projeto remoto, o
equivalente é: truncar as tabelas que o uso normal muda, recarregar o
seed, e (só em `ciclo-b`) importar o cache — **nunca truncar
`experiment.ai_replay_cache` em `ciclo-a`** (é a gravação original que
tudo depende).

**Em `ciclo-a`** (só limpa os dados, cache fica intacto):
```bash
psql '<connection string do ciclo-a>' \
  -c "truncate table entries, chat_sessions, chat_messages, insights, export_jobs cascade;"

psql '<connection string do ciclo-a>' -f supabase/seed/seed.sql

# reaproveita o cache que já existe — 0 chamada nova à Voyage esperada
SUPABASE_DB_URL='<connection string do ciclo-a>' VOYAGE_API_KEY='<...>' PROMPT_VERSION='<...>' \
  deno run --allow-net --allow-env scripts/backfill-seed-embeddings.ts

supabase secrets set --project-ref <ref-ciclo-a> REPLAY_MODE=replay_strict
```

**Em `ciclo-b`** (limpa dados **e** o resquício de cache do teste isolado
do `retry_chat.hurl` no passo 5, depois importa o cache de `ciclo-a`):
```bash
psql '<connection string do ciclo-b>' \
  -c "truncate table entries, chat_sessions, chat_messages, insights, export_jobs cascade; truncate table experiment.ai_replay_cache;"

psql '<connection string do ciclo-b>' -f supabase/seed/seed.sql

# importar o MESMO cache em ciclo-b — nunca gravar de novo lá (armadilha
# do apêndice: "gravar o cache duas vezes anula o mecanismo de replay").
# Destino vazio (acabou de truncar) — não precisa de --force.
SUPABASE_DB_URL='<connection string do ciclo-b>' \
  deno run -A scripts/replay-cache-import.ts --in /tmp/cache-ciclo-a.json

SUPABASE_DB_URL='<connection string do ciclo-b>' VOYAGE_API_KEY='<...>' PROMPT_VERSION='<...>' \
  deno run --allow-net --allow-env scripts/backfill-seed-embeddings.ts

supabase secrets set --project-ref <ref-ciclo-b> REPLAY_MODE=replay_strict
```

Rodar `tests/determinism/roteiro_validacao.hurl` (mesmo comando do passo
6, trocando o `base_url`) contra **os dois**. **Como confirmo:** `Success`
nos dois, e nenhuma resposta com `X-Replay-Status: miss` — `replay_strict`
por design faz a chamada falhar alto num miss (Fase 2, `T-030`), então
qualquer coisa diferente de `Success` já é o sinal de um `REPLAY_MISS`.

**✅ Confirmado em 11/09/2026 — `ciclo-a`: `Success`, 30 requisições;
`ciclo-b`: `Success`, 29 requisições. Zero chamada real à IA nos dois.**
Pequena diferença no número de requisições entre os dois é esperada — não
é sintoma de nada errado (nenhuma etapa do roteiro depende do total de
requisições bater entre execuções, só do conteúdo/`X-Replay-Status`).

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

⚠️ **Achado real, confirmado — a 1ª tentativa falhou de verdade** (não é
sintoma de nada da Fase 7 até aqui): `GET /export-status-get/:jobId`
(polling assíncrono do roteiro) pegou `"processing"` numa execução onde a
outra ainda tinha `"pending"`, mesmo `jobId`, mesma posição no
transcript — o `pg_cron` acorda em relógio de parede real, nunca
sincronizado com o teste; as duas terminam em `"done"`, só uma tentativa
no meio do caminho capturou o job em instantes ligeiramente diferentes.
Corrigido em `tests/determinism/normalize.ts` (qualquer resposta
intermediária de `export-status-get` é excluída inteira do transcript,
não só comparada com tolerância) — commit `07ad833`.

**✅ Confirmado no GitHub Actions real, 2ª tentativa (commit `07ad833`,
branch `fase7`, `workflow_dispatch`):**
```
✅ IDÊNTICO — as duas execuções de roteiro_validacao.hurl produziram o mesmo resultado (438 linhas normalizadas).
```
Jobs `contracts` e `determinism` verdes. `T-064` passo 8 fechado.

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

## Pendência do protótipo — resolvida em 10/09/2026

`ux/Cerne - Prototipo Final.html` e `ux/Requisitos_e_Fluxo_de_Telas_TCC.md`
foram recebidos; hash SHA-256 calculado e registrado em
`ux/Requisitos_e_Fluxo_de_Telas_TCC.md` §13. O terceiro arquivo pedido
junto (`Ciencia_Orientador_Divergencias_de_Escopo.md`) foi dispensado pelo
Wagner — é um documento de gestão de risco acadêmico (divergência de
escopo para a orientadora), sem relação com nenhuma tarefa técnica deste
backend.

Ainda em aberto: verificar item "todos os estados de tela sustentados por
algum endpoint" do checklist final, agora que `Requisitos_e_Fluxo_de_
Telas_TCC.md` está disponível — não feito ainda.

## Nova pendência do protótipo — aberta no mesmo dia (10/09/2026)

Poucas horas depois do congelamento acima, foi decidido acrescentar um
botão explícito **"Novo Chat"** à Tela 3 (Menu Lateral) — motivo e análise
de risco em `Contexto Geral.md` Seção 2.1. Isso **reabre** o item
"Protótipo" do checklist final (`big-plan.md`) até que:

1. A mudança seja aplicada em `ux/Cerne - Prototipo Final.html` via
   Claude Design (prompt já preparado, ver `Contexto Geral.md` Seção 2.1
   ou o histórico de conversa que gerou esta pendência).
2. O SHA-256/tamanho/data em `ux/Requisitos_e_Fluxo_de_Telas_TCC.md` §13
   sejam recalculados (`sha256sum "ux/Cerne - Prototipo Final.html"`) e
   re-registrados — a Seção 13.1 desse arquivo documenta a pendência em
   detalhe.

**Sem impacto no backend:** `POST /chat/sessions` já suportava múltiplas
sessões por usuário sem restrição — nenhum endpoint, contrato ou migração
muda por causa disso.
