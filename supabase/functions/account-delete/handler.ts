// T-059 — DELETE /account (Plano técnico §8.6): "Apagamento hard, em
// cascata, mais purga dos objetos do bucket exports do usuário. Nenhuma
// linha órfã em nenhuma tabela."
//
// Duas peças, nessa ordem:
//   1. Purga o bucket `exports` do usuário — com o cliente do PRÓPRIO
//      usuário (a política de Storage do T-052 já concede select/delete ao
//      dono do caminho, nunca `service_role` aqui, regra nº5).
//   2. Chama `delete_own_account()` (RPC SECURITY DEFINER, migração 0017 —
//      decisão tomada com o Wagner antes de implementar, ver `big-plan.md`
//      Fase 5) — apaga a própria linha em `auth.users`, cascata já provada
//      desde a Fase 1 (`cascade_delete.sql`) cuida do resto.
//
// Trade-off registrado, não escondido: se a purga (passo 1) falhar por
// algum motivo (Storage indisponível), a exclusão da conta (passo 2) segue
// adiante mesmo assim — perder dado do usuário para sempre por causa de um
// arquivo de exportação órfão seria pior do que o inverso. Isso pode, no
// caso raro de falha do passo 1, deixar arquivos sem dono no bucket
// (inacessíveis a qualquer outro usuário pela própria política — não é uma
// exposição, só um resíduo). Nenhum documento-fonte resolve essa ordem de
// prioridade explicitamente.

import type { GatewayContext, HandlerResult } from "../_shared/gateway.ts";
import { buildDataEnvelope } from "../_shared/serialize.ts";

async function purgeExportsBucket(auth: NonNullable<GatewayContext["auth"]>): Promise<void> {
  const storage = auth.db.storage.from("exports");

  const { data: jobFolders } = await storage.list(auth.userId, { limit: 1000 });
  if (!jobFolders || jobFolders.length === 0) return;

  const allPaths: string[] = [];
  for (const folder of jobFolders) {
    const { data: files } = await storage.list(`${auth.userId}/${folder.name}`, { limit: 1000 });
    for (const file of files ?? []) {
      allPaths.push(`${auth.userId}/${folder.name}/${file.name}`);
    }
  }
  if (allPaths.length > 0) await storage.remove(allPaths);
}

export async function handleDeleteAccount(
  ctx: GatewayContext<{ confirmation: "DELETE" }, undefined>,
): Promise<HandlerResult> {
  const auth = ctx.auth!; // contract.auth === true

  await purgeExportsBucket(auth).catch(() => {
    // Ver nota de cabeçalho — não bloqueia a exclusão da conta.
  });

  const { error } = await auth.db.rpc("delete_own_account");
  if (error) throw error;

  return { status: 200, envelope: buildDataEnvelope({ ok: true }) };
}
