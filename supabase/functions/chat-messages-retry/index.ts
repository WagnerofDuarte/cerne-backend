// Entrada Deno da função `chat-messages-retry` — só fiação, ver `auth-signup/index.ts`.
//
// Único endpoint da Fase 4 com DOIS parâmetros de caminho (`:id` da
// sessão, `:userMessageId`) — a convenção de T-034 ("params: extraídos
// pelo diretório da função") ainda vale, só estendida para os dois
// últimos segmentos da URL, na mesma ordem em que aparecem no `path` do
// contrato (`/chat/sessions/:id/messages/:userMessageId/retry`). O
// segmento literal final `/retry` do caminho "bonito" do OpenAPI nunca
// aparece na URL de verdade (convenção da Fase 3: chama-se
// `{{base_url}}/chat-messages-retry/<id>/<userMessageId>`, não o caminho
// REST).

import { ENDPOINTS } from "../../../contracts/zod/registry.ts";
import { buildGatewayDeps, readAiEnv } from "../_shared/deps.ts";
import { runGateway } from "../_shared/gateway.ts";
import { handleRetryChatMessage } from "./handler.ts";

const contract = ENDPOINTS.find((e) => e.id === "chat.messages.retry")!;
const env = readAiEnv();

Deno.serve((req) => {
  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const [id, userMessageId] = segments.slice(-2);
  return runGateway<Record<string, never>>(
    req,
    contract,
    { id: id ?? "", userMessageId: userMessageId ?? "" },
    (ctx) => handleRetryChatMessage(ctx, env),
    buildGatewayDeps(req, env),
  );
});
