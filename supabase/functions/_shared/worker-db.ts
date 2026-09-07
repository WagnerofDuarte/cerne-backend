// Módulo `worker-db` — gap-fill da Fase 5, mesmo espírito de `db.ts`.
//
// `db.ts` (Fase 2) garante, no próprio comentário, que nunca cria um
// cliente com `service_role` — é o que faz essa garantia continuar
// verdadeira para as 23 Edge Functions de aplicativo. O worker de
// exportação (`export-worker`, T-054) é a ÚNICA exceção prevista pela
// regra inviolável nº5 ("nunca service_role numa Edge Function que atenda
// requisição do aplicativo — só em workers de fila") — por isso vive num
// módulo à parte, nunca importado por nenhum dos 23 diretórios de função
// que atendem o app.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface WorkerDbEnv {
  readonly supabaseUrl: string;
  readonly supabaseServiceRoleKey: string;
}

/**
 * Cliente com `service_role` — ignora RLS por completo. Só para o worker de
 * fila (T-054), que precisa ler/gravar dados de um usuário arbitrário sem
 * ter o JWT dele (o worker roda fora do ciclo requisição/resposta do app).
 */
export function createServiceRoleClient(env: WorkerDbEnv): SupabaseClient {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
