// Entrada Deno da função `chat-sessions-create` — só fiação, ver `auth-signup/index.ts`.

import { ENDPOINTS } from "../../../contracts/zod/registry.ts";
import { buildGatewayDeps, readAppEnv } from "../_shared/deps.ts";
import { runGateway } from "../_shared/gateway.ts";
import { type CreateChatSessionBody, handleCreateChatSession } from "./handler.ts";

const contract = ENDPOINTS.find((e) => e.id === "chat.sessions.create")!;
const env = readAppEnv();

Deno.serve((req) =>
  runGateway<CreateChatSessionBody>(
    req,
    contract,
    {},
    handleCreateChatSession,
    buildGatewayDeps(req, env),
  )
);
