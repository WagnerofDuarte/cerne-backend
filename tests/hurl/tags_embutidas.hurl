# T-038 — GET /entries traz tags[] populado, embutidas (sem N+1).
# Critério de conclusão explícito do T-038.
#
# a0000000-0000-0000-0004-000000000008 tem a tag 'trabalho' aplicada pelo
# seed (supabase/seed/seed.sql, bloco "entry_tags da conta A").
#
# Nota de sintaxe: um filtro jsonpath (`[?(...)]`) devolve um conjunto de
# resultados, não um único objeto — encadear `.tags[*].name` sobre ele e
# usar `count`/`contains` é a forma correta de examinar o array aninhado
# de UM item filtrado; `[?(...)][0].tags[0].name` não funciona como se
# poderia esperar (confirmado experimentalmente contra um mock local).

POST {{base_url}}/auth-login
{
  "email": "cenario-cheio@cerne.test",
  "password": "{{test_account_password}}"
}
HTTP 200
[Captures]
access_token: jsonpath "$.data.session.accessToken"

GET {{base_url}}/entries-list?limit=50
Authorization: Bearer {{access_token}}
HTTP 200
[Asserts]
jsonpath "$.data[?(@.id=='a0000000-0000-0000-0004-000000000008')].tags[*].name" count == 1
jsonpath "$.data[?(@.id=='a0000000-0000-0000-0004-000000000008')].tags[*].name" contains "trabalho"
jsonpath "$.data[?(@.id=='a0000000-0000-0000-0004-000000000008')].tags[*].id" count == 1
# uma entrada sem tag nenhuma vem com tags: [] (nunca null/ausente)
jsonpath "$.data[?(@.id=='a0000000-0000-0000-0004-000000000001')].tags[*].name" count == 0
