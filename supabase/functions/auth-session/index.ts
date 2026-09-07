// Entrada Deno da função `auth-session` — só fiação, ver `auth-signup/index.ts`.

import { ENDPOINTS } from "../../../contracts/zod/registry.ts";
import { buildGatewayDeps, readAppEnv } from "../_shared/deps.ts";
import { runGateway } from "../_shared/gateway.ts";
import { handleGetSession } from "./handler.ts";

const contract = ENDPOINTS.find((e) => e.id === "auth.session")!;
const env = readAppEnv();

Deno.serve((req) => runGateway(req, contract, {}, handleGetSession, buildGatewayDeps(req, env)));
