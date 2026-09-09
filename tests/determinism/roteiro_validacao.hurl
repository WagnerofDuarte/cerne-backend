# T-060 (Fase 6, Plano técnico §14.3/§11.3) — Roteiro de validação,
# versão executável. Ver docs/roteiro_de_validacao.md para a narrativa
# "tela a tela" (o que um humano faria no app) e para o porquê de cada
# decisão de ordenação abaixo — este arquivo é a MESMA sequência, em forma
# de chamadas HTTP, usada de dois jeitos:
#
#   - `T-060`, uma vez, à mão pelo Wagner, com REPLAY_MODE=record — popula
#     o cache de replay chamando a IA de verdade.
#   - `T-062`, automatizado, com REPLAY_MODE=replay_strict, banco recém-
#     criado, DUAS VEZES — se as duas execuções não produzirem o mesmo
#     resultado (normalizando ids/timestamps), o backend não é
#     determinístico.
#
# =========================================================================
# REGRA DE OURO DESTE ARQUIVO — não reordenar sem reler isto:
# =========================================================================
# Toda operação de IA fica atrás do cache de replay por uma "impressão
# digital" (`cache_key`, replay.ts) calculada ANTES da chamada. Para 3 das
# 7 operações, essa impressão digital embute um id gerado pelo Postgres:
#   - `chat`      -> `retrievedEntryIds` (ids das entradas achadas pelo RAG)
#   - `insight`   -> `sessionId` (literal, buildInsightEnvelope)
#   - `narrative`/`dashboard` -> `entryIdsHash` (hash dos ids do período)
# `gen_random_uuid()` dá um id DIFERENTE a cada `db reset` — então, para
# duas execuções independentes (`T-062`) ou dois ambientes (`ciclo-a`/
# `ciclo-b`, `T-061`) baterem a MESMA impressão digital, essas 3 operações
# só podem enxergar dados com id FIXO: as contas/sessões/entradas do seed
# (`supabase/seed/seed.sql`, ids literais tipo `a0000000-...`), nunca nada
# criado por este próprio roteiro (`POST /entries`/`/chat/sessions` gera id
# novo a cada execução).
#
# Por isso a ordem abaixo não é arbitrária: TODOS os blocos que fazem
# chat/insight/busca/dashboard/exportação (sensíveis a id via cache) vêm
# ANTES de qualquer bloco que cria entradas novas (Bloco 7) — depois do
# Bloco 7, a conta A passa a ter entradas com id não-determinístico
# misturadas com as do seed, então nenhuma chamada de IA feita DAQUI PRA
# FRENTE poderia ter sua resposta reaproveitada de forma confiável entre
# execuções. `pii`/`embedding` são as únicas exceções seguras nessa
# posição — os dois só embutem o TEXTO literal no envelope (nunca um id),
# então continuam determinísticos mesmo depois do Bloco 7.
#
# `X-Test-Now` fixo na âncora do seed em toda entrada (supabase/seed/
# ancora.md) — assim `period=30d` do dashboard/exportação sempre olha para
# a mesma janela relativa, nas duas execuções, sem depender de quando de
# verdade o roteiro rodou.
#
# =========================================================================
# Variáveis esperadas (--variable/--variables-file, ver tests/hurl/README.md):
#   base_url, test_account_password, test_fault_key (só p/ X-Test-Now — não
#   se injeta nenhuma falha aqui, T-063 é o arquivo disso), e
#   `ocr_image_base64` (--variables-file, mesmo motivo do ARG_MAX do
#   media_ocr.hurl): `base64 < fixtures/media/ocr_fixture_01.png | tr -d '\n'`
# =========================================================================

# --- Bloco 1 — Autenticação ---------------------------------------------

POST {{base_url}}/auth-login
X-Test-Key: {{test_fault_key}}
X-Test-Now: 2026-09-23T09:41:00Z
{
  "email": "cenario-cheio@cerne.test",
  "password": "{{test_account_password}}"
}
HTTP 200
[Captures]
access_token: jsonpath "$.data.session.accessToken"

# --- Bloco 2 — RF04 Chat + RF08 Insight (sessão semeada #1, gatilho message_count) ---
# Sessão semeada a0000000-0000-0000-0002-000000000001 ("Conversa sobre o
# dia no trabalho") já tem 4 mensagens do usuário (seq 1/3/5/7) — esta é a
# 5ª, fecha o gatilho N=5 do RF08 (fixtures/textos.json, "sessao1_quinta_mensagem").

