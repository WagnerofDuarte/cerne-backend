// Entrada Deno da função `export-summary-create` — só fiação, ver `auth-signup/index.ts`.

import { ENDPOINTS } from "../../../contracts/zod/registry.ts";
import { buildGatewayDeps, readAppEnv } from "../_shared/deps.ts";
import { runGateway } from "../_shared/gateway.ts";
import { handleCreateExport } from "./handler.ts";

const contract = ENDPOINTS.find((e) => e.id === "export.summary.create")!;
const env = readAppEnv();

Deno.serve((req) => runGateway(req, contract, {}, handleCreateExport, buildGatewayDeps(req, env)));
