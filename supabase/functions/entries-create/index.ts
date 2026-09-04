// Entrada Deno da função `entries-create` — só fiação, ver `auth-signup/index.ts`.

import { ENDPOINTS } from "../../../contracts/zod/registry.ts";
import { buildGatewayDeps, readAiEnv } from "../_shared/deps.ts";
import { runGateway } from "../_shared/gateway.ts";
import { type CreateEntryBody, handleCreateEntry } from "./handler.ts";

const contract = ENDPOINTS.find((e) => e.id === "entries.create")!;
const env = readAiEnv();

Deno.serve((req) =>
  runGateway<CreateEntryBody>(
    req,
    contract,
    {},
    (ctx) => handleCreateEntry(ctx, env),
    buildGatewayDeps(req, env),
  )
);
