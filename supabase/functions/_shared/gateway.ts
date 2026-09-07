// T-031 — Módulo `gateway` (Plano técnico §7).
//
// "Ponto de entrada único." Ordem obrigatória (§7, §8): gerar/ecoar
// X-Request-Id → validar X-Test-Key → aplicar X-Test-Now → aplicar
// X-Test-Fault (antes da autenticação para `offline`, depois para os
// demais) → autenticar → validar corpo com Zod → executar handler →
// serializar → tratar exceção.
//
// Cada Edge Function (`supabase/functions/<endpoint>/index.ts`, Fase 3+)
// chama `runGateway` com o `EndpointContract` que lhe cabe (T-026) e o seu
// handler — o roteamento entre os 23 caminhos é responsabilidade de cada
// diretório de função (a convenção de deploy do Supabase, um por
// endpoint), não deste módulo.

import type { EndpointContract } from "../../../contracts/zod/registry.ts";
import { type ClockDeps, now } from "./clock.ts";
import { createUserClient, type DbClient, type DbEnv } from "./db.ts";
import { CerneError, throwError } from "./errors.ts";
import { applyFault, type FaultsDeps, type ParsedFault } from "./faults.ts";
import { ReplayMissError } from "./replay.ts";
import { buildErrorEnvelope, type DataEnvelope, dataResponse } from "./serialize.ts";
import { sseHeaders } from "./sse.ts";

export interface AuthContext {
  readonly userId: string;
  readonly accessToken: string;
  readonly db: DbClient;
}

export interface GatewayContext<TBody = unknown, TQuery = unknown> {
  readonly req: Request;
  readonly requestId: string;
  readonly now: Date;
  /** Extraídos pelo diretório da função (ex.: `:id`) — o gateway não roteia. */
  readonly params: Readonly<Record<string, string>>;
  readonly body: TBody;
  readonly query: TQuery;
  /** `null` só nos 3 endpoints de auth sem sessão prévia (signup/login/refresh). */
  readonly auth: AuthContext | null;
  /** A falha ativa desta requisição, se houver — `ai_timeout` chega até aqui para os clientes de IA (T-032) reagirem. */
  readonly fault: ParsedFault | null;
}

export interface HandlerResult<T = unknown> {
  readonly status: number;
  readonly envelope: DataEnvelope<T>;
  readonly headers?: HeadersInit;
}

/**
 * Resposta em streaming SSE (D12, T-044) — `chat.messages.send`/`.retry`
 * (`contract.response.kind === "sse"`, já previsto no registro desde
 * T-026). Diferente de `HandlerResult`, não há um envelope JSON único a
 * serializar: o handler já devolve o `ReadableStream` pronto, produzido
 * por `createSseStream` (T-044) e alimentado de forma assíncrona não
 * esperada por quem construiu o handler — o corpo da `Response` é esse
 * stream, os bytes chegam ao cliente conforme `emitter.emit(...)` roda.
 */
export interface StreamHandlerResult {
  readonly stream: ReadableStream<Uint8Array>;
  readonly headers?: HeadersInit;
}

export type GatewayHandler<TBody = unknown, TQuery = unknown> = (
  ctx: GatewayContext<TBody, TQuery>,
) => Promise<HandlerResult | StreamHandlerResult>;

function isStreamResult(
  result: HandlerResult | StreamHandlerResult,
): result is StreamHandlerResult {
  return "stream" in result;
}

export interface GatewayDeps {
  readonly testFaultKey: string | undefined;
  readonly db: DbEnv;
  readonly logFaultInjection: FaultsDeps["logFaultInjection"];
  /** Injetável para teste — produção chama o endpoint `/auth/v1/user` do GoTrue. */
  readonly verifyAccessToken: (accessToken: string) => Promise<{ userId: string } | null>;
  /** Injetável para teste (evita esperar os 35s reais de `timeout`) — produção usa `setTimeout`. */
  readonly delayFn?: (ms: number) => Promise<void>;
}

/** "Aguarda 35s e retorna NETWORK_TIMEOUT" (§10.2) — exportado para o teste conferir o valor exato. */
export const TIMEOUT_FAULT_DELAY_MS = 35_000;

