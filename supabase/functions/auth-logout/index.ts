// Entrada Deno da função `auth-logout` — só fiação, ver `auth-signup/index.ts`.

import { ENDPOINTS } from "../../../contracts/zod/registry.ts";
import { buildGatewayDeps, readAppEnv } from "../_shared/deps.ts";
import { runGateway } from "../_shared/gateway.ts";
import { handleLogout } from "./handler.ts";

const contract = ENDPOINTS.find((e) => e.id === "auth.logout")!;
const env = readAppEnv();

Deno.serve((req) =>
  runGateway(req, contract, {}, (ctx) => handleLogout(ctx, env), buildGatewayDeps(req, env))
);
