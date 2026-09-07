// Entrada Deno da função `auth-refresh` — só fiação, ver `auth-signup/index.ts`.

import { ENDPOINTS } from "../../../contracts/zod/registry.ts";
import { buildGatewayDeps, readAppEnv } from "../_shared/deps.ts";
import { runGateway } from "../_shared/gateway.ts";
import { handleRefresh, type RefreshBody } from "./handler.ts";

const contract = ENDPOINTS.find((e) => e.id === "auth.refresh")!;
const env = readAppEnv();

Deno.serve((req) =>
  runGateway<RefreshBody>(
    req,
    contract,
    {},
    (ctx) => handleRefresh(ctx, env),
    buildGatewayDeps(req, env),
  )
);
