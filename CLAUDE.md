# Instruções para o Claude neste repositório

## Sempre via PR a partir do congelamento (Fase 7, 11/09/2026)

O backend foi congelado na tag `backend-v1.0-frozen` (ver `big-plan.md`,
Fase 7 / `T-064`/`T-065`). A partir daqui, **nenhuma mudança vai direto
pro `main` — sempre abrir PR de um branch, mesmo para documentação**,
independente do que a proteção do branch no GitHub permita tecnicamente.

Isso importa porque a proteção do `main` não bloqueia push direto do
dono do repositório por padrão (só de terceiros, a menos que "Do not
allow bypassing the above settings" esteja marcado) — então "dá pra
empurrar direto" não é a mesma coisa que "deve empurrar direto". A
regra aqui é de processo, decidida pelo Wagner em 11/09/2026, não uma
limitação técnica.

Fluxo esperado para qualquer mudança (código, docs, `big-plan.md`):
1. Criar/usar um branch dedicado (nunca commitar direto em `main`).
2. Abrir PR contra `main`.
3. Deixar o CI (`contracts`/`determinism`) rodar.
4. O Wagner mergeia (ou pede pra eu mergear, se disser explicitamente).
