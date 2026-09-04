// Teste do handler `auth-refresh` (T-034).

import { assert, assertEquals, assertThrowsAsync } from "../_shared/_test_utils.ts";
import type { GatewayContext } from "../_shared/gateway.ts";
import { CerneError } from "../_shared/errors.ts";
import { handleRefresh, type RefreshBody } from "./handler.ts";

const env = { supabaseUrl: "https://example.test", supabaseAnonKey: "anon-key" };

function ctxFor(body: RefreshBody): GatewayContext<RefreshBody> {
  return {
    req: new Request("https://example.test/auth/refresh", { method: "POST" }),
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

Deno.test("refresh bem-sucedido: devolve só session (sem user), em camelCase", async () => {
  const fetchImpl = fakeFetch(200, {
    access_token: "at2",
    refresh_token: "rt2",
    expires_in: 3600,
    expires_at: 1999999999,
    token_type: "bearer",
    user: { id: "u1" },
  });
  const result = await handleRefresh(ctxFor({ refreshToken: "rt-antigo" }), { ...env, fetchImpl });
  assertEquals(result.status, 200);
  const data = result.envelope.data as Record<string, unknown>;
  assert(!("user" in data), "refreshResponseSchema não tem `user`, só `session`");
  assertEquals((data.session as Record<string, unknown>).accessToken, "at2");
});

Deno.test("refresh token inválido/expirado → AUTH_EXPIRED (401)", async () => {
  const fetchImpl = fakeFetch(400, { error_code: "invalid_grant", msg: "Invalid Refresh Token" });
  const err = await assertThrowsAsync(() =>
    handleRefresh(ctxFor({ refreshToken: "rt-velho" }), { ...env, fetchImpl })
  );
  assert(err instanceof CerneError);
  assertEquals((err as CerneError).code, "AUTH_EXPIRED");
});
