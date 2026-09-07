// Entrada Deno da função `media-ocr` — só fiação, ver `auth-signup/index.ts`.

import { ENDPOINTS } from "../../../contracts/zod/registry.ts";
import { buildGatewayDeps, readOcrEnv } from "../_shared/deps.ts";
import { runGateway } from "../_shared/gateway.ts";
import { handleOcr, type OcrBody } from "./handler.ts";

const contract = ENDPOINTS.find((e) => e.id === "media.ocr")!;
const env = readOcrEnv();

Deno.serve((req) =>
  runGateway<OcrBody>(
    req,
    contract,
    {},
    (ctx) => handleOcr(ctx, env),
    buildGatewayDeps(req, env),
  )
);
