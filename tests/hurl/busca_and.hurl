# T-040 — GET /entries/search: dois filtros restringem com AND. Critério
# de conclusão explícito do T-040 (§8.2: "Filtros combinam com AND").
#
# Não hardcoda datas do seed (frágil de calcular à mão) — descobre a
# occurredAt de uma entrada 'audio' de verdade primeiro, depois prova o
# AND em cima dela: a mesma data exata bate, mas só quando a fonte também
# bate.

POST {{base_url}}/auth-login
{
  "email": "cenario-cheio@cerne.test",
  "password": "{{test_account_password}}"
}
HTTP 200
[Captures]
access_token: jsonpath "$.data.session.accessToken"

# q ausente -> modo filter_only (sem chamar a Voyage)
GET {{base_url}}/entries-search?source=audio&limit=1
Authorization: Bearer {{access_token}}
HTTP 200
[Captures]
one_audio_id: jsonpath "$.data[0].id"
one_audio_occurred_at: jsonpath "$.data[0].occurredAt"
[Asserts]
jsonpath "$.meta.mode" == "filter_only"
jsonpath "$.data[0].source" == "audio"

# source='manual' (não bate com a entrada capturada) + a MESMA data exata
# (bate) -> a entrada NÃO aparece: prova que o filtro de fonte também
# precisa bater, não só a data (é AND, não OR)
GET {{base_url}}/entries-search?source=manual&dateFrom={{one_audio_occurred_at}}&dateTo={{one_audio_occurred_at}}
Authorization: Bearer {{access_token}}
HTTP 200
[Asserts]
jsonpath "$.data[?(@.id=='{{one_audio_id}}')]" count == 0

# source='audio' (bate) + a mesma data exata (bate) -> a entrada aparece
GET {{base_url}}/entries-search?source=audio&dateFrom={{one_audio_occurred_at}}&dateTo={{one_audio_occurred_at}}
Authorization: Bearer {{access_token}}
HTTP 200
[Asserts]
jsonpath "$.data[?(@.id=='{{one_audio_id}}')]" count == 1
