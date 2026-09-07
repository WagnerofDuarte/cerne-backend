// Entrada Deno da função `chat-messages-send` — só fiação, ver `auth-signup/index.ts`.
// `:id` (id da sessão) é o último segmento da URL — o gateway não roteia.

import { ENDPOINTS } from "../../../contracts/zod/registry.ts";
import { buildGatewayDeps, readAiEnv } from "../_shared/deps.ts";
import { runGateway } from "../_shared/gateway.ts";
import { handleSendChatMessage, type SendChatMessageBody } from "./handler.ts";

const contract = ENDPOINTS.find((e) => e.id === "chat.messages.send")!;
const env = readAiEnv();

Deno.serve((req) => {
  const id = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
  return runGateway<SendChatMessageBody>(
    req,
    contract,
    { id },
    (ctx) => handleSendChatMessage(ctx, env),
    buildGatewayDeps(req, env),
  );
});