export async function runGateway<TBody = unknown, TQuery = unknown>(
  req: Request,
  contract: EndpointContract,
  params: Record<string, string>,
  handler: GatewayHandler<TBody, TQuery>,
  deps: GatewayDeps,
): Promise<Response> {
  // 1) X-Request-Id — ecoado se presente, gerado se ausente (§3.3).
  const requestId = req.headers.get("X-Request-Id") ?? crypto.randomUUID();

  try {
    // 2) X-Test-Key só é "validado" no sentido de habilitar (ou não) os
    // dois cabeçalhos de teste — test-mode.ts decide isso a cada leitura,
    // não há um passo de rejeição aqui (§10.1: nunca rejeitado com erro).

    // 3) X-Test-Now (clock.ts já aplica o gate do X-Test-Key internamente).
    const clockDeps: ClockDeps = { testFaultKey: deps.testFaultKey };
    const currentTime = now(req, clockDeps);

    // 4a) X-Test-Fault, parte "offline" — antes da autenticação, por regra
    // explícita da Seção 7 ("um offline simulado precisa cortar a conexão
    // sem nem processar o token").
    const faultsDeps: FaultsDeps = {
      testFaultKey: deps.testFaultKey,
      logFaultInjection: deps.logFaultInjection,
    };
    const preAuthFault = await applyFault(req, requestId, contract.path, faultsDeps);
    if (preAuthFault?.type === "offline") {
      return simulateOffline();
    }

    // 5) Autenticar (só quando o contrato exige — signup/login/refresh não têm sessão prévia).
    const auth = contract.auth ? await authenticate(req, deps) : null;

    // 4b) X-Test-Fault, os outros 5 tipos — depois da autenticação. O
    // parse já ocorreu (4a); se havia uma falha e não era `offline`, o
    // efeito é aplicado agora, com o log já registrado em 4a (registrar
    // 1x só, não duas vezes).
    if (preAuthFault) {
      // TS já sabe, pelo `return` de "offline" acima, que o tipo aqui
      // nunca é "offline" — não precisa (nem compila) checar de novo.
      const shortCircuit = await applyNonOfflineFaultEffect(
        preAuthFault,
        requestId,
        deps.delayFn ?? delay,
      );
      if (shortCircuit) return shortCircuit;
      // `ai_timeout` e `slow` não curto-circuitam — seguem para o handler
      // (slow já esperou dentro de applyNonOfflineFaultEffect).
    }

    // 6) Validar corpo/query com Zod.
    const body = await parseBody<TBody>(req, contract);
    const query = parseQuery<TQuery>(req, contract);

    // 7) Executar o handler.
    const ctx: GatewayContext<TBody, TQuery> = {
      req,
      requestId,
      now: currentTime,
      params,
      body,
      query,
      auth,
      fault: preAuthFault,
    };
    const result = await handler(ctx);

    // 8) Serializar. Duas formas possíveis: envelope JSON (a maioria dos
    // 23 endpoints) ou stream SSE (`chat.messages.send`/`.retry`, D12) —
    // a segunda nunca passa por `dataResponse`, o corpo já é o
    // `ReadableStream` que o handler/T-044 montou.
    if (isStreamResult(result)) {
      const headers = sseHeaders(result.headers);
      headers.set("X-Request-Id", requestId);
      return new Response(result.stream, { status: 200, headers });
    }
    const headers = new Headers(result.headers);
    headers.set("X-Request-Id", requestId);
    return dataResponse(result.envelope, result.status, headers);
  } catch (err) {
    // 9) Tratar exceção.
    return handleError(err, requestId);
  } finally {
    // Achado real (T-041, media_ocr.hurl travando ~150s/504 mesmo com
    // env/base64 corretos): devolver uma `Response` sem nunca ler o corpo
    // da requisição trava a conexão no Deno.serve/edge-runtime quando o
    // payload é grande — bug documentado do Deno (denoland/deno#10182),
    // não deste projeto. Acontece toda vez que o passo 5 (autenticar)
    // rejeita ANTES do passo 6 (`parseBody`) rodar — ex.: AUTH_EXPIRED
    // numa requisição sem token, mas com uma imagem de alguns MB no
    // corpo (o `media-ocr` só lê `Authorization`, nunca chega a olhar o
    // body nesse caso). O dreno explícito aqui cobre qualquer caminho que
    // responda sem ter consumido o corpo — `bodyUsed` já é `true` para
    // quem passou pelo passo 6 normalmente, então isso nunca lê 2x.
    if (req.body && !req.bodyUsed) {
      await req.arrayBuffer().catch(() => {
        // conexão do cliente pode já ter caído — não muda a resposta que já decidimos devolver
      });
    }
  }
}

// --- Passo 4b: efeito das falhas não-offline --------------------------

/**
 * `null` = não curto-circuita (a requisição segue para o handler — casos
 * de `ai_timeout`, que só afeta a chamada de IA dentro do handler, e
 * `slow`, que já esperou aqui e segue normalmente).
 */
