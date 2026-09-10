// T-045 — POST /chat/sessions (Plano técnico §8.3).
//
// "Corpo opcional title. Grava persona_snapshot a partir do perfil. Se
// title ausente, fica vazio e é preenchido pelo servidor na primeira
// mensagem" — o preenchimento na 1ª mensagem é responsabilidade de
// `chat-messages-send` (T-046, via `setSessionTitleIfEmpty`, que só grava
// quando o título ainda está vazio); se o cliente já mandou um `title`
// aqui, ele nunca é sobrescrito depois.
//
// "Criação implícita na 1ª mensagem" (critério de conclusão original de
// T-045) era uma decisão de UX do app cliente — não havia botão "nova
// conversa" na tela, mas o app já chamava este endpoint normalmente por
// trás; nada aqui mudava por causa disso.
//
// Revisão de 10/09/2026 (ver `Contexto Geral.md` Seção 2.1): o protótipo
// ganhou um botão "Novo Chat" no Menu Lateral. Ele não chama este endpoint
// diretamente — leva a Home para um estado vazio, e a criação continua
// acontecendo implicitamente quando o usuário envia a 1ª mensagem dessa
// conversa nova. Ou seja, o botão é um segundo caminho de UX até o mesmo
// gatilho, não uma chamada nova nem uma mudança de contrato. Nada neste
// handler muda por causa disso.

import { createChatSession } from "../_shared/chat-repo.ts";
import type { GatewayContext, HandlerResult } from "../_shared/gateway.ts";
import { fetchPersona } from "../_shared/profiles-repo.ts";
import { buildDataEnvelope } from "../_shared/serialize.ts";

export interface CreateChatSessionBody {
  readonly title?: string;
}

export async function handleCreateChatSession(
  ctx: GatewayContext<CreateChatSessionBody>,
): Promise<HandlerResult> {
  const auth = ctx.auth!; // contract.auth === true
  const persona = await fetchPersona(auth.db, auth.userId);
  const session = await createChatSession(auth.db, {
    userId: auth.userId,
    personaSnapshot: persona,
    title: ctx.body?.title,
  });
  return { status: 200, envelope: buildDataEnvelope(session) };
}
