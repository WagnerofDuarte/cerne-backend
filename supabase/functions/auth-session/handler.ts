// T-034 — GET /auth/session (Plano técnico §8.1: "Único com lógica própria").
//
// Diferente dos outros 4 endpoints de auth, não é proxy do GoTrue — o
// gateway já autenticou (passo 5, `ctx.auth` garantido não-nulo aqui,
// `contract.auth: true`). Falta só o que o GoTrue sabe sobre o token
// (`user`, `expiresAt`) e o que só o nosso banco sabe (`serverRevision`,
// de `profiles`, insumo do selo de sincronização RF07).
//
// `user`/`expiresAt` vêm de decodificar os claims do próprio JWT em vez
// de uma segunda chamada de rede ao GoTrue — o gateway já validou este
// token contra o GoTrue nesta mesma requisição (ver `decodeJwtClaims` em
// `_shared/gotrue.ts`).

import type { GatewayContext, HandlerResult } from "../_shared/gateway.ts";
import { throwError } from "../_shared/errors.ts";
import { decodeJwtClaims } from "../_shared/gotrue.ts";
import { buildDataEnvelope } from "../_shared/serialize.ts";

export async function handleGetSession(ctx: GatewayContext): Promise<HandlerResult> {
  const auth = ctx.auth!; // contract.auth === true — gateway garante isto antes do handler rodar.
  const claims = decodeJwtClaims(auth.accessToken);

  const { data: profile, error } = await auth.db
    .from("profiles")
    .select("server_revision")
    .eq("id", auth.userId)
    .single();
  // Não deveria acontecer para um usuário autenticado de verdade — o
  // trigger `on_auth_user_created` (T-012) garante uma linha em
  // `profiles` para todo `auth.users`. Caminho defensivo, não um estado
  // esperado do produto.
  if (error || !profile) {
    throwError("NOT_FOUND", "perfil do usuário autenticado não encontrado");
  }

  return {
    status: 200,
    envelope: buildDataEnvelope({
      user: { id: claims.sub, email: claims.email },
      expires_at: claims.exp,
      server_revision: profile.server_revision,
    }),
  };
}
