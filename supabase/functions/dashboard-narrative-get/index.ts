// Entrada Deno da função `dashboard-narrative-get` — só fiação, ver `auth-signup/index.ts`.

import { ENDPOINTS } from "../../../contracts/zod/registry.ts";
import { buildGatewayDeps, readAiEnv } from "../_shared/deps.ts";
import { runGateway } from "../_shared/gateway.ts";
import { type DashboardNarrativeQuery, handleGetDashboardNarrative } from "./handler.ts";

const contract = ENDPOINTS.find((e) => e.id === "dashboard.narrative.get")!;
const env = readAiEnv();

Deno.serve((req) =>
  runGateway<undefined, DashboardNarrativeQuery>(
    req,
    contract,
    {},
    (ctx) => handleGetDashboardNarrative(ctx, env),
    buildGatewayDeps(req, env),
  )
);
