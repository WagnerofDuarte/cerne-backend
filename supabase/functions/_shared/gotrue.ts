// T-034 — Cliente GoTrue (Plano técnico §8.1, D1: "proxy fino do GoTrue").
//
// Gap-fill da Fase 3: a Seção 7 lista a camada compartilhada da Fase 2
// (gateway, errors, contracts, serialize, clock, db, ai/anthropic,
// ai/voyage, replay, faults) mas nenhum módulo ali fala com o GoTrue — os
// 5 endpoints de auth são os primeiros a precisar disso. Mesma postura dos
// clientes de `ai/`: função fina, `fetchImpl` injetável para teste, nunca
// decide qual dos 13 códigos um erro vira (isso é do handler de cada
// endpoint — só `auth-refresh` e `auth-login`/`auth-signup` divergem nessa
// escolha, ver comentário em cada `handler.ts`).

export interface GoTrueEnv {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  /** Injetável para teste — produção usa `fetch` de verdade. */
  readonly fetchImpl?: typeof fetch;
}

/** GoTrue respondeu algo que não é 2xx. Corpo típico: `{error_code, msg}` (GoTrue novo) ou `{error, error_description}` (antigo) — o handler decide o mapeamento, este módulo só carrega o corpo bruto. */
export class GoTrueApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown) {
    super(`GoTrue respondeu ${status}`);
    this.name = "GoTrueApiError";
    this.status = status;
    this.body = body;
  }
}

async function goTrueFetch(
  env: GoTrueEnv,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; accessToken?: string },
): Promise<unknown> {
  const fetchFn = env.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: env.supabaseAnonKey,
  };
  if (init.accessToken) headers.Authorization = `Bearer ${init.accessToken}`;

  const res = await fetchFn(`${env.supabaseUrl}${path}`, {
    method: init.method,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  // /auth/v1/logout responde 204 sem corpo.
  const body = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new GoTrueApiError(res.status, body);
  return body;
}

/** Resposta de sessão do GoTrue (`snake_case`) — mesma forma em signup/login/refresh. */
export interface GoTrueSessionResponse {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_in: number;
  readonly expires_at: number;
  readonly token_type: string;
  readonly user: Record<string, unknown>;
  readonly [key: string]: unknown;
}

export function signUp(
  env: GoTrueEnv,
  args: { email: string; password: string },
): Promise<GoTrueSessionResponse> {
  return goTrueFetch(env, "/auth/v1/signup", { method: "POST", body: args }) as Promise<
    GoTrueSessionResponse
  >;
}

export function signInWithPassword(
  env: GoTrueEnv,
  args: { email: string; password: string },
): Promise<GoTrueSessionResponse> {
  return goTrueFetch(env, "/auth/v1/token?grant_type=password", {
    method: "POST",
    body: args,
  }) as Promise<GoTrueSessionResponse>;
}

export function refreshAccessToken(
  env: GoTrueEnv,
  refreshToken: string,
): Promise<GoTrueSessionResponse> {
  return goTrueFetch(env, "/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    body: { refresh_token: refreshToken },
  }) as Promise<GoTrueSessionResponse>;
}

export async function logout(env: GoTrueEnv, accessToken: string): Promise<void> {
  await goTrueFetch(env, "/auth/v1/logout", { method: "POST", accessToken });
}

// --- Decodificação de claims do JWT (GET /auth/session) --------------------
//
// "Único com lógica própria" (§8.1): precisa de `user` completo e
// `expiresAt`, que o passo de autenticação do gateway (que só extrai
// `userId` via `/auth/v1/user`) não carrega adiante. Em vez de uma segunda
// chamada de rede ao GoTrue, decodifica os claims do próprio token — sem
// verificar assinatura, porque o gateway já validou este token contra o
// GoTrue nesta mesma requisição (passo 5, antes do handler rodar).

export interface JwtClaims {
  readonly sub: string;
  readonly email?: string;
  readonly exp: number;
  readonly [key: string]: unknown;
}

function base64UrlDecode(segment: string): string {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    segment.length + ((4 - (segment.length % 4)) % 4),
    "=",
  );
  return atob(padded);
}

/** Lança se o token não tiver o formato JWT esperado (3 segmentos) — nunca deveria acontecer aqui, já que o gateway validou o token antes de chamar o handler. */
export function decodeJwtClaims(accessToken: string): JwtClaims {
  const parts = accessToken.split(".");
  if (parts.length !== 3) {
    throw new Error("decodeJwtClaims: token não tem o formato JWT esperado (3 segmentos)");
  }
  const payload = JSON.parse(base64UrlDecode(parts[1]!)) as Record<string, unknown>;
  if (typeof payload.sub !== "string" || typeof payload.exp !== "number") {
    throw new Error("decodeJwtClaims: claims 'sub'/'exp' ausentes ou com tipo inesperado");
  }
  return payload as unknown as JwtClaims;
}
