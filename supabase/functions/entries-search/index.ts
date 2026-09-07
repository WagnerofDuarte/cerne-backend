// Entrada Deno da função `entries-search` — só fiação, ver `auth-signup/index.ts`.

import { ENDPOINTS } from "../../../contracts/zod/registry.ts";
import { buildGatewayDeps, readAiEnv } from "../_shared/deps.ts";
import { runGateway } from "../_shared/gateway.ts";
import { handleSearchEntries, type SearchEntriesQuery } from "./handler.ts";

const contract = ENDPOINTS.find((e) => e.id === "entries.search")!;
const env = readAiEnv();

Deno.serve((req) =>
  runGateway<undefined, SearchEntriesQuery>(
    req,
    contract,
    {},
    (ctx) => handleSearchEntries(ctx, env),
    buildGatewayDeps(req, env),
  )
);
