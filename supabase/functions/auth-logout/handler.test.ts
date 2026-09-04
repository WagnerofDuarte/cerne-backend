// Teste do handler `auth-logout` (T-034).

import { assertEquals } from "../_shared/_test_utils.ts";
import type { AuthContext, GatewayContext } from "../_shared/gateway.ts";
import type { DbClient } from "../_shared/db.ts";
import { handleLogout } from "./handler.ts";

const env = { supabaseUrl: "https://example.test", supabaseAnonKey: "anon-key" };

function ctxWithAuth(auth: AuthContext): GatewayContext {
  return {
    req: new Request("https://example.test/auth/logout", { method: "POST" }),
    requestId: "req-1",
    now: new Date("2026-09-10T00:00:00Z"),
    params: {},
    body: undefined,
    query: undefined,
    auth,
    fault: null,
  };
}

const dummyDb = {} as DbClient;

Deno.test("logout bem-sucedido → { ok: true }", async () => {
  const fetchImpl = (() => Promise.resolve(new Response(null, { status: 204 }))) as typeof fetch;
  const result = await handleLogout(
    ctxWithAuth({ userId: "u1", accessToken: "token-valido", db: dummyDb }),
    { ...env, fetchImpl },
  );
  assertEquals(result.status, 200);
  assertEquals(result.envelope.data, { ok: true });
});

Deno.test("GoTrue falha (ex.: sessão já encerrada) → ainda assim { ok: true }, erro engolido", async () => {
  const fetchImpl = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ msg: "session not found" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    )) as typeof fetch;
  const result = await handleLogout(
    ctxWithAuth({ userId: "u1", accessToken: "token-expirado", db: dummyDb }),
    { ...env, fetchImpl },
  );
  assertEquals(result.status, 200);
  assertEquals(result.envelope.data, { ok: true });
});
