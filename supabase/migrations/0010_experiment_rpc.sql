-- T-029/T-030 — Funções RPC para acessar o schema `experiment` sem
-- service_role numa Edge Function de requisição (Plano técnico §7, regra
-- invólavel nº5 do big-plan.md).
--
-- Lacuna do documento-fonte, preenchida aqui e documentada (revisar se
-- parecer errado): a migração 0008 tranca `experiment` para `anon` e
-- `authenticated` de propósito — é infraestrutura de experimento, não dado
-- de usuário. Mas o log de injeção de falha (T-029) e o cache de replay
-- (T-030) precisam ser escritos/lidos *durante* o atendimento de uma
-- requisição real, pela própria função que atende o app — não por um
-- worker de fila. Dar `service_role` a essa função violaria a regra nº5
-- ("nunca usar service_role numa Edge Function que atenda requisição do
-- aplicativo — só em workers de fila").
--
-- A saída: funções `SECURITY DEFINER` de superfície mínima (uma
-- inserção, uma leitura+incremento, uma inserção idempotente — nada de
-- SELECT/INSERT genérico), que o cliente das Edge Functions chama via RPC
-- (`supabase.rpc(...)`, cai no PostgREST). Isso é o que decide o *schema*:
-- PostgREST só expõe funções dos schemas em `config.toml` (`[api].schemas
-- = ["public", "graphql_public"]`) — `experiment` não está nessa lista, de
-- propósito, para não virar uma tabela de dado de usuário navegável. Por
-- isso as funções em si moram em `public` (prefixo `experiment_` para não
-- confundir com endpoint de aplicativo), mas cada uma só toca a tabela de
-- `experiment.*` que lhe cabe, por nome totalmente qualificado.
--
-- Trade-off aceito, registrado em vez de escondido: como essas funções
-- ficam em `public` com GRANT EXECUTE para `authenticated`, qualquer
-- usuário autenticado *poderia* chamá-las direto (fora do gateway, sem
-- passar por X-Test-Key) e escrever linha de log/cache "de brincadeira".
-- Isso suja infraestrutura de experimento, nunca dado de outro usuário
-- (as tabelas não têm RLS por usuário, não fazem sentido ter) — não é uma
-- via de escalonamento de privilégio. Revisar com o Wagner se quiser
-- fechar esse fio solto (ex.: um `service_role` dedicado só para essas 3
-- RPCs, chamado de dentro do worker — mudaria a arquitetura de fila da
-- Fase 5, fora do escopo da Fase 2).

-- Log de injeção de falha (T-029): uma linha por cabeçalho X-Test-Fault
-- interpretado com sucesso.
create or replace function public.experiment_log_fault_injection(
  p_request_id text,
  p_endpoint text,
  p_fault_type text
) returns void
language plpgsql
security definer
set search_path = experiment, pg_temp
as $$
begin
  insert into experiment.fault_injection_log (request_id, endpoint, fault_type)
  values (p_request_id, p_endpoint, p_fault_type);
end;
$$;

-- Toda função nova é EXECUTE-por-PUBLIC por padrão no Postgres — revogar
-- só de `anon` não bastaria (anon herda de PUBLIC do mesmo jeito que
-- qualquer outro papel; confirmado por teste manual antes deste commit).
-- Fechar PUBLIC primeiro, depois abrir só para authenticated.
revoke execute on function public.experiment_log_fault_injection(text, text, text) from public;
grant execute on function public.experiment_log_fault_injection(text, text, text) to authenticated;

-- Cache de replay (T-030): consulta e incrementa hit_count atomicamente —
-- um único UPDATE ... RETURNING evita a corrida de "ler hit_count, decidir
-- incrementar, escrever" em duas viagens ao banco. Zero linhas devolvidas
-- = miss.
create or replace function public.experiment_replay_cache_lookup(p_cache_key text)
returns table (response jsonb, hit_count integer)
language sql
security definer
set search_path = experiment, pg_temp
as $$
  update experiment.ai_replay_cache
  set hit_count = hit_count + 1
  where cache_key = p_cache_key
  returning ai_replay_cache.response, ai_replay_cache.hit_count;
$$;

revoke execute on function public.experiment_replay_cache_lookup(text) from public;
grant execute on function public.experiment_replay_cache_lookup(text) to authenticated;

-- Grava uma entrada nova no cache de replay. `on conflict ... do nothing`:
-- a primeira gravação vence — duas requisições idênticas em corrida (mesma
-- cache_key, porque o input foi idêntico) não podem fazer uma sobrescrever
-- a resposta já cacheada da outra, isso quebraria o determinismo que o
-- cache existe para garantir.
create or replace function public.experiment_replay_cache_store(
  p_cache_key text,
  p_operation text,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_request_envelope jsonb,
  p_response jsonb
) returns void
language plpgsql
security definer
set search_path = experiment, pg_temp
as $$
begin
  insert into experiment.ai_replay_cache
    (cache_key, operation, provider, model, prompt_version, request_envelope, response)
  values
    (p_cache_key, p_operation, p_provider, p_model, p_prompt_version, p_request_envelope, p_response)
  on conflict (cache_key) do nothing;
end;
$$;

revoke execute on function public.experiment_replay_cache_store(
  text, text, text, text, text, jsonb, jsonb
) from public;
grant execute on function public.experiment_replay_cache_store(
  text, text, text, text, text, jsonb, jsonb
) to authenticated;
