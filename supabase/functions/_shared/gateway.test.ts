// Teste do módulo `gateway` (T-031).
// Critério de conclusão do checklist: "requisição sem token retorna AUTH_EXPIRED".

import { z } from "zod";
import { assert, assertEquals } from "./_test_utils.ts";
import { type EndpointContract } from "../../../contracts/zod/registry.ts";
import { CerneError } from "./errors.ts";
import { ReplayMissError } from "./replay.ts";
import {
  type GatewayContext,
  type GatewayDeps,
  runGateway,
  TIMEOUT_FAULT_DELAY_MS,
} from "./gateway.ts";

const TEST_FAULT_KEY = "segredo-de-teste-123";

const echoContract: EndpointContract = {
  id: "test.echo",
  method: "POST",
  path: "/test/echo",
  summary: "endpoint de teste",
  auth: true,
  requestBody: z.object({ text: z.string().min(1) }),
  response: {
    kind: "json",
    status: 200,
    schema: z.object({ data: z.object({ text: z.string() }) }),
  },
};

const noAuthContract: EndpointContract = { ...echoContract, id: "test.noauth", auth: false };

const withQueryContract: EndpointContract = {
  ...echoContract,
  id: "test.query",
  requestBody: undefined,
  requestQuery: z.object({ limit: z.coerce.number().int().min(1).max(50).default(20).optional() }),
};

function baseDeps(overrides: Partial<GatewayDeps> = {}): GatewayDeps {
  const calls: unknown[] = [];
  return {
    testFaultKey: TEST_FAULT_KEY,
    db: { supabaseUrl: "https://example.test", supabaseAnonKey: "anon-key" },
    logFaultInjection: (args) => {
      calls.push(args);
      return Promise.resolve();
    },
    verifyAccessToken: (token) =>
      Promise.resolve(token === "token-valido" ? { userId: "user-1" } : null),
    delayFn: () => Promise.resolve(), // testes não esperam de verdade
    ...overrides,
  };
}

function echoHandler() {
  return (ctx: GatewayContext) =>
    Promise.resolve({ status: 200, envelope: { data: { received: ctx.body } } });
}

Deno.test("requisição sem token retorna AUTH_EXPIRED (critério de conclusão do T-031)", async () => {
  const req = new Request("https://example.test/test/echo", {
    method: "POST",
    body: JSON.stringify({ text: "oi" }),
  });
  const res = await runGateway(req, echoContract, {}, echoHandler(), baseDeps());
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.code, "AUTH_EXPIRED");
});

Deno.test("sem token: drena o corpo não lido antes de responder (achado real, T-041 — Deno.serve trava se a Response volta sem o body consumido)", async () => {
  const req = new Request("https://example.test/test/echo", {
    method: "POST",
    body: JSON.stringify({
      text: "corpo que nunca chega a ser lido — a autenticação falha antes do passo 6",
    }),
  });
  assertEquals(req.bodyUsed, false);
  const res = await runGateway(req, echoContract, {}, echoHandler(), baseDeps());
  assertEquals(res.status, 401);
  assertEquals(
    req.bodyUsed,
    true,
    "o gateway deveria ter drenado o corpo não lido antes de responder",
  );
});

Deno.test("token inválido retorna AUTH_INVALID", async () => {
  const req = new Request("https://example.test/test/echo", {
    method: "POST",
    headers: { Authorization: "Bearer token-invalido" },
    body: JSON.stringify({ text: "oi" }),
  });
  const res = await runGateway(req, echoContract, {}, echoHandler(), baseDeps());
  assertEquals(res.status, 401);
  assertEquals((await res.json()).code, "AUTH_INVALID");
});

Deno.test("X-Request-Id é ecoado quando presente, gerado quando ausente", async () => {
  const withId = new Request("https://example.test/test/echo", {
    method: "POST",
    headers: { Authorization: "Bearer token-valido", "X-Request-Id": "meu-id-123" },
    body: JSON.stringify({ text: "oi" }),
  });
  const res1 = await runGateway(withId, echoContract, {}, echoHandler(), baseDeps());
  assertEquals(res1.headers.get("X-Request-Id"), "meu-id-123");

  const withoutId = new Request("https://example.test/test/echo", {
    method: "POST",
    headers: { Authorization: "Bearer token-valido" },
    body: JSON.stringify({ text: "oi" }),
  });
  const res2 = await runGateway(withoutId, echoContract, {}, echoHandler(), baseDeps());
  assert(res2.headers.get("X-Request-Id")!.length > 0);
});

