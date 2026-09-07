// T-034 — POST /auth/logout (Plano técnico §8.1, D1: "proxy fino do GoTrue").
//
// Resposta contratual é sempre `{ ok: true }` (§8.1) — sem código de erro
// dedicado a "logout falhou". Uma chamada ao GoTrue que falhar (ex.: token
// já expirado, sessão já encerrada em outro lugar) não impede o objetivo
// do usuário: não ficar mais autenticado. Por isso o erro do GoTrue aqui é
// engolido, não propagado — lacuna preenchida assim porque devolver um dos
// 13 códigos para "sua sessão já estava encerrada" seria pior experiência
// do que apenas confirmar o que o usuário queria.

import type { GatewayContext, HandlerResult } from "../_shared/gateway.ts";
import { GoTrueApiError, type GoTrueEnv, logout } from "../_shared/gotrue.ts";
import { buildDataEnvelope } from "../_shared/serialize.ts";

export async function handleLogout(
  ctx: GatewayContext,
  env: GoTrueEnv,
): Promise<HandlerResult> {
  const auth = ctx.auth!; // contract.auth === true

  try {
    await logout(env, auth.accessToken);
  } catch (err) {
    if (!(err instanceof GoTrueApiError)) throw err;
    // engolido de propósito — ver comentário acima.
  }

  return { status: 200, envelope: buildDataEnvelope({ ok: true }) };
}
