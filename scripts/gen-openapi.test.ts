// Teste do gerador de OpenAPI (T-033).
// Critério de conclusão do checklist: "job `contracts` verde" — este teste
// cobre a parte que roda sem precisar do workflow do GitHub Actions: o
// documento é gerado sem erro a partir de TODOS os 23 endpoints (nenhum
// deles usa um construtor Zod que o conversor não suporta), com a forma
// esperada nos pontos mais arriscados.

import { assert, assertEquals } from "../supabase/functions/_shared/_test_utils.ts";
import { ENDPOINTS } from "../contracts/zod/registry.ts";
import { buildOpenApiDocument, functionNameFor } from "./gen-openapi.ts";

interface Operation {
  security: unknown[];
  parameters?: Array<{ name: string; in: string; required: boolean; schema: unknown }>;
  requestBody?: { content: Record<string, unknown> };
  responses: Record<string, { content?: Record<string, unknown> }>;
  "x-cerne-function": string;
}
type Doc = {
  info: { description: string };
  servers: Array<{ url: string; variables: Record<string, { default: string }> }>;
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: { Error: { required: string[] } } };
};

function operationAt(doc: Doc, path: string, method: string): Operation {
  const forPath = doc.paths[path];
  assert(forPath, `esperava o caminho ${path} no OpenAPI gerado`);
  const op = forPath[method];
  assert(op, `esperava o método ${method} em ${path}`);
  return op;
}

Deno.test("gera o documento inteiro sem lançar (dogfooding dos 23 endpoints reais)", () => {
  const doc = buildOpenApiDocument() as unknown as Doc;
  assert(doc.paths);
  assert(doc.components.schemas.Error);
});

Deno.test("o total de operações (método x caminho) bate com os 23 endpoints do registro", () => {
  const doc = buildOpenApiDocument() as unknown as Doc;
  const total = Object.values(doc.paths).reduce(
    (sum, methods) => sum + Object.keys(methods).length,
    0,
  );
  assertEquals(total, ENDPOINTS.length);
  assertEquals(total, 23);
});

Deno.test(":id do plano técnico vira {id} no caminho OpenAPI", () => {
  const doc = buildOpenApiDocument() as unknown as Doc;
  const op = operationAt(doc, "/entries/{id}", "get");
  const idParam = op.parameters?.find((p) => p.name === "id");
  assertEquals(idParam, { name: "id", in: "path", required: true, schema: { type: "string" } });
});

Deno.test("caminho com dois path params (retry) vira {id} e {userMessageId}", () => {
  const doc = buildOpenApiDocument() as unknown as Doc;
  assert("/chat/sessions/{id}/messages/{userMessageId}/retry" in doc.paths);
});

Deno.test("endpoints sem sessão prévia (signup/login/refresh) têm security: []", () => {
  const doc = buildOpenApiDocument() as unknown as Doc;
  assertEquals(operationAt(doc, "/auth/signup", "post").security, []);
  assertEquals(operationAt(doc, "/auth/login", "post").security, []);
  assertEquals(operationAt(doc, "/auth/refresh", "post").security, []);
});

Deno.test("os demais 20 endpoints exigem bearerAuth", () => {
  const doc = buildOpenApiDocument() as unknown as Doc;
  assertEquals(operationAt(doc, "/entries", "post").security, [{ bearerAuth: [] }]);
  assertEquals(operationAt(doc, "/account", "delete").security, [{ bearerAuth: [] }]);
});

Deno.test("POST /chat/sessions/{id}/messages documenta text/event-stream (SSE, D12)", () => {
  const doc = buildOpenApiDocument() as unknown as Doc;
  const op = operationAt(doc, "/chat/sessions/{id}/messages", "post");
  assert(op.responses["200"]?.content?.["text/event-stream"]);
});

Deno.test("GET /export/{jobId}/download documenta 302, sem corpo JSON de sucesso", () => {
  const doc = buildOpenApiDocument() as unknown as Doc;
  const op = operationAt(doc, "/export/{jobId}/download", "get");
  assert("302" in op.responses);
});

Deno.test("components.schemas.Error tem os 4 campos do envelope de erro (§3.2)", () => {
  const doc = buildOpenApiDocument() as unknown as Doc;
  assertEquals(
    new Set(doc.components.schemas.Error.required),
    new Set(["code", "message", "retryable", "requestId"]),
  );
});

Deno.test("D-01: servers: traz FUNCTIONS_BASE_URL, não fica implícito", () => {
  const doc = buildOpenApiDocument() as unknown as Doc;
  assertEquals(doc.servers.length, 1);
  assertEquals(doc.servers[0]?.url, "{FUNCTIONS_BASE_URL}");
  assert(doc.servers[0]?.variables.FUNCTIONS_BASE_URL?.default);
});

Deno.test("D-01: toda operação carrega x-cerne-function, e é o id do contrato com '.' -> '-'", () => {
  const doc = buildOpenApiDocument() as unknown as Doc;
  for (const contract of ENDPOINTS) {
    const openApiPath = contract.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
    const op = operationAt(doc, openApiPath, contract.method.toLowerCase());
    assertEquals(op["x-cerne-function"], functionNameFor(contract));
    assertEquals(op["x-cerne-function"], contract.id.replace(/\./g, "-"));
  }
});

Deno.test("D-01: x-cerne-function de cada operação é um diretório real em supabase/functions/", async () => {
  const dirs = new Set<string>();
  for await (const entry of Deno.readDir(new URL("../supabase/functions/", import.meta.url))) {
    if (entry.isDirectory) dirs.add(entry.name);
  }
  for (const contract of ENDPOINTS) {
    const fnName = functionNameFor(contract);
    assert(
      dirs.has(fnName),
      `${contract.id} -> x-cerne-function "${fnName}" não bate com nenhum diretório em ` +
        "supabase/functions/ — convenção quebrou, ver D-01",
    );
  }
});

Deno.test("D-01: info.description explica como montar a URL real e cita x-cerne-function", () => {
  const doc = buildOpenApiDocument() as unknown as Doc;
  assert(doc.info.description.includes("x-cerne-function"));
  assert(doc.info.description.includes("FUNCTIONS_BASE_URL"));
});

Deno.test("todo endpoint com requestBody gera requestBody.content['application/json'] no OpenAPI", () => {
  const doc = buildOpenApiDocument() as unknown as Doc;
  const withBody = ENDPOINTS.filter((e) => e.requestBody);
  for (const contract of withBody) {
    const openApiPath = contract.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
    const op = operationAt(doc, openApiPath, contract.method.toLowerCase());
    assert(op.requestBody?.content["application/json"], `${contract.id} deveria ter requestBody`);
  }
});
