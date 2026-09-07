// Entrada Deno da função `chat-sessions-list` — só fiação, ver `auth-signup/index.ts`.

import { ENDPOINTS } from "../../../contracts/zod/registry.ts";
import { buildGatewayDeps, readAppEnv } from "../_shared/deps.ts";
import { runGateway } from "../_shared/gateway.ts";
import { handleListChatSessions, type ListChatSessionsQuery } from "./handler.ts";

const contract = ENDPOINTS.find((e) => e.id === "chat.sessions.list")!;
const env = readAppEnv();

Deno.serve((req) =>
  runGateway<undefined, ListChatSessionsQuery>(
    req,
    contract,
    {},
    handleListChatSessions,
    buildGatewayDeps(req, env),
  )
);