async function applyNonOfflineFaultEffect(
  fault: ParsedFault,
  requestId: string,
  delayFn: (ms: number) => Promise<void>,
): Promise<Response | null> {
  switch (fault.type) {
    case "timeout":
      await delayFn(TIMEOUT_FAULT_DELAY_MS);
      return errorResponseFor(new CerneError("NETWORK_TIMEOUT"), requestId);
    case "malformed":
      return malformedResponse(requestId);
    case "rate_limited":
      return errorResponseFor(new CerneError("RATE_LIMITED"), requestId);
    case "slow":
      await delayFn(fault.delayMs ?? 0);
      return null;
    case "ai_timeout":
      return null;
    default:
      return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * "Retorna 200 com corpo JSON estruturalmente inválido para o schema"
 * (§10.2) — o objetivo é o app real reagir a um servidor que devolveu
 * lixo, então o corpo aqui é deliberadamente fora do envelope `{data,
 * meta}`/`{code,message,retryable,requestId}` esperado por qualquer dos
 * 23 contratos.
 */
function malformedResponse(requestId: string): Response {
  const headers = new Headers({ "Content-Type": "application/json", "X-Request-Id": requestId });
  return new Response(
    JSON.stringify({
      __injected_fault__: "malformed",
      note: "corpo intencionalmente fora do contrato",
    }),
    { status: 200, headers },
  );
}

/**
 * "Encerra a conexão sem resposta" (§10.2). Não existe, no nível de uma
 * Edge Function, um jeito de derrubar o socket TCP sem responder — a
 * aproximação honesta mais próxima é nunca resolver a `Response`: o app
 * cliente nunca recebe bytes de volta (diferente de um 5xx, que É uma
 * resposta) até o runtime cortar a conexão por conta própria (fora do
 * controle deste módulo). Documentado como limitação, não escondido.
 */
function simulateOffline(): Promise<Response> {
  return new Promise<Response>(() => {});
}

// --- Passo 5: autenticação ------------------------------------------

async function authenticate(req: Request, deps: GatewayDeps): Promise<AuthContext> {
  const authHeader = req.headers.get("Authorization");
  const accessToken = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
  // Critério de conclusão do T-031: requisição sem token retorna AUTH_EXPIRED.
  if (!accessToken) throwError("AUTH_EXPIRED", "cabeçalho Authorization ausente");

  const verified = await deps.verifyAccessToken(accessToken);
  if (!verified) throwError("AUTH_INVALID", "token inválido ou expirado");

  return {
    userId: verified.userId,
    accessToken,
    db: createUserClient(deps.db, accessToken),
  };
}

/** Implementação real de `verifyAccessToken` — chama o endpoint de usuário do GoTrue. */
export async function verifyAccessTokenViaGoTrue(
  env: DbEnv,
  accessToken: string,
): Promise<{ userId: string } | null> {
  const res = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${accessToken}`, apikey: env.supabaseAnonKey },
  });
  if (!res.ok) return null;
  const body = await res.json();
  if (typeof body?.id !== "string") return null;
  return { userId: body.id };
}

// --- Passo 6: validação de corpo/query --------------------------------

async function parseBody<TBody>(req: Request, contract: EndpointContract): Promise<TBody> {
  if (!contract.requestBody) return undefined as TBody;

  let raw: unknown;
  try {
    raw = req.body === null ? {} : await req.json();
  } catch {
    throwError("VALIDATION_ERROR", "corpo da requisição não é JSON válido");
  }

  const parsed = contract.requestBody.safeParse(raw);
  if (!parsed.success) {
    throwError("VALIDATION_ERROR", summarizeZodError(parsed.error));
  }
  return parsed.data as TBody;
}

function parseQuery<TQuery>(req: Request, contract: EndpointContract): TQuery {
  if (!contract.requestQuery) return undefined as TQuery;

  const raw: Record<string, string> = {};
  for (const [key, value] of new URL(req.url).searchParams) {
    raw[key] = value;
  }

  const parsed = contract.requestQuery.safeParse(raw);
  if (!parsed.success) {
    throwError("VALIDATION_ERROR", summarizeZodError(parsed.error));
  }
  return parsed.data as TQuery;
}

function summarizeZodError(
  error: { issues: Array<{ path: PropertyKey[]; message: string }> },
): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "(raiz)"}: ${issue.message}`).join(
    "; ",
  );
}

// --- Passo 9: tratamento de exceção -----------------------------------

function errorResponseFor(err: CerneError, requestId: string): Response {
  const headers = new Headers({ "X-Request-Id": requestId });
  return new Response(JSON.stringify(buildErrorEnvelope(err, requestId)), {
    status: err.http ?? 500,
    headers: (() => {
      headers.set("Content-Type", "application/json");
      return headers;
    })(),
  });
}

function handleError(err: unknown, requestId: string): Response {
  if (err instanceof CerneError) {
    return errorResponseFor(err, requestId);
  }

  if (err instanceof ReplayMissError) {
    // Fora da taxonomia de 13 — infraestrutura de experimento, HTTP 500,
    // só ocorre em replay_strict (§9.3). Nunca chega ao app em uso normal.
    const headers = new Headers({ "Content-Type": "application/json", "X-Request-Id": requestId });
    return new Response(
      JSON.stringify({ code: "REPLAY_MISS", message: err.message, requestId }),
      { status: 500, headers },
    );
  }

  // Última rede de segurança — um bug real do handler não pode vazar
  // detalhe interno na resposta, mas também não pode inventar um dos 13
  // códigos que não se aplica.
  const headers = new Headers({ "Content-Type": "application/json", "X-Request-Id": requestId });
  return new Response(
    JSON.stringify({ code: "INTERNAL_ERROR", message: "erro inesperado no servidor", requestId }),
    { status: 500, headers },
  );
}