POST {{base_url}}/chat-messages-send/a0000000-0000-0000-0002-000000000001
Authorization: Bearer {{access_token}}
X-Test-Key: {{test_fault_key}}
X-Test-Now: 2026-09-23T09:41:00Z
{
  "content": "Obrigado por ouvir, isso me ajudou a organizar melhor o que eu tava sentindo sobre essa semana."
}
HTTP 200
[Captures]
sessao1_user_message_id: regex "\"userMessageId\":\"([0-9a-f-]{36})\""
[Asserts]
header "Content-Type" == "text/event-stream; charset=utf-8"
body matches "(?s)event: message_created.*event: context.*event: token.*event: done"
body not contains "event: error"

POST {{base_url}}/chat-insight-create/a0000000-0000-0000-0002-000000000001
Authorization: Bearer {{access_token}}
X-Test-Key: {{test_fault_key}}
X-Test-Now: 2026-09-23T09:41:00Z
{
  "triggerType": "message_count",
  "triggerKey": "5"
}
HTTP 200
[Captures]
insight_sessao1_id: jsonpath "$.data.id"
[Asserts]
jsonpath "$.data.status" matches "^(ready|failed)$"

# Mesmo triggerKey -> UNIQUE (session_id, trigger_type, trigger_key) devolve
# o MESMO insight, sem nova chamada à Haiku (RF08, idempotência única).
POST {{base_url}}/chat-insight-create/a0000000-0000-0000-0002-000000000001
Authorization: Bearer {{access_token}}
X-Test-Key: {{test_fault_key}}
X-Test-Now: 2026-09-23T09:41:00Z
{
  "triggerType": "message_count",
  "triggerKey": "5"
}
HTTP 200
[Asserts]
jsonpath "$.data.id" == "{{insight_sessao1_id}}"

# Retry da mensagem enviada acima — mesmo histórico/pergunta/RAG -> acerta
# o cache já gravado por ela mesma (D15). Único ponto deste roteiro em que
# um HIT é esperado dentro da MESMA execução (todo o resto testa miss->
# grava, em record, ou hit-contra-cache-importado, em replay_strict).
POST {{base_url}}/chat-messages-retry/a0000000-0000-0000-0002-000000000001/{{sessao1_user_message_id}}
Authorization: Bearer {{access_token}}
X-Test-Key: {{test_fault_key}}
X-Test-Now: 2026-09-23T09:41:00Z
{}
HTTP 200
[Asserts]
header "X-Replay-Status" == "hit"

# --- Bloco 3 — RF04 Chat + RF08 Insight (sessão semeada #2, gatilho inactivity) ---
# Sessão semeada a0000000-0000-0000-0002-000000000002 ("Conversa sobre o
# sono") — 2 mensagens novas (fixtures/textos.json, "sessao2_mensagem_1/2"),
# depois o gatilho por inatividade (triggerKey escolhido pelo roteiro,
# literal e fixo — o servidor não valida o conteúdo, só a unicidade).

POST {{base_url}}/chat-messages-send/a0000000-0000-0000-0002-000000000002
Authorization: Bearer {{access_token}}
X-Test-Key: {{test_fault_key}}
X-Test-Now: 2026-09-23T09:41:00Z
{
  "content": "Vou tentar deixar o celular fora do quarto essa semana e ver se isso muda alguma coisa no meu sono."
}
HTTP 200
[Asserts]
body not contains "event: error"

POST {{base_url}}/chat-messages-send/a0000000-0000-0000-0002-000000000002
Authorization: Bearer {{access_token}}
X-Test-Key: {{test_fault_key}}
X-Test-Now: 2026-09-23T09:41:00Z
{
  "content": "Acho que vou começar carregando o celular na sala, assim fico sem desculpa pra ficar mexendo já na cama."
}
HTTP 200
[Asserts]
body not contains "event: error"

POST {{base_url}}/chat-insight-create/a0000000-0000-0000-0002-000000000002
Authorization: Bearer {{access_token}}
X-Test-Key: {{test_fault_key}}
X-Test-Now: 2026-09-23T09:41:00Z
{
  "triggerType": "inactivity",
  "triggerKey": "roteiro-validacao-sessao-2"
}
HTTP 200
[Asserts]
jsonpath "$.data.status" matches "^(ready|failed)$"

# --- Bloco 4 — RF06 Busca semântica + filtro AND ------------------------
# Os 3 pares aprovados (GATE-09, fixtures/pares_semanticos.md) — nenhum
# texto usa a raiz da palavra buscada, a busca só acha por embedding.

