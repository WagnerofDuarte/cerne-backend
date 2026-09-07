// T-034 — POST /auth/login (Plano técnico §8.1, D1: "proxy fino do GoTrue").

import type { GatewayContext, HandlerResult } from "../_shared/gateway.ts";
import { throwError } from "../_shared/errors.ts";
import { GoTrueApiError, type GoTrueEnv, signInWithPassword } from "../_shared/gotrue.ts";
import { buildDataEnvelope } from "../_shared/serialize.ts";

export interface LoginBody {
  readonly email: string;
  readonly password: string;
}

export async function handleLogin(
  ctx: GatewayContext<LoginBody>,
  env: GoTrueEnv,
): Promise<HandlerResult> {
  let raw;
  try {
    raw = await signInWithPassword(env, { email: ctx.body.email, password: ctx.body.password });
  } catch (err) {
    // Mesma leitura de auth-signup: credenciais erradas não têm código
    // próprio na taxonomia de 13 — AUTH_INVALID é o mais próximo.
    if (err instanceof GoTrueApiError) {
      throwError("AUTH_INVALID", "login rejeitado pelo GoTrue: credenciais inválidas");
    }
    throw err;
  }

  const { user, ...session } = raw;
  return { status: 200, envelope: buildDataEnvelope({ session, user }) };
}
