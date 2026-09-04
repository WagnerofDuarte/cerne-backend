// Módulo `db` (Plano técnico §7) — gap-fill.
//
// A Seção 7 lista `db` na camada compartilhada ("Cliente Supabase com o
// JWT do usuário, nunca service_role") mas o backlog da Fase 2 (§13) não
// tem um T-0NN próprio para ele. Nasce aqui porque `faults` (T-029) e
// `replay` (T-030) precisam das 3 RPCs de `experiment.*` (migração 0010) e
// `gateway` (T-031) precisa autenticar — nenhum dos dois deveria
// reimplementar "criar um cliente Supabase" cada um do seu jeito.
//
// Regra invólavel nº5: nunca `service_role` aqui. Este cliente só carrega
// o JWT de quem fez a requisição — a RLS de `public.*` e o GRANT EXECUTE
// para `authenticated` das RPCs de `experiment.*` é que decidem o que ele
// consegue fazer.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface DbEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export type DbClient = SupabaseClient;

/** Cliente do Supabase autenticado com o JWT do usuário que fez a requisição. */
export function createUserClient(env: DbEnv, accessToken: string): DbClient {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Cliente sem JWT de usuário — carrega só a `anon key` (papel `anon` no
 * Postgres/PostgREST, nunca `service_role`). Gap-fill da Fase 3 (`_shared/
 * deps.ts`): os 3 endpoints de auth sem sessão prévia (signup/login/
 * refresh, `contract.auth === false`) não têm token de usuário para logar
 * `X-Test-Fault` com — e mesmo nos demais, o passo 4a do gateway (onde a
 * falha é interpretada e logada) roda antes do passo 5 (autenticar), então
 * não há `AuthContext` pronto ainda nesse ponto do pipeline.
 */
export function createAnonClient(env: DbEnv): DbClient {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// --- RPCs do schema `experiment` (migração 0010) ---------------------------
//
// As três funções moram em `public.experiment_*` porque o PostgREST só
// expõe RPC dos schemas listados em `config.toml` (`public`,
// `graphql_public`) — ver o comentário completo na própria migração.

export async function logFaultInjection(
  client: DbClient,
  args: { requestId: string; endpoint: string; faultType: string },
): Promise<void> {
  const { error } = await client.rpc("experiment_log_fault_injection", {
    p_request_id: args.requestId,
    p_endpoint: args.endpoint,
    p_fault_type: args.faultType,
  });
  if (error) throw error;
}

export interface ReplayCacheHit {
  response: unknown;
  hitCount: number;
}

/** `null` = miss. Cada chamada em hit incrementa `hit_count` (feito no próprio SQL, atômico). */
export async function replayCacheLookup(
  client: DbClient,
  cacheKey: string,
): Promise<ReplayCacheHit | null> {
  const { data, error } = await client.rpc("experiment_replay_cache_lookup", {
    p_cache_key: cacheKey,
  });
  if (error) throw error;
  const rows = data as Array<{ response: unknown; hit_count: number }> | null;
  const row = rows?.[0];
  if (!row) return null;
  return { response: row.response, hitCount: row.hit_count };
}

export interface ReplayCacheStoreArgs {
  cacheKey: string;
  operation: string;
  provider: string;
  model: string;
  promptVersion: string;
  requestEnvelope: unknown;
  response: unknown;
}

/** Idempotente: se `cacheKey` já existe, não sobrescreve (primeira gravação vence). */
export async function replayCacheStore(
  client: DbClient,
  args: ReplayCacheStoreArgs,
): Promise<void> {
  const { error } = await client.rpc("experiment_replay_cache_store", {
    p_cache_key: args.cacheKey,
    p_operation: args.operation,
    p_provider: args.provider,
    p_model: args.model,
    p_prompt_version: args.promptVersion,
    p_request_envelope: args.requestEnvelope,
    p_response: args.response,
  });
  if (error) throw error;
}