GET {{base_url}}/entries-search?q=ansiedade&limit=5
Authorization: Bearer {{access_token}}
X-Test-Key: {{test_fault_key}}
X-Test-Now: 2026-09-23T09:41:00Z
HTTP 200
[Asserts]
jsonpath "$.meta.mode" == "semantic"
jsonpath "$.data[?(@.id=='a0000000-0000-0000-0004-000000000003')]" exists

GET {{base_url}}/entries-search?q=cansaço&limit=5
Authorization: Bearer {{access_token}}
X-Test-Key: {{test_fault_key}}
X-Test-Now: 2026-09-23T09:41:00Z
HTTP 200
[Asserts]
jsonpath "$.data[?(@.id=='a0000000-0000-0000-0004-000000000004')]" exists

GET {{base_url}}/entries-search?q=gratidão&limit=5
Authorization: Bearer {{access_token}}
X-Test-Key: {{test_fault_key}}
X-Test-Now: 2026-09-23T09:41:00Z
HTTP 200
[Asserts]
jsonpath "$.data[?(@.id=='a0000000-0000-0000-0004-000000000005')]" exists

# Mesma query de "ansiedade" + filtro de fonte (E lógico, §8.2) — mesmo
# texto da 1ª busca deste bloco, então é HIT no cache de embedding (não
# gera cache_key nova: a operação 'embedding' só embute {text, inputType},
# nunca o filtro de fonte).
GET {{base_url}}/entries-search?q=ansiedade&source=manual&limit=5
Authorization: Bearer {{access_token}}
X-Test-Key: {{test_fault_key}}
X-Test-Now: 2026-09-23T09:41:00Z
HTTP 200
[Asserts]
jsonpath "$.meta.mode" == "semantic"
jsonpath "$.data[?(@.id=='a0000000-0000-0000-0004-000000000003')]" exists

# --- Bloco 5 — RF09 Dashboard --------------------------------------------

GET {{base_url}}/dashboard-aggregate-get?period=30d
Authorization: Bearer {{access_token}}
X-Test-Key: {{test_fault_key}}
X-Test-Now: 2026-09-23T09:41:00Z
HTTP 200
[Asserts]
jsonpath "$.data.totals.count" == 34

GET {{base_url}}/dashboard-narrative-get?period=30d
Authorization: Bearer {{access_token}}
X-Test-Key: {{test_fault_key}}
X-Test-Now: 2026-09-23T09:41:00Z
HTTP 200
[Asserts]
jsonpath "$.data.text" exists

# --- Bloco 6 — RF05 Exportação -------------------------------------------
# PRÉ-REQUISITO (só deste bloco): experiment.worker_config configurado —
# ver tests/hurl/README.md, "Novidade da Fase 5".

POST {{base_url}}/export-summary-create
Authorization: Bearer {{access_token}}
X-Test-Key: {{test_fault_key}}
X-Test-Now: 2026-09-23T09:41:00Z
{
  "periodStart": null,
  "periodEnd": null,
  "includeNarrative": true
}
HTTP 202
[Captures]
export_job_id: jsonpath "$.data.jobId"

GET {{base_url}}/export-status-get/{{export_job_id}}
Authorization: Bearer {{access_token}}
X-Test-Key: {{test_fault_key}}
X-Test-Now: 2026-09-23T09:41:00Z
[Options]
retry: 20
retry-interval: 3000ms
HTTP 200
[Asserts]
jsonpath "$.data.status" == "done"
jsonpath "$.data.downloadAvailable" == true

GET {{base_url}}/export-download-get/{{export_job_id}}?format=raw
Authorization: Bearer {{access_token}}
X-Test-Key: {{test_fault_key}}
X-Test-Now: 2026-09-23T09:41:00Z
HTTP 302
[Asserts]
header "Location" exists

# =========================================================================
# A PARTIR DAQUI: entradas novas, com id gerado agora (não-determinístico
# entre execuções) — ver "REGRA DE OURO" no topo. Nenhum passo abaixo pode
# voltar a acionar `chat`/`insight`/`narrative`/`dashboard`.
# =========================================================================

# --- Bloco 7 — RF01/RF02 Captura multimodal + RF10 -----------------------

# RF01 — texto puro (fixtures/textos.json, "entrada_manual_nova")
POST {{base_url}}/entries-create
Authorization: Bearer {{access_token}}
X-Test-Key: {{test_fault_key}}
X-Test-Now: 2026-09-23T09:41:00Z
{
  "content": "Consegui separar um tempo hoje só pra organizar as ideias sobre a semana — nada muito importante, mas ajudou a colocar ordem na cabeça.",
  "source": "manual"
}
HTTP 200

