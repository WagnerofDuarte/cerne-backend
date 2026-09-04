// Módulo `deps` — gap-fill da Fase 3, mesmo espírito de `db.ts` (Fase 2).
//
// A Seção 7 não abre um `T-0NN` para "montar as `GatewayDeps` a partir do
// ambiente" — mas cada um dos 23 diretórios de função (`index.ts`) precisa
// fazer exatamente essa fiação (ler `Deno.env`, escolher o cliente certo
// para logar `X-Test-Fault`, amarrar `verifyAccessToken`). Sem um módulo
// central, isso duplicaria de forma divergente em cada `index.ts` — o
// mesmo raciocínio que já justificou `db.ts` nascer fora do backlog.

import { createAnonClient, createUserClient, type DbEnv, logFaultInjection } from "./db.ts";
import type { GatewayDeps } from "./gateway.ts";
import { verifyAccessTokenViaGoTrue } from "./gateway.ts";

export interface AppEnv extends DbEnv {
  readonly testFaultKey: string | undefined;
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`variável de ambiente obrigatória ausente: ${name}`);
  return value;
}

/** Lê as variáveis de ambiente comuns a qualquer endpoint. Chamar uma vez por função, no topo do `index.ts` (fora do handler de requisição — não muda entre requisições). */
export function readAppEnv(): AppEnv {
  return {
    supabaseUrl: requireEnv("SUPABASE_URL"),
    supabaseAnonKey: requireEnv("SUPABASE_ANON_KEY"),
    testFaultKey: Deno.env.get("TEST_FAULT_KEY") || undefined,
  };
}

/**
 * Cliente usado só para gravar `fault_injection_log` (via a RPC de
 * `db.ts`). Escolhido pelo `Authorization` cru da requisição, não por
 * `ctx.auth` — o passo 4a do gateway (onde a falha é interpretada e
 * logada) roda *antes* do passo 5 (autenticar), então nenhum
 * `AuthContext` existe ainda nesse ponto do pipeline. A RPC só tem GRANT
 * para o papel `authenticated` (migração 0010), e é o JWT carregado pelo
 * cliente — não o que `gateway.ts` já verificou — que decide esse papel
 * no PostgREST. Sem token, cai no cliente anônimo: os únicos 3 endpoints
 * sem sessão prévia (signup/login/refresh) não estão entre os 5 endpoints
 * congelados de injeção de falha (§10.3), então isso não bloqueia nenhum
 * dos 15 cenários — só evita que a chamada quebre por falta de cliente.
 */
function dbClientForFaultLog(env: DbEnv, req: Request) {
  const bearer = req.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  return bearer ? createUserClient(env, bearer) : createAnonClient(env);
}

/** Monta as `GatewayDeps` (T-031) para uma requisição específica. */
export function buildGatewayDeps(req: Request, env: AppEnv): GatewayDeps {
  return {
    testFaultKey: env.testFaultKey,
    db: env,
    logFaultInjection: (args) => logFaultInjection(dbClientForFaultLog(env, req), args),
    verifyAccessToken: (token) => verifyAccessTokenViaGoTrue(env, token),
  };
}
