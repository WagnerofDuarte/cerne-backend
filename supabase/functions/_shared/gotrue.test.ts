// Teste do módulo `gotrue` (T-034).

import { assert, assertEquals, assertThrowsAsync } from "./_test_utils.ts";
import {
  decodeJwtClaims,
  GoTrueApiError,
  logout,
  refreshAccessToken,
  signInWithPassword,
  signUp,
} from "./gotrue.ts";

const env = { supabaseUrl: "https://example.test", supabaseAnonKey: "anon-key-123" };

function fakeFetch(
  handler: (url: string, init: RequestInit) => Response,
): typeof fetch {
  return ((url: string | URL, init?: RequestInit) =>
    Promise.resolve(handler(url.toString(), init ?? {}))) as typeof fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.test("signUp: POST /auth/v1/signup com apikey e corpo email/password", async () => {
  let captured: { url: string; init: RequestInit } | undefined;
  const fetchImpl = fakeFetch((url, init) => {
    captured = { url, init };
    return jsonResponse(200, {
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3600,
      expires_at: 1234567890,
      token_type: "bearer",
      user: { id: "u1", email: "a@b.test" },
    });
  });
  const res = await signUp({ ...env, fetchImpl }, { email: "a@b.test", password: "senha123" });
  assertEquals(captured?.url, "https://example.test/auth/v1/signup");
  assertEquals((captured?.init.headers as Record<string, string>).apikey, "anon-key-123");
  assertEquals(JSON.parse(captured?.init.body as string), {
    email: "a@b.test",
    password: "senha123",
  });
  assertEquals(res.user, { id: "u1", email: "a@b.test" });
});

Deno.test("signInWithPassword: POST /auth/v1/token?grant_type=password", async () => {
  let capturedUrl = "";
  const fetchImpl = fakeFetch((url) => {
    capturedUrl = url;
    return jsonResponse(200, {
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3600,
      expires_at: 1234567890,
      token_type: "bearer",
      user: { id: "u1", email: "a@b.test" },
    });
  });
  await signInWithPassword({ ...env, fetchImpl }, { email: "a@b.test", password: "x" });
  assertEquals(capturedUrl, "https://example.test/auth/v1/token?grant_type=password");
});

Deno.test("refreshAccessToken: POST /auth/v1/token?grant_type=refresh_token com refresh_token no corpo", async () => {
  let capturedBody: unknown;
  let capturedUrl = "";
  const fetchImpl = fakeFetch((url, init) => {
    capturedUrl = url;
    capturedBody = JSON.parse(init.body as string);
    return jsonResponse(200, {
      access_token: "at2",
      refresh_token: "rt2",
      expires_in: 3600,
      expires_at: 1234567890,
      token_type: "bearer",
      user: { id: "u1" },
    });
  });
  await refreshAccessToken({ ...env, fetchImpl }, "meu-refresh-token");
  assertEquals(capturedUrl, "https://example.test/auth/v1/token?grant_type=refresh_token");
  assertEquals(capturedBody, { refresh_token: "meu-refresh-token" });
});

Deno.test("logout: POST /auth/v1/logout com Authorization Bearer, 204 sem corpo", async () => {
  let capturedAuth: string | undefined;
  const fetchImpl = fakeFetch((_url, init) => {
    capturedAuth = (init.headers as Record<string, string>).Authorization;
    return new Response(null, { status: 204 });
  });
  await logout({ ...env, fetchImpl }, "meu-token");
  assertEquals(capturedAuth, "Bearer meu-token");
});

Deno.test("erro não-2xx vira GoTrueApiError com status e corpo", async () => {
  const fetchImpl = fakeFetch(() =>
    jsonResponse(400, { error_code: "invalid_credentials", msg: "..." })
  );
  const err = await assertThrowsAsync(() =>
    signInWithPassword({ ...env, fetchImpl }, { email: "a@b.test", password: "errada" })
  );
  assert(err instanceof GoTrueApiError);
  assertEquals((err as GoTrueApiError).status, 400);
  assertEquals(
    ((err as GoTrueApiError).body as Record<string, unknown>).error_code,
    "invalid_credentials",
  );
});

// --- decodeJwtClaims ------------------------------------------------------

function makeJwt(payload: Record<string, unknown>): string {
  const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  return `${header}.${body}.assinatura-nao-verificada-aqui`;
}

Deno.test("decodeJwtClaims: extrai sub/email/exp de um JWT bem formado", () => {
  const token = makeJwt({
    sub: "user-123",
    email: "a@b.test",
    exp: 1999999999,
    role: "authenticated",
  });
  const claims = decodeJwtClaims(token);
  assertEquals(claims.sub, "user-123");
  assertEquals(claims.email, "a@b.test");
  assertEquals(claims.exp, 1999999999);
});

Deno.test("decodeJwtClaims: lança se o token não tem 3 segmentos", async () => {
  await assertThrowsAsync(() => Promise.resolve(decodeJwtClaims("nao-e-um-jwt")));
});

Deno.test("decodeJwtClaims: lança se faltar 'sub' ou 'exp'", async () => {
  const token = makeJwt({ email: "a@b.test" }); // sem sub/exp
  await assertThrowsAsync(() => Promise.resolve(decodeJwtClaims(token)));
});
