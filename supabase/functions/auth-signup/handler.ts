// T-034 — POST /auth/signup (Plano técnico §8.1, D1: "proxy fino do GoTrue").

import type { GatewayContext, HandlerResult } from "../_shared/gateway.ts";
import { throwError } from "../_shared/errors.ts";
import { GoTrueApiError, type GoTrueEnv, signUp } from "../_shared/gotrue.ts";
import { buildDataEnvelope } from "../_shared/serialize.ts";

export interface SignupBody {
  readonly email: string;
  readonly password: string;
}

export async function handleSignup(
  ctx: GatewayContext<SignupBody>,
  env: GoTrueEnv,
): Promise<HandlerResult> {
  let raw;
  try {
    raw = await signUp(env, { email: ctx.body.email, password: ctx.body.password });
  } catch (err) {
    // Nenhum dos 13 códigos é específico para "credencial de auth
    // rejeitada pelo provedor" (e-mail já cadastrado, senha fraca, etc.)
    // — AUTH_INVALID é o mais próximo semanticamente (lacuna preenchida
    // aqui, revisar se o Wagner discordar). VALIDATION_ERROR fica
    // reservado ao Zod (formato do corpo), já tratado pelo gateway antes
    // do handler rodar.
    if (err instanceof GoTrueApiError) {
      throwError("AUTH_INVALID", `signup rejeitado pelo GoTrue: ${describeGoTrueError(err)}`);
    }
    throw err;
  }

  // `enable_confirmations = false` neste projeto (supabase/config.toml) —
  // signup sempre devolve sessão completa, nunca só o usuário pendente de
  // confirmação. Checagem defensiva mesmo assim, para não devolver um
  // envelope com `session` vazio se essa configuração mudar um dia.
  if (typeof raw.access_token !== "string") {
    throwError(
      "AUTH_INVALID",
      "signup não retornou sessão — confirmação de e-mail pode estar habilitada no GoTrue",
    );
  }

  const { user, ...session } = raw;
  return { status: 200, envelope: buildDataEnvelope({ session, user }) };
}

function describeGoTrueError(err: GoTrueApiError): string {
  const body = err.body as Record<string, unknown> | null;
  const detail = body?.msg ?? body?.error_description ?? body?.error ?? body?.error_code;
  return typeof detail === "string" ? detail : `HTTP ${err.status}`;
}
