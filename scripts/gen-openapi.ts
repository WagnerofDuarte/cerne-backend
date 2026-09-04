#!/usr/bin/env -S deno run --allow-read --allow-write
// T-033 — Gera `contracts/openapi.yaml` a partir dos schemas Zod
// (`contracts/zod/registry.ts`, T-026). Fonte única: nunca editar o YAML
// gerado à mão — o CI (job `contracts`) regenera e compara com
// `git diff --exit-code`; divergência quebra o build (§8.8, §11.4).
//
// Uso: deno run -A scripts/gen-openapi.ts

import { stringify as yamlStringify } from "yaml";
import {
  type EndpointContract,
  ENDPOINTS,
  errorResponseSchema,
} from "../contracts/zod/registry.ts";
import { type JsonSchema, zodToJsonSchema } from "./openapi/zod-to-json-schema.ts";

function pathToOpenApi(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function pathParamNames(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z0-9_]+)/g)]
    .map((m) => m[1])
    .filter((name): name is string => name !== undefined);
}

function buildParameters(contract: EndpointContract): JsonSchema[] {
  const parameters: JsonSchema[] = pathParamNames(contract.path).map((name) => ({
    name,
    in: "path",
    required: true,
    schema: { type: "string" },
  }));

  if (contract.requestQuery) {
    const querySchema = zodToJsonSchema(contract.requestQuery);
    const properties = (querySchema.properties ?? {}) as Record<string, JsonSchema>;
    const required = new Set((querySchema.required as string[] | undefined) ?? []);
    for (const [name, schema] of Object.entries(properties)) {
      parameters.push({ name, in: "query", required: required.has(name), schema });
    }
  }

  return parameters;
}

function buildResponses(contract: EndpointContract): Record<string, JsonSchema> {
  const responses: Record<string, JsonSchema> = {};

  if (contract.response.kind === "json") {
    responses[String(contract.response.status)] = {
      description: "Sucesso",
      content: { "application/json": { schema: zodToJsonSchema(contract.response.schema) } },
    };
  } else if (contract.response.kind === "sse") {
    responses["200"] = {
      description:
        "Streaming SSE (D12): message_created -> context -> token* -> done|error, nesta ordem",
      content: { "text/event-stream": { schema: { type: "string" } } },
    };
  } else {
    responses["302"] = { description: "Redirect para URL assinada do Storage" };
  }

  // Formato único de erro em toda a API (§3.2) — mesmo schema para os 23 endpoints.
  responses.default = {
    description: "Erro",
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  };
  return responses;
}

function buildOperation(contract: EndpointContract): JsonSchema {
  const operation: JsonSchema = {
    operationId: contract.id,
    summary: contract.summary,
    // Endpoints sem sessão prévia (signup/login/refresh) não exigem Bearer.
    security: contract.auth ? [{ bearerAuth: [] }] : [],
  };

  const parameters = buildParameters(contract);
  if (parameters.length > 0) operation.parameters = parameters;

  if (contract.requestBody) {
    operation.requestBody = {
      required: true,
      content: { "application/json": { schema: zodToJsonSchema(contract.requestBody) } },
    };
  }

  operation.responses = buildResponses(contract);
  return operation;
}

export function buildOpenApiDocument(): JsonSchema {
  const paths: Record<string, Record<string, JsonSchema>> = {};
  for (const contract of ENDPOINTS) {
    const openApiPath = pathToOpenApi(contract.path);
    paths[openApiPath] ??= {};
    paths[openApiPath][contract.method.toLowerCase()] = buildOperation(contract);
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "Cerne Backend API",
      description:
        "GERADO por scripts/gen-openapi.ts a partir de contracts/zod/ (T-026) — não editar à mão.",
      // "1.0.0" ecoa a tag de congelamento do backend (T-065,
      // `backend-v1.0-frozen`) — não é um número escolhido à toa.
      version: "1.0.0",
    },
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      schemas: {
        Error: zodToJsonSchema(errorResponseSchema),
      },
    },
  };
}

if (import.meta.main) {
  const outputUrl = new URL("../contracts/openapi.yaml", import.meta.url);
  const header =
    "# GERADO por scripts/gen-openapi.ts a partir de contracts/zod/ — não editar à mão.\n" +
    "# Para regenerar: deno run -A scripts/gen-openapi.ts\n\n";
  await Deno.writeTextFile(
    outputUrl,
    header + yamlStringify(buildOpenApiDocument(), { lineWidth: 100 }),
  );
  console.log(`contracts/openapi.yaml gerado com ${ENDPOINTS.length} endpoints.`);
}
