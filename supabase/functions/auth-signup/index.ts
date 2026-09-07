// Entrada Deno da função `auth-signup` — só fiação (Seção 7: "cada Edge
// Function chama `runGateway` com o `EndpointContract` que lhe cabe e o
// seu handler"). Lógica de negócio fica em `handler.ts` (testável sem
// `Deno.serve`).

import { ENDPOINTS } from "../../../contracts/zod/registry.ts";
import { buildGatewayDeps, readAppEnv } from "../_shared/deps.ts";
import { runGateway } from "../_shared/gateway.ts";
import { handleSignup, type SignupBody } from "./handler.ts";

const contract = ENDPOINTS.find((e) => e.id === "auth.signup")!;
const env = readAppEnv();

Deno.serve((req) =>
  runGateway<SignupBody>(
    req,
    contract,
    {},
    (ctx) => handleSignup(ctx, env),
    buildGatewayDeps(req, env),
  )
);
