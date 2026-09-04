// Entrada Deno da função `entries-get` — só fiação, ver `auth-signup/index.ts`.
// `:id` é o último segmento da URL — o gateway não roteia (Seção 7:
// "params: extraídos pelo diretório da função").

import { ENDPOINTS } from "../../../contracts/zod/registry.ts";
import { buildGatewayDeps, readAppEnv } from "../_shared/deps.ts";
import { runGateway } from "../_shared/gateway.ts";
import { handleGetEntry } from "./handler.ts";

const contract = ENDPOINTS.find((e) => e.id === "entries.get")!;
const env = readAppEnv();

Deno.serve((req) => {
  const id = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
  return runGateway(req, contract, { id }, handleGetEntry, buildGatewayDeps(req, env));
});
