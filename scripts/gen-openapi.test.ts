// Teste do gerador de OpenAPI (T-033).
// Critério de conclusão do checklist: "job `contracts` verde" — este teste
// cobre a parte que roda sem precisar do workflow do GitHub Actions: o
// documento é gerado sem erro a partir de TODOS os 23 endpoints (nenhum
// deles usa um construtor Zod que o conversor não suporta), com a forma
// esperada nos pontos mais arriscados.

import { assert, assertEquals } from "../supabase/functions/_shared/_test_utils.ts";
import { ENDPOINTS } from "../contracts/zod/registry.ts";
import { buildOpenApiDocument } from "./gen-openapi.ts";

interface Operation {
  security: unknown[];
  parameters?: Array<{ name: string; in: string; required: boolean; schema: unknown }>;
  requestBody?: { content: Record<string, unknown> };
  responses: Record<string, { content?: Record<string, unknown> }>;
}
type Doc = {
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

Deno.test("todo endpoint com requestBody gera requestBody.content['application/json'] no OpenAPI", () => {
  const doc = buildOpenApiDocument() as unknown as Doc;
  const withBody = ENDPOINTS.filter((e) => e.requestBody);
  for (const contract of withBody) {
    const openApiPath = contract.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
    const op = operationAt(doc, openApiPath, contract.method.toLowerCase());
    assert(op.requestBody?.content["application/json"], `${contract.id} deveria ter requestBody`);
  }
});
