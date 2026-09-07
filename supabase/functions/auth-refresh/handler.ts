// T-034 — POST /auth/refresh (Plano técnico §8.1, D1: "proxy fino do GoTrue").

import type { GatewayContext, HandlerResult } from "../_shared/gateway.ts";
import { throwError } from "../_shared/errors.ts";
import { GoTrueApiError, type GoTrueEnv, refreshAccessToken } from "../_shared/gotrue.ts";
import { buildDataEnvelope } from "../_shared/serialize.ts";

export interface RefreshBody {
  readonly refreshToken: string;
}

export async function handleRefresh(
  ctx: GatewayContext<RefreshBody>,
  env: GoTrueEnv,
): Promise<HandlerResult> {
  let raw;
  try {
    raw = await refreshAccessToken(env, ctx.body.refreshToken);
  } catch (err) {
    // Diferente de signup/login: aqui o motivo típico é um refresh token
    // que não vale mais (expirado, revogado, já trocado por um novo) — o
    // usuário precisa refazer login, então AUTH_EXPIRED descreve melhor
    // do que AUTH_INVALID (lacuna preenchida aqui, revisar se o Wagner
    // discordar da distinção entre os dois casos).
    if (err instanceof GoTrueApiError) {
      throwError("AUTH_EXPIRED", "refresh token inválido ou expirado");
    }
    throw err;
  }

  // `refreshResponseSchema` só devolve `session` (§8.1) — sem `user`,
  // diferente de signup/login.
  const { user: _user, ...session } = raw;
  return { status: 200, envelope: buildDataEnvelope({ session }) };
}
