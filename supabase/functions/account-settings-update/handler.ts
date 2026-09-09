// T-058 — PATCH /account/settings (Plano técnico §8.6).
//
// "Campo email presente -> VALIDATION_ERROR": já resolvido pelo `.strict()`
// do Zod (`contracts/zod/account.ts`) — qualquer chave fora de
// displayName/persona/biometricEnabled já falha o parse no gateway, antes
// do handler rodar. Aqui só resta montar o `UPDATE` com os campos
// realmente enviados (todos opcionais) e devolver o perfil atualizado.

import { camelToSnake } from "../_shared/serialize.ts";
import { throwError } from "../_shared/errors.ts";
import type { GatewayContext, HandlerResult } from "../_shared/gateway.ts";
import { buildDataEnvelope } from "../_shared/serialize.ts";

export interface UpdateAccountSettingsBody {
  readonly displayName?: string;
  readonly persona?: "analitico" | "empatico" | "socratico";
  readonly biometricEnabled?: boolean;
}

const PROFILE_SELECT =
  "id, email, display_name, biometric_enabled, persona, server_revision, created_at, updated_at";

export async function handleUpdateAccountSettings(
  ctx: GatewayContext<UpdateAccountSettingsBody, undefined>,
): Promise<HandlerResult> {
  const auth = ctx.auth!; // contract.auth === true
  const patch = camelToSnake<Record<string, unknown>>(ctx.body);

  if (Object.keys(patch).length > 0) {
    const { error } = await auth.db
      .from("profiles")
      .update({ ...patch, updated_at: ctx.now.toISOString() })
      .eq("id", auth.userId);
    if (error) throw error;
  }

  const { data, error } = await auth.db
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("id", auth.userId)
    .maybeSingle();
  if (error) throw error;
  // Defensivo — não deveria acontecer para um usuário autenticado de
  // verdade (mesmo raciocínio de `profiles-repo.fetchServerRevision`).
  if (!data) throwError("NOT_FOUND", "perfil do usuário autenticado não encontrado");

  return { status: 200, envelope: buildDataEnvelope(data) };
}
