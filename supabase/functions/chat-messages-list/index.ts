// Entrada Deno da função `chat-messages-list` — só fiação, ver `auth-signup/index.ts`.
// `:id` (id da sessão) é o último segmento da URL — o gateway não roteia.

import { ENDPOINTS } from "../../../contracts/zod/registry.ts";
import { buildGatewayDeps, readAppEnv } from "../_shared/deps.ts";
import { runGateway } from "../_shared/gateway.ts";
import { handleListChatMessages } from "./handler.ts";

const contract = ENDPOINTS.find((e) => e.id === "chat.messages.list")!;
const env = readAppEnv();

Deno.serve((req) => {
  const id = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
  return runGateway(req, contract, { id }, handleListChatMessages, buildGatewayDeps(req, env));
});
