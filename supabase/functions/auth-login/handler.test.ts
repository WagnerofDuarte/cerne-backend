// Teste do handler `auth-login` (T-034).

import { assert, assertEquals, assertThrowsAsync } from "../_shared/_test_utils.ts";
import type { GatewayContext } from "../_shared/gateway.ts";
import { CerneError } from "../_shared/errors.ts";
import { handleLogin, type LoginBody } from "./handler.ts";

const env = { supabaseUrl: "https://example.test", supabaseAnonKey: "anon-key" };

function ctxFor(body: LoginBody): GatewayContext<LoginBody> {
  return {
    req: new Request("https://example.test/auth/login", { method: "POST" }),
    requestId: "req-1",
    now: new Date("2026-09-10T00:00:00Z"),
    params: {},
    body,
    query: undefined,
    auth: null,
    fault: null,
  };
}

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    )) as typeof fetch;
}

Deno.test("login bem-sucedido: devolve session + user separados, em camelCase", async () => {
  const fetchImpl = fakeFetch(200, {
    access_token: "at",
    refresh_token: "rt",
    expires_in: 3600,
    expires_at: 1999999999,
    token_type: "bearer",
    user: { id: "u1", email: "a@b.test" },
  });
  const result = await handleLogin(ctxFor({ email: "a@b.test", password: "senha123" }), {
    ...env,
    fetchImpl,
  });
  assertEquals(result.status, 200);
  const data = result.envelope.data as { session: unknown; user: unknown };
  assertEquals(data.user, { id: "u1", email: "a@b.test" });
  assertEquals((data.session as Record<string, unknown>).accessToken, "at");
});

Deno.test("credenciais erradas → AUTH_INVALID (401), nunca AUTH_EXPIRED", async () => {
  const fetchImpl = fakeFetch(400, {
    error_code: "invalid_credentials",
    msg: "Invalid login credentials",
  });
  const err = await assertThrowsAsync(() =>
    handleLogin(ctxFor({ email: "a@b.test", password: "errada" }), { ...env, fetchImpl })
  );
  assert(err instanceof CerneError);
  assertEquals((err as CerneError).code, "AUTH_INVALID");
  assertEquals((err as CerneError).http, 401);
});
