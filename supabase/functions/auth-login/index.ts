// Entrada Deno da função `auth-login` — só fiação, ver `auth-signup/index.ts`.

import { ENDPOINTS } from "../../../contracts/zod/registry.ts";
import { buildGatewayDeps, readAppEnv } from "../_shared/deps.ts";
import { runGateway } from "../_shared/gateway.ts";
import { handleLogin, type LoginBody } from "./handler.ts";

const contract = ENDPOINTS.find((e) => e.id === "auth.login")!;
const env = readAppEnv();

Deno.serve((req) =>
  runGateway<LoginBody>(
    req,
    contract,
    {},
    (ctx) => handleLogin(ctx, env),
    buildGatewayDeps(req, env),
  )
);