Deno.test("requisição válida chega ao handler com body validado e auth resolvida", async () => {
  const req = new Request("https://example.test/test/echo", {
    method: "POST",
    headers: { Authorization: "Bearer token-valido" },
    body: JSON.stringify({ text: "olá mundo" }),
  });
  let capturedCtx: GatewayContext | undefined;
  const res = await runGateway(
    req,
    echoContract,
    { id: "abc" },
    (ctx) => {
      capturedCtx = ctx;
      return Promise.resolve({ status: 200, envelope: { data: { ok: true } } });
    },
    baseDeps(),
  );
  assertEquals(res.status, 200);
  assertEquals(capturedCtx?.body, { text: "olá mundo" });
  assertEquals(capturedCtx?.auth?.userId, "user-1");
  assertEquals(capturedCtx?.params, { id: "abc" });
});

Deno.test("endpoint auth:false não chama verifyAccessToken e auth fica null", async () => {
  let verifyCalls = 0;
  const req = new Request("https://example.test/test/echo", {
    method: "POST",
    body: JSON.stringify({ text: "oi" }),
  });
  let capturedCtx: GatewayContext | undefined;
  await runGateway(
    req,
    noAuthContract,
    {},
    (ctx) => {
      capturedCtx = ctx;
      return Promise.resolve({ status: 200, envelope: { data: {} } });
    },
    baseDeps({
      verifyAccessToken: () => {
        verifyCalls++;
        return Promise.resolve(null);
      },
    }),
  );
  assertEquals(verifyCalls, 0);
  assertEquals(capturedCtx?.auth, null);
});

Deno.test("corpo inválido (falha no Zod) vira VALIDATION_ERROR / 400", async () => {
  const req = new Request("https://example.test/test/echo", {
    method: "POST",
    headers: { Authorization: "Bearer token-valido" },
    body: JSON.stringify({ text: "" }), // min(1) falha
  });
  const res = await runGateway(req, echoContract, {}, echoHandler(), baseDeps());
  assertEquals(res.status, 400);
  assertEquals((await res.json()).code, "VALIDATION_ERROR");
});

Deno.test("query inválida vira VALIDATION_ERROR / 400", async () => {
  const req = new Request("https://example.test/test/query?limit=999", {
    method: "POST",
    headers: { Authorization: "Bearer token-valido" },
  });
  const res = await runGateway(req, withQueryContract, {}, echoHandler(), baseDeps());
  assertEquals(res.status, 400);
});

Deno.test("query válida chega parseada e coagida (limit vira number)", async () => {
  const req = new Request("https://example.test/test/query?limit=5", {
    method: "POST",
    headers: { Authorization: "Bearer token-valido" },
  });
  let capturedCtx: GatewayContext | undefined;
  await runGateway(
    req,
    withQueryContract,
    {},
    (ctx) => {
      capturedCtx = ctx;
      return Promise.resolve({ status: 200, envelope: { data: {} } });
    },
    baseDeps(),
  );
  assertEquals(capturedCtx?.query, { limit: 5 });
});

// --- Erros propagados do handler ----------------------------------------

Deno.test("CerneError lançado pelo handler vira o envelope de erro certo", async () => {
  const req = new Request("https://example.test/test/echo", {
    method: "POST",
    headers: { Authorization: "Bearer token-valido" },
    body: JSON.stringify({ text: "oi" }),
  });
  const res = await runGateway(
    req,
    echoContract,
    {},
    () => {
      throw new CerneError("NOT_FOUND", "entrada não encontrada");
    },
    baseDeps(),
  );
  assertEquals(res.status, 404);
  assertEquals((await res.json()).code, "NOT_FOUND");
});

Deno.test("ReplayMissError vira 500 com code REPLAY_MISS, fora da taxonomia de 13", async () => {
  const req = new Request("https://example.test/test/echo", {
    method: "POST",
    headers: { Authorization: "Bearer token-valido" },
    body: JSON.stringify({ text: "oi" }),
  });
  const res = await runGateway(
    req,
    echoContract,
    {},
    () => {
      throw new ReplayMissError("abc123", "chat");
    },
    baseDeps(),
  );
  assertEquals(res.status, 500);
  assertEquals((await res.json()).code, "REPLAY_MISS");
});

Deno.test("erro desconhecido vira 500 INTERNAL_ERROR, sem vazar detalhe interno", async () => {
  const req = new Request("https://example.test/test/echo", {
    method: "POST",
    headers: { Authorization: "Bearer token-valido" },
    body: JSON.stringify({ text: "oi" }),
  });
  const res = await runGateway(
    req,
    echoContract,
    {},
    () => {
      throw new Error("detalhe interno sensível, ex: stack trace ou string de conexão");
    },
    baseDeps(),
  );
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.code, "INTERNAL_ERROR");
  assert(!JSON.stringify(body).includes("sensível"));
});

// --- Injeção de falha (T-029 aplicado pelo gateway, §10) -----------------

