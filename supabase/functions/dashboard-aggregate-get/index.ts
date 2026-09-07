// Entrada Deno da função `dashboard-aggregate-get` — só fiação, ver `auth-signup/index.ts`.

import { ENDPOINTS } from "../../../contracts/zod/registry.ts";
import { buildGatewayDeps, readAppEnv } from "../_shared/deps.ts";
import { runGateway } from "../_shared/gateway.ts";
import { type DashboardAggregateQuery, handleGetDashboardAggregate } from "./handler.ts";

const contract = ENDPOINTS.find((e) => e.id === "dashboard.aggregate.get")!;
const env = readAppEnv();

Deno.serve((req) =>
  runGateway<undefined, DashboardAggregateQuery>(
    req,
    contract,
    {},
    handleGetDashboardAggregate,
    buildGatewayDeps(req, env),
  )
);
