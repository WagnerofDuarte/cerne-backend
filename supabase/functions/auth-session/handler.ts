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
import { decodeJwtClaims } from "../_shared/gotrue.ts";
import { fetchServerRevision } from "../_shared/profiles-repo.ts";
import { buildDataEnvelope } from "../_shared/serialize.ts";

export async function handleGetSession(ctx: GatewayContext): Promise<HandlerResult> {
  const auth = ctx.auth!; // contract.auth === true — gateway garante isto antes do handler rodar.
  const claims = decodeJwtClaims(auth.accessToken);
  const serverRevision = await fetchServerRevision(auth.db, auth.userId);

  return {
    status: 200,
    envelope: buildDataEnvelope({
      user: { id: claims.sub, email: claims.email },
      expires_at: claims.exp,
      server_revision: serverRevision,
    }),
  };
}