# RF01 — origem áudio (STT roda no app, client-side — o backend só recebe o
# texto já transcrito; fixtures/trancricoes.md, aprovado). Duração
# arredondada de fixtures/media/audio_fixture_01.wav (achado real de uma
# sessão anterior: 50,4s reais, não os 42s do plano técnico).
POST {{base_url}}/entries-create
Authorization: Bearer {{access_token}}
X-Test-Key: {{test_fault_key}}
X-Test-Now: 2026-09-23T09:41:00Z
{
  "content": "Hoje foi um dia bem difícil no trabalho eu tive algumas demandas bem pesadas lá pra resolver eu fiquei bastante ansioso mas no final das contas eu consegui resolver tudo ao longo do dia eu tentei fazer alguns exercícios de meditação e de Mindfulness que me ajudaram a me concentrar um pouco mais e dissipar um pouco a ansiedade. Além disso eu fui atrás de pessoas pra conversar no intervalo ali do lanche e no horário de almoço e que também me trouxe um certo alívio a medicação que eu tô tomando parece que não fez tanto efeito hoje isso é uma demanda que eu preciso levar pro psiquiatra mas eu tô bem feliz com o fato de eu ter conseguido lidar com essa situação de forma mais tranquila possível igual foi hoje",
  "source": "audio",
  "mediaDurationSeconds": 50
}
HTTP 200

# RF02 — OCR (a imagem em si nunca entra no cache, D17 — só o SHA-256 dos
# bytes; `ocr_image_base64` vem de --variables-file, ver cabeçalho)
POST {{base_url}}/media-ocr
Authorization: Bearer {{access_token}}
X-Test-Key: {{test_fault_key}}
X-Test-Now: 2026-09-23T09:41:00Z
{
  "image": "{{ocr_image_base64}}",
  "mimeType": "image/png"
}
HTTP 200
[Captures]
ocr_text: jsonpath "$.data.text"
[Asserts]
jsonpath "$.data.confidence" matches "^(high|low)$"

# RF01 — origem foto, conteúdo = o texto que o OCR acabou de extrair
POST {{base_url}}/entries-create
Authorization: Bearer {{access_token}}
X-Test-Key: {{test_fault_key}}
X-Test-Now: 2026-09-23T09:41:00Z
{
  "content": "{{ocr_text}}",
  "source": "photo"
}
HTTP 200

# RF10 — salvar a 5ª mensagem do chat (Bloco 2) como entrada
POST {{base_url}}/entries-create
Authorization: Bearer {{access_token}}
X-Test-Key: {{test_fault_key}}
X-Test-Now: 2026-09-23T09:41:00Z
{
  "content": "Obrigado por ouvir, isso me ajudou a organizar melhor o que eu tava sentindo sobre essa semana.",
  "source": "chat",
  "chatMessageId": "{{sessao1_user_message_id}}"
}
HTTP 200
[Captures]
entry_from_chat_id: jsonpath "$.data.id"
[Asserts]
jsonpath "$.meta.idempotentReplay" not exists

# Repetir o mesmo chatMessageId -> idempotência RF10 (mesmo id, sem duplicar)
POST {{base_url}}/entries-create
Authorization: Bearer {{access_token}}
X-Test-Key: {{test_fault_key}}
X-Test-Now: 2026-09-23T09:41:00Z
{
  "content": "Obrigado por ouvir, isso me ajudou a organizar melhor o que eu tava sentindo sobre essa semana.",
  "source": "chat",
  "chatMessageId": "{{sessao1_user_message_id}}"
}
HTTP 200
[Asserts]
jsonpath "$.data.id" == "{{entry_from_chat_id}}"
jsonpath "$.meta.idempotentReplay" == true

# --- Bloco 8 — RF07 Timeline ----------------------------------------------

GET {{base_url}}/entries-list?limit=50
Authorization: Bearer {{access_token}}
X-Test-Key: {{test_fault_key}}
X-Test-Now: 2026-09-23T09:41:00Z
HTTP 200
[Asserts]
jsonpath "$.data" count >= 38

GET {{base_url}}/entries-get/{{entry_from_chat_id}}
Authorization: Bearer {{access_token}}
X-Test-Key: {{test_fault_key}}
X-Test-Now: 2026-09-23T09:41:00Z
HTTP 200
[Asserts]
jsonpath "$.data.source" == "chat"

# --- Bloco 9 — Conta -------------------------------------------------------

PATCH {{base_url}}/account-settings-update
Authorization: Bearer {{access_token}}
X-Test-Key: {{test_fault_key}}
X-Test-Now: 2026-09-23T09:41:00Z
{
  "persona": "empatico",
  "biometricEnabled": true
}
HTTP 200
[Asserts]
jsonpath "$.data.persona" == "empatico"
