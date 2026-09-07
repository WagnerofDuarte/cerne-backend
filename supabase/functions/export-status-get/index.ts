// Entrada Deno da função `export-status-get` — só fiação, ver `auth-signup/index.ts`.
// `:jobId` é o último segmento da URL — o gateway não roteia.

import { ENDPOINTS } from "../../../contracts/zod/registry.ts";
import { buildGatewayDeps, readAppEnv } from "../_shared/deps.ts";
import { runGateway } from "../_shared/gateway.ts";
import { handleGetExportStatus } from "./handler.ts";

const contract = ENDPOINTS.find((e) => e.id === "export.status.get")!;
const env = readAppEnv();

Deno.serve((req) => {
  const jobId = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
  return runGateway(req, contract, { jobId }, handleGetExportStatus, buildGatewayDeps(req, env));
});
