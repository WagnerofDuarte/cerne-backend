-- T-054 — Acesso do worker de exportação ao cache de replay.
--
-- A narrativa da exportação (RF05) passa pelo mesmo cache de replay que
-- chat/insight/OCR/PII (Seção 9.2, operação `narrative`) — sem isso, o
-- roteiro de validação (T-060) gravaria a narrativa da exportação uma vez
-- por ciclo comparativo, quebrando o determinismo entre `ciclo-a`/`ciclo-b`
-- (mesma regra inviolável nº... "gravar o cache duas vezes anula o
-- mecanismo de replay").
--
-- As RPCs de cache já existem desde a migração 0010
-- (`experiment_replay_cache_lookup`/`_store`), mas só têm GRANT para
-- `authenticated` — o worker da fila (`export-worker`, T-054) roda com
-- `service_role` (legítimo aqui: regra nº5 permite `service_role` em
-- workers de fila), um papel diferente. Em vez de editar a migração 0010
-- já aplicada (proibido — "editar migração já aplicada em remoto" é uma
-- das armadilhas do apêndice), esta migração nova só ACRESCENTA o GRANT
-- que faltava para `service_role`, sem tocar em nada already-existente.
grant execute on function public.experiment_replay_cache_lookup(text) to service_role;
grant execute on function public.experiment_replay_cache_store(
  text, text, text, text, text, jsonb, jsonb
) to service_role;
