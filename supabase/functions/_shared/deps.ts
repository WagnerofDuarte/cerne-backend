// Módulo `deps` — gap-fill da Fase 3, mesmo espírito de `db.ts` (Fase 2).
//
// A Seção 7 não abre um `T-0NN` para "montar as `GatewayDeps` a partir do
// ambiente" — mas cada um dos 23 diretórios de função (`index.ts`) precisa
// fazer exatamente essa fiação (ler `Deno.env`, escolher o cliente certo
// para logar `X-Test-Fault`, amarrar `verifyAccessToken`). Sem um módulo
// central, isso duplicaria de forma divergente em cada `index.ts` — o
// mesmo raciocínio que já justificou `db.ts` nascer fora do backlog.

import {
  createAnonClient,
  createUserClient,
  type DbClient,
  type DbEnv,
  logFaultInjection,
  replayCacheLookup,
  replayCacheStore,
} from "./db.ts";
import type { GatewayDeps } from "./gateway.ts";
import { verifyAccessTokenViaGoTrue } from "./gateway.ts";
import type { ReplayDeps, ReplayMode } from "./replay.ts";

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

// --- Ambiente para endpoints que chamam IA (entries-create, media-ocr, ---
// --- e Fase 4+: chat/insight/dashboard/narrative) ------------------------

export interface AiEnv extends AppEnv {
  readonly anthropicApiKey: string;
  readonly voyageApiKey: string;
  readonly promptVersion: string;
  readonly replayMode: ReplayMode;
  /** Nunca setado por `readAiEnv` (produção usa `fetch` de verdade) — só para injeção em teste, repassado pelo handler para `ai/anthropic`/`ai/voyage`. */
  readonly fetchImpl?: typeof fetch;
}

function parseReplayMode(raw: string | undefined): ReplayMode {
  if (raw === "off" || raw === "record" || raw === "replay" || raw === "replay_strict") return raw;
  // Default seguro: nunca serve nem grava cache por engano se REPLAY_MODE
  // não estiver configurado — equivalente a "sempre chama o provedor de
  // verdade", igual ao comportamento de desenvolvimento local sem cache.
  return "off";
}

/** Como `readAppEnv`, mas também exige as credenciais/config de IA — chamar só nos endpoints que efetivamente chamam Anthropic/Voyage. */
export function readAiEnv(): AiEnv {
  return {
    ...readAppEnv(),
    anthropicApiKey: requireEnv("ANTHROPIC_API_KEY"),
    voyageApiKey: requireEnv("VOYAGE_API_KEY"),
    promptVersion: requireEnv("PROMPT_VERSION"),
    replayMode: parseReplayMode(Deno.env.get("REPLAY_MODE")),
  };
}

// --- Ambiente do OCR (T-041, único consumidor de OCR_MAX_BYTES) --------

export interface OcrEnv extends AiEnv {
  readonly ocrMaxBytes: number;
}

/** `5242880` (5MB) — valor documentado na Seção 3.6 do plano técnico — é o default se `OCR_MAX_BYTES` estiver ausente ou não for um número positivo. */
const DEFAULT_OCR_MAX_BYTES = 5_242_880;

function parseOcrMaxBytes(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_OCR_MAX_BYTES;
}

export function readOcrEnv(): OcrEnv {
  return {
    ...readAiEnv(),
    ocrMaxBytes: parseOcrMaxBytes(Deno.env.get("OCR_MAX_BYTES")),
  };
}

/**
 * Monta as `ReplayDeps` (T-030) a partir de um cliente de banco já
 * escolhido pelo chamador — os endpoints de IA sempre exigem sessão
 * (`contract.auth: true`), então usam o cliente do próprio usuário
 * (`ctx.auth.db`), nunca `service_role` (regra nº5) nem o cliente anônimo
 * (a RPC de cache só tem GRANT para `authenticated`, migração 0010).
 */
export function buildReplayDeps(db: DbClient, mode: ReplayMode): ReplayDeps {
  return {
    mode,
    lookup: async (cacheKey) => {
      const hit = await replayCacheLookup(db, cacheKey);
      return hit ? { response: hit.response, hitCount: hit.hitCount } : null;
    },
    store: (args) =>
      replayCacheStore(db, {
        cacheKey: args.cacheKey,
        operation: args.operation,
        provider: args.provider,
        model: args.model,
        promptVersion: args.promptVersion,
        requestEnvelope: args.requestEnvelope,
        response: args.response,
      }),
  };
}
