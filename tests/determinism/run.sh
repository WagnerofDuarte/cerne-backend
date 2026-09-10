#!/usr/bin/env bash
# T-062 — Job `determinism` (Plano técnico §11.3/§11.4, "o gate mais
# importante do CI"): prova que rodar tests/determinism/roteiro_validacao.hurl
# duas vezes, contra bancos independentes, produz o MESMO resultado.
#
# Lacuna real do §11.3, preenchida aqui e documentada (revisar se parecer
# errado): a redação literal do plano técnico ("roda o roteiro 2x em
# replay_strict, banco recém-criado") não diz de onde vem o cache que
# `replay_strict` precisa ter pronto ANTES da 1ª chamada de IA de cada
# execução (sem isso, toda chamada vira `REPLAY_MISS` na largada, sempre —
# `db reset` recria o schema `experiment` do zero, sem nenhuma linha em
# `ai_replay_cache`). E não dá pra simplesmente rodar o roteiro 2x em modo
# `record`, cada um contra um banco novo, e esperar bater: a Anthropic não
# garante o mesmo texto de saída duas vezes para o mesmo prompt (é
# exatamente esse não-determinismo que o cache existe pra esconder) — só
# faria sentido comparar duas chamadas reais à IA se elas fossem sempre
# idênticas, o que não é uma garantia de nenhum provedor.
#
# Solução adotada (mesmo raciocínio de T-061/§12 passo 6 — "gravar uma vez,
# reaproveitar"): UMA passada em `record` (popula um cache do zero, chama a
# IA de verdade — barato, plano técnico §14.5 estima o projeto inteiro
# abaixo de US$20), exportada (`replay-cache-export.ts`) e depois
# IMPORTADA (`replay-cache-import.ts`) em duas execuções independentes, com
# banco recém-criado cada uma, ambas em `replay_strict` (nenhuma chamada de
# IA de verdade nas duas — zero REPLAY_MISS esperado, qualquer um vira
# falha do job). Isso testa exatamente a propriedade que interessa: um
# cache exportado de um ambiente, importado num banco novo de outro,
# reproduz o mesmo resultado — a mesma mecânica de `ciclo-a` -> `ciclo-b`.
#
# NÃO EXECUTADO NESTE SANDBOX — mesmo bloqueio de Docker/rede das fases
# anteriores (supabase/functions/_shared, tests/hurl/README.md). O que
# `tests/determinism/normalize.ts`/`compare.ts` fazem (a parte que decide
# passa/falha) foi validado de ponta a ponta contra relatórios reais do
# `hurl` 6.1.1 nesta sessão — ver o commit de T-062. O que este script
# orquestra (supabase CLI, functions serve, os dois `db reset`) segue o
# mesmo padrão já usado — e já confirmado por comando pelo Wagner — nas
# suítes Hurl das Fases 3-5 (tests/hurl/README.md).

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."  # raiz do repo

ENV_FILE="supabase/.env.local"
FUNCTIONS_URL="http://127.0.0.1:54321/functions/v1"
# Endereço que o pg_net (rodando DENTRO do container do Postgres) usa para
# alcançar o `functions serve` na máquina host — 127.0.0.1 aponta para o
# próprio container, não para o host (achado real da Fase 5, T-059v).
WORKER_CALLBACK_URL="http://host.docker.internal:54321/functions/v1"
DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
CACHE_FILE="$(mktemp -d)/determinism-cache.json"
REPORT_A="$(mktemp -d)/report-a"
REPORT_B="$(mktemp -d)/report-b"

HURL_VARS=(
  --variable "base_url=${FUNCTIONS_URL}"
  --variable "test_account_password=Cerne-Teste-2026!"
  --variable "test_fault_key=${TEST_FAULT_KEY:?defina TEST_FAULT_KEY (mesmo valor do .env.local)}"
  --variables-file "${OCR_VARS_FILE:?defina OCR_VARS_FILE (ver tests/hurl/README.md, gera ocr_image_base64)}"
)

functions_pid=""

stop_functions() {
  if [[ -n "${functions_pid}" ]]; then
    kill "${functions_pid}" 2>/dev/null || true
    wait "${functions_pid}" 2>/dev/null || true
    functions_pid=""
  fi
}
trap stop_functions EXIT

