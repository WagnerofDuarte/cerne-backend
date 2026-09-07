// Entrada Deno da função `chat-insight-create` — só fiação, ver `auth-signup/index.ts`.
// `:id` (id da sessão) é o último segmento da URL — o gateway não roteia.

import { ENDPOINTS } from "../../../contracts/zod/registry.ts";
import { buildGatewayDeps, readAiEnv } from "../_shared/deps.ts";
import { runGateway } from "../_shared/gateway.ts";
import { type CreateInsightBody, handleCreateInsight } from "./handler.ts";

const contract = ENDPOINTS.find((e) => e.id === "chat.insight.create")!;
const env = readAiEnv();

Deno.serve((req) => {
  const id = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
  return runGateway<CreateInsightBody>(
    req,
    contract,
    { id },
    (ctx) => handleCreateInsight(ctx, env),
    buildGatewayDeps(req, env),
  );
});
