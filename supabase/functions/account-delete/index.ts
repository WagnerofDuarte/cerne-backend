// Entrada Deno da função `account-delete` — só fiação, ver `auth-signup/index.ts`.

import { ENDPOINTS } from "../../../contracts/zod/registry.ts";
import { buildGatewayDeps, readAppEnv } from "../_shared/deps.ts";
import { runGateway } from "../_shared/gateway.ts";
import { handleDeleteAccount } from "./handler.ts";

const contract = ENDPOINTS.find((e) => e.id === "account.delete")!;
const env = readAppEnv();

Deno.serve((req) => runGateway(req, contract, {}, handleDeleteAccount, buildGatewayDeps(req, env)));
