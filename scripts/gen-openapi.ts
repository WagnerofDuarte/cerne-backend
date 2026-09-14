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

// D-01 (docs/backend/DIVERGENCIAS_E_INCONSISTENCIAS.md) — este `path` é só
// notação do contrato; não existe roteador nenhum servindo essas URLs. Cada
// endpoint é uma Edge Function própria, e o nome do diretório segue sempre
// o `id` do contrato com "." trocado por "-" (`entries.get` ->
// `entries-get`) — confirmado nos 23 diretórios de `supabase/functions/` e
// documentado no comentário de cada `index.ts` ("só fiação, ver
// `auth-signup/index.ts`"). Usado tanto para o `x-cerne-function` de cada
// operação quanto para a tabela em `docs/handoff/README.md`
// (`gen-handoff-docs.ts`).
export function functionNameFor(contract: EndpointContract): string {
  return contract.id.replace(/\./g, "-");
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
    // D-01: aponta pro diretório real da Edge Function — o `path` acima é
    // só notação REST do contrato, ver `servers`/`info.description`.
    "x-cerne-function": functionNameFor(contract),
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
        "GERADO por scripts/gen-openapi.ts a partir de contracts/zod/ (T-026) — não editar " +
        "à mão.\n\n" +
        "**Como montar a URL real (D-01):** não existe roteador — cada operação é " +
        "servida por uma Edge Function própria, uma por endpoint. O `path` de cada " +
        "operação abaixo é só notação REST do contrato; a URL de verdade é " +
        "`{FUNCTIONS_BASE_URL}/<x-cerne-function>/<parâmetros de path, na mesma ordem " +
        "em que aparecem no `path`, como segmentos finais>` — qualquer segmento " +
        "literal do `path` depois do último parâmetro (ex.: o `/retry` de " +
        "`/chat/sessions/{id}/messages/{userMessageId}/retry`) NÃO aparece na URL " +
        "real. Cada operação carrega o nome da função em `x-cerne-function`; a " +
        "tabela completa caminho→função está em `docs/handoff/README.md`.",
      // "1.0.0" ecoa a tag de congelamento do backend (T-065,
      // `backend-v1.0-frozen`) — não é um número escolhido à toa.
      version: "1.0.0",
    },
    servers: [
      {
        url: "{FUNCTIONS_BASE_URL}",
        variables: {
          FUNCTIONS_BASE_URL: {
            default: "https://<project-ref>.functions.supabase.co",
            description: "Base das Edge Functions do ambiente (dev/ciclo-a/ciclo-b) — o " +
              "`project ref` de cada ambiente está no pacote de credenciais " +
              "(`credenciais/README.md`), nunca neste arquivo gerado.",
          },
        },
      },
    ],
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
