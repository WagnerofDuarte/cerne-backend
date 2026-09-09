// Entrada Deno da função `account-settings-update` — só fiação, ver `auth-signup/index.ts`.

import { ENDPOINTS } from "../../../contracts/zod/registry.ts";
import { buildGatewayDeps, readAppEnv } from "../_shared/deps.ts";
import { runGateway } from "../_shared/gateway.ts";
import { handleUpdateAccountSettings } from "./handler.ts";

const contract = ENDPOINTS.find((e) => e.id === "account.settings.update")!;
const env = readAppEnv();

Deno.serve((req) =>
  runGateway(req, contract, {}, handleUpdateAccountSettings, buildGatewayDeps(req, env))
);