function faultReq(fault: string, opts: { auth?: boolean } = {}): Request {
  const headers: Record<string, string> = { "X-Test-Key": TEST_FAULT_KEY, "X-Test-Fault": fault };
  if (opts.auth !== false) headers.Authorization = "Bearer token-valido";
  return new Request("https://example.test/test/echo", {
    method: "POST",
    headers,
    body: JSON.stringify({ text: "oi" }),
  });
}

Deno.test("fault 'offline' nunca resolve a Response, e vence mesmo sem token (antes da autenticação)", async () => {
  let verifyCalls = 0;
  const deps = baseDeps({
    verifyAccessToken: () => {
      verifyCalls++;
      return Promise.resolve({ userId: "user-1" });
    },
  });
  const req = faultReq("offline", { auth: false }); // nem token tem — offline deveria vencer antes do AUTH_EXPIRED

  const TIMEOUT = Symbol("timeout-da-asserção-nao-do-gateway");
  const winner = await Promise.race([
    runGateway(req, echoContract, {}, echoHandler(), deps),
    new Promise((resolve) => setTimeout(() => resolve(TIMEOUT), 150)),
  ]);
  assertEquals(winner, TIMEOUT, "a Response não deveria resolver para uma falha 'offline'");
  assertEquals(verifyCalls, 0, "offline deveria vencer antes mesmo de tentar autenticar");
});

Deno.test("fault 'timeout': espera exatamente TIMEOUT_FAULT_DELAY_MS e devolve 504 NETWORK_TIMEOUT", async () => {
  const delays: number[] = [];
  const res = await runGateway(
    faultReq("timeout"),
    echoContract,
    {},
    echoHandler(),
    baseDeps({
      delayFn: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    }),
  );
  assertEquals(delays, [TIMEOUT_FAULT_DELAY_MS]);
  assertEquals(res.status, 504);
  assertEquals((await res.json()).code, "NETWORK_TIMEOUT");
});

Deno.test("fault 'malformed': 200 com corpo fora do formato de envelope", async () => {
  const res = await runGateway(faultReq("malformed"), echoContract, {}, echoHandler(), baseDeps());
  assertEquals(res.status, 200);
  const body = await res.json();
  assert(
    !("data" in body) && !("code" in body),
    "corpo deveria ser deliberadamente fora do contrato",
  );
});

Deno.test("fault 'rate_limited': 429 com code RATE_LIMITED", async () => {
  const res = await runGateway(
    faultReq("rate_limited"),
    echoContract,
    {},
    echoHandler(),
    baseDeps(),
  );
  assertEquals(res.status, 429);
  assertEquals((await res.json()).code, "RATE_LIMITED");
});

Deno.test("fault 'slow:<ms>': atrasa e depois segue normalmente para o handler", async () => {
  const delays: number[] = [];
  let handlerCalled = false;
  const res = await runGateway(
    faultReq("slow:250"),
    echoContract,
    {},
    () => {
      handlerCalled = true;
      return Promise.resolve({ status: 200, envelope: { data: { ok: true } } });
    },
    baseDeps({
      delayFn: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    }),
  );
  assertEquals(delays, [250]);
  assert(handlerCalled);
  assertEquals(res.status, 200);
});

Deno.test("fault 'ai_timeout': não curto-circuita — handler roda e recebe ctx.fault", async () => {
  let capturedFault: unknown;
  const res = await runGateway(faultReq("ai_timeout"), echoContract, {}, (ctx) => {
    capturedFault = ctx.fault;
    return Promise.resolve({ status: 200, envelope: { data: { ok: true } } });
  }, baseDeps());
  assertEquals(res.status, 200);
  assertEquals(capturedFault, { type: "ai_timeout" });
});

// --- Resposta em streaming SSE (T-044) -----------------------------------

Deno.test("handler que devolve { stream } produz Response text/event-stream com o mesmo X-Request-Id", async () => {
  const req = new Request("https://example.test/test/echo", {
    method: "POST",
    headers: { Authorization: "Bearer token-valido", "X-Request-Id": "req-sse-1" },
    body: JSON.stringify({ text: "oi" }),
  });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
      controller.close();
    },
  });
  const res = await runGateway(
    req,
    echoContract,
    {},
    () => Promise.resolve({ stream }),
    baseDeps(),
  );
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "text/event-stream; charset=utf-8");
  assertEquals(res.headers.get("X-Request-Id"), "req-sse-1");
  const body = await res.text();
  assert(body.includes("event: done"));
});

Deno.test("sem X-Test-Key correto, X-Test-Fault é ignorado e a requisição segue normal", async () => {
  const req = new Request("https://example.test/test/echo", {
    method: "POST",
    headers: { Authorization: "Bearer token-valido", "X-Test-Fault": "rate_limited" },
    body: JSON.stringify({ text: "oi" }),
  });
  const res = await runGateway(req, echoContract, {}, echoHandler(), baseDeps());
  assertEquals(res.status, 200); // não 429 — chave de teste não foi enviada
});
