// Entrada Deno da função `entries-list` — só fiação, ver `auth-signup/index.ts`.

import { ENDPOINTS } from "../../../contracts/zod/registry.ts";
import { buildGatewayDeps, readAppEnv } from "../_shared/deps.ts";
import { runGateway } from "../_shared/gateway.ts";
import { handleListEntries, type ListEntriesQuery } from "./handler.ts";

const contract = ENDPOINTS.find((e) => e.id === "entries.list")!;
const env = readAppEnv();

Deno.serve((req) =>
  runGateway<undefined, ListEntriesQuery>(
    req,
    contract,
    {},
    handleListEntries,
    buildGatewayDeps(req, env),
  )
);
