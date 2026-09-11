#!/usr/bin/env bash
# T-064/T-065 (Fase 7, Plano técnico §12 passo 10, GATE-11) — monta o
# conteúdo COMPLETO do pacote de handoff num diretório de destino (o clone
# local do repositório de handoff separado, criado no GATE-11).
#
# Por que isso não é só "copiar docs/handoff/" direto: docs/handoff/ neste
# repositório guarda só os documentos GERADOS (scripts/gen-handoff-docs.ts)
# — taxonomia de erro, mapa de estados, selo de sincronização, política
# D16, README. O resto do pacote (Seção "Pacote entregue aos dois ciclos"
# do big-plan.md, mais `ux/` — protótipo congelado e documento de
# requisitos, acrescentados em 10/09/2026 por pedido do Wagner: os dois
# times precisam saber o que construir, não só contra qual API) já vive
# versionado em outros diretórios deste repo (contracts/, docs/roteiro_
# de_validacao.md, fixtures/, tests/hurl/, docs/bugs_conhecidos.md, ux/)
# — duplicar tudo isso dentro de docs/handoff/
# permanentemente só criaria uma segunda cópia pra ficar desatualizada (e
# fixtures/media/ sozinho tem ~12MB, seria dobrar esse peso no histórico
# deste repositório à toa). Este script copia tudo isso **só na hora de
# publicar**, direto para fora do repositório.
#
# O que este script NUNCA toca: credenciais de ambiente. `credenciais/`
# nasce como diretório vazio com um README explicando o que colocar lá —
# preenchimento é manual, sempre, por quem publica.
#
# Regra inviolável: "o código-fonte do backend não vai no pacote" — este
# script só copia os caminhos explicitamente listados abaixo, nunca
# `supabase/functions/`, nunca `contracts/zod/`, nunca `scripts/`.
#
# Uso:
#   1. Rodar `deno run -A scripts/gen-handoff-docs.ts` antes (garante que
#      docs/handoff/ está atualizado com o estado final do congelamento).
#   2. bash scripts/build-handoff-package.sh --out <caminho-do-clone-vazio>
#   3. Dentro de <caminho-do-clone-vazio>: revisar, `git add -A`, commit,
#      push — este script não toca em git nenhum, só monta arquivos.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."  # raiz do repo cerne-backend (script vive em scripts/)

OUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    *) echo "Argumento desconhecido: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$OUT" ]]; then
  echo "Uso: bash scripts/build-handoff-package.sh --out <diretório-de-destino>" >&2
  exit 1
fi

if [[ ! -d "$OUT" ]]; then
  echo "Diretório de destino não existe: $OUT" >&2
  exit 1
fi

if [[ -n "$(ls -A "$OUT" 2>/dev/null)" ]]; then
  echo "Diretório de destino não está vazio: $OUT" >&2
  echo "(evita misturar conteúdo antigo de outra montagem com o pacote atual — apagar/recriar o clone antes.)" >&2
  exit 1
fi

echo "Montando pacote de handoff em: $OUT"

# 1. Documentos gerados (taxonomia, mapa de estados, selo, D16, README).
cp docs/handoff/*.md "$OUT/"

# 2. Documentação da API — os 23 endpoints.
mkdir -p "$OUT/api"
cp contracts/openapi.yaml "$OUT/api/openapi.yaml"

# 3. Protótipo congelado + documento de requisitos — os dois times
#    precisam saber o que construir, não só contra qual API. Adicionado em
#    10/09/2026, por pedido explícito do Wagner (não estava na lista
#    original da Seção "Pacote entregue aos dois ciclos" do big-plan.md).
mkdir -p "$OUT/ux"
cp "ux/Cerne - Prototipo Final.html" "ux/Requisitos_e_Fluxo_de_Telas_TCC.md" "$OUT/ux/"

# 4. Roteiro de validação.
cp docs/roteiro_de_validacao.md "$OUT/roteiro_de_validacao.md"

# 5. Fixtures (textos, pares semânticos, mídia).
mkdir -p "$OUT/fixtures/media"
cp fixtures/textos.json fixtures/pares_semanticos.md fixtures/trancricoes.md "$OUT/fixtures/"
cp fixtures/media/*.wav fixtures/media/*.png "$OUT/fixtures/media/"

# 6. Coleção de testes de contrato (Hurl) — sem o `falhas_15.hurl` de
#    injeção de falha do próprio processo de congelamento, que fica
#    incluído normalmente também (é parte da suíte de contrato).
mkdir -p "$OUT/testes_contrato"
cp tests/hurl/*.hurl tests/hurl/README.md "$OUT/testes_contrato/"

# 7. Arquivo de defeitos conhecidos (D16) — igual para os dois ciclos.
cp docs/bugs_conhecidos.md "$OUT/bugs_conhecidos.md"

# 8. Placeholder de credenciais — preenchimento SEMPRE manual, nunca por
#    script (nenhuma chave real deve passar por este repositório).
mkdir -p "$OUT/credenciais"
cat > "$OUT/credenciais/README.md" <<'EOF'
# Credenciais de ambiente — preenchimento manual

Este diretório deve conter, ao final, dois arquivos preenchidos à mão por
quem publica o pacote (nunca gerados por script, nunca copiados deste
repositório):

- `ciclo-a.md` — project ref, URL, anon key e (se necessário) a Connection
  String do projeto Supabase `cerne-ciclo-a`.
- `ciclo-b.md` — o mesmo, para `cerne-ciclo-b`.

Cada ciclo comparativo recebe só a credencial do SEU projeto — nunca a do
outro, nunca a de `dev`.
EOF

echo ""
echo "Pacote montado. Conferir manualmente antes de publicar:"
echo "  - credenciais/ciclo-a.md e credenciais/ciclo-b.md (preencher à mão)"
echo "  - nenhum arquivo de $OUT deveria vir de supabase/functions/, contracts/zod/ ou scripts/"
find "$OUT" -type f | sort