start_functions() {
  local replay_mode="$1"
  # `.env.local` real do desenvolvedor não é tocado — uma cópia temporária
  # com REPLAY_MODE trocado, mesma convenção de nunca versionar segredo.
  local tmp_env
  tmp_env="$(mktemp)"
  grep -v '^REPLAY_MODE=' "${ENV_FILE}" > "${tmp_env}" || true
  echo "REPLAY_MODE=${replay_mode}" >> "${tmp_env}"

  supabase functions serve --env-file "${tmp_env}" &
  functions_pid=$!

  # Espera a stack responder antes de seguir (achado real das Fases 3-5:
  # sem --env-file pronto, a 1ª requisição fica pendurada até o teto do
  # runtime — ver tests/hurl/README.md).
  for _ in $(seq 1 30); do
    if curl -sf -o /dev/null "${FUNCTIONS_URL}/auth-session" -H "Authorization: Bearer x" 2>/dev/null; then
      break
    fi
    sleep 1
  done
}

reset_db() {
  supabase db reset
  # Achado real (Wagner, macOS): nem toda máquina tem `psql` instalado —
  # scripts/configure-worker.ts faz o mesmo INSERT/UPDATE só com `deno`.
  SUPABASE_DB_URL="${DB_URL}" \
  FUNCTIONS_BASE_URL="${WORKER_CALLBACK_URL}" \
  EXPORT_WORKER_SECRET="${EXPORT_WORKER_SECRET:?defina EXPORT_WORKER_SECRET (mesmo valor do .env.local)}" \
    deno run --allow-net --allow-env scripts/configure-worker.ts
}

backfill_embeddings() {
  SUPABASE_DB_URL="${DB_URL}" \
  PROMPT_VERSION="${PROMPT_VERSION:?defina PROMPT_VERSION (mesmo valor do .env.local)}" \
    deno run --allow-net --allow-env scripts/backfill-seed-embeddings.ts
}

echo "=== 1/3 — passada 'record': popula o cache do zero (chama IA de verdade) ==="
reset_db
# Cache ainda vazio aqui — a 1ª chamada de cada texto das 33 entradas do
# seed É real (miss->grava), exatamente como qualquer outra operação de IA
# desta passada.
backfill_embeddings
start_functions record
hurl --test --jobs 1 "${HURL_VARS[@]}" tests/determinism/roteiro_validacao.hurl
stop_functions
# Achado real (GitHub Actions, T-063v): faltava `--allow-write` aqui — o
# script grava `${CACHE_FILE}` em disco (`replay-cache-export.ts`, linha
# do `Deno.writeTextFile`). No Mac do Wagner isso nunca falhou porque o
# terminal é interativo: sem a flag, o Deno pergunta "Allow write access?"
# na hora e um "y" digitado sem querer/sem reparar resolve — mas um runner
# de CI não tem terminal pra perguntar nada, então nega direto
# (`NotCapable`). Escopado ao diretório do próprio arquivo (não
# `--allow-write` livre) — é a única escrita em disco que este passo faz.
deno run --allow-net --allow-env --allow-write="$(dirname "${CACHE_FILE}")" \
  scripts/replay-cache-export.ts --out "${CACHE_FILE}"

echo "=== 2/3 — execução A: banco novo + cache importado + replay_strict ==="
reset_db
# Achado real (Wagner, T-062): a IMPORTAÇÃO do cache precisa vir ANTES do
# backfill, não depois — scripts/backfill-seed-embeddings.ts também está
# atrás do cache de replay (mesmo motivo de qualquer outra chamada de IA:
# a Voyage não garante o mesmo vetor bit a bit em duas chamadas reais).
# Importar primeiro garante que o backfill bate cache em vez de chamar a
# Voyage de novo — sem isso, `entries-search` (RF06) devolveria a mesma
# entrada, na mesma ordem, mas com um `similarity` sutilmente diferente
# entre execuções, derrubando a comparação por um campo que a Voyage nunca
# prometeu manter estável.
deno run --allow-net --allow-env --allow-read scripts/replay-cache-import.ts --in "${CACHE_FILE}"
backfill_embeddings
start_functions replay_strict
hurl --test --jobs 1 "${HURL_VARS[@]}" --report-json "${REPORT_A}" tests/determinism/roteiro_validacao.hurl
stop_functions

echo "=== 3/3 — execução B: banco novo (de novo) + MESMO cache importado + replay_strict ==="
reset_db
deno run --allow-net --allow-env --allow-read scripts/replay-cache-import.ts --in "${CACHE_FILE}"
backfill_embeddings
start_functions replay_strict
hurl --test --jobs 1 "${HURL_VARS[@]}" --report-json "${REPORT_B}" tests/determinism/roteiro_validacao.hurl
stop_functions

echo "=== comparação ==="
deno run --allow-read tests/determinism/compare.ts "${REPORT_A}" "${REPORT_B}"
