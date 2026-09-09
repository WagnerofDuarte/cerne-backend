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

reset_db_and_seed() {
  supabase db reset
  deno run --allow-net --allow-env scripts/backfill-seed-embeddings.ts
  psql "${DB_URL}" -c "
    insert into experiment.worker_config (functions_base_url, shared_secret)
    values ('${FUNCTIONS_URL}', '${EXPORT_WORKER_SECRET:?defina EXPORT_WORKER_SECRET (mesmo valor do .env.local)}')
    on conflict (id) do update set functions_base_url = excluded.functions_base_url,
                                    shared_secret = excluded.shared_secret;
  " >/dev/null
}

echo "=== 1/3 — passada 'record': popula o cache do zero (chama IA de verdade) ==="
reset_db_and_seed
start_functions record
hurl --test --jobs 1 "${HURL_VARS[@]}" tests/determinism/roteiro_validacao.hurl
stop_functions
deno run --allow-net --allow-env scripts/replay-cache-export.ts --out "${CACHE_FILE}"

echo "=== 2/3 — execução A: banco novo + cache importado + replay_strict ==="
reset_db_and_seed
deno run --allow-net --allow-env --allow-read scripts/replay-cache-import.ts --in "${CACHE_FILE}"
start_functions replay_strict
hurl --test --jobs 1 "${HURL_VARS[@]}" --report-json "${REPORT_A}" tests/determinism/roteiro_validacao.hurl
stop_functions

echo "=== 3/3 — execução B: banco novo (de novo) + MESMO cache importado + replay_strict ==="
reset_db_and_seed
deno run --allow-net --allow-env --allow-read scripts/replay-cache-import.ts --in "${CACHE_FILE}"
start_functions replay_strict
hurl --test --jobs 1 "${HURL_VARS[@]}" --report-json "${REPORT_B}" tests/determinism/roteiro_validacao.hurl
stop_functions

echo "=== comparação ==="
deno run --allow-read tests/determinism/compare.ts "${REPORT_A}" "${REPORT_B}"
