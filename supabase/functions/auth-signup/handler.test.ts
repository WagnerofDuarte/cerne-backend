// Teste do handler `auth-signup` (T-034).

import { assert, assertEquals, assertThrowsAsync } from "../_shared/_test_utils.ts";
import type { GatewayContext } from "../_shared/gateway.ts";
import { CerneError } from "../_shared/errors.ts";
import { handleSignup, type SignupBody } from "./handler.ts";

const env = { supabaseUrl: "https://example.test", supabaseAnonKey: "anon-key" };

function ctxFor(body: SignupBody): GatewayContext<SignupBody> {
  return {
    req: new Request("https://example.test/auth/signup", { method: "POST" }),
    requestId: "req-1",
    now: new Date("2026-09-10T00:00:00Z"),
    params: {},
    body,
    query: undefined,
    auth: null,
    fault: null,
  };
}

function fakeFetch(handler: (init: RequestInit) => Response): typeof fetch {
  return ((_url: string | URL, init?: RequestInit) =>
    Promise.resolve(handler(init ?? {}))) as typeof fetch;
}

Deno.test("signup bem-sucedido: devolve session + user separados, em camelCase", async () => {
  const fetchImpl = fakeFetch(() =>
    new Response(
      JSON.stringify({
        access_token: "at",
        refresh_token: "rt",
        expires_in: 3600,
        expires_at: 1999999999,
        token_type: "bearer",
        user: { id: "u1", email: "a@b.test" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )
  );
  const result = await handleSignup(ctxFor({ email: "a@b.test", password: "senha123" }), {
    ...env,
    fetchImpl,
  });
  assertEquals(result.status, 200);
  const data = result.envelope.data as { session: unknown; user: unknown };
  assertEquals(data.session, {
    accessToken: "at",
    refreshToken: "rt",
    expiresIn: 3600,
    expiresAt: 1999999999,
    tokenType: "bearer",
  });
  assertEquals(data.user, { id: "u1", email: "a@b.test" });
});

Deno.test("GoTrue rejeita (ex.: e-mail já cadastrado) → AUTH_INVALID", async () => {
  const fetchImpl = fakeFetch(() =>
    new Response(JSON.stringify({ error_code: "user_already_exists", msg: "e-mail já em uso" }), {
      status: 422,
      headers: { "Content-Type": "application/json" },
    })
  );
  const err = await assertThrowsAsync(() =>
    handleSignup(ctxFor({ email: "a@b.test", password: "senha123" }), { ...env, fetchImpl })
  );
  assert(err instanceof CerneError);
  assertEquals((err as CerneError).code, "AUTH_INVALID");
});

Deno.test("resposta sem access_token (confirmação de e-mail hipoteticamente ligada) → AUTH_INVALID", async () => {
  const fetchImpl = fakeFetch(() =>
    new Response(JSON.stringify({ id: "u1", email: "a@b.test" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
  const err = await assertThrowsAsync(() =>
    handleSignup(ctxFor({ email: "a@b.test", password: "senha123" }), { ...env, fetchImpl })
  );
  assert(err instanceof CerneError);
  assertEquals((err as CerneError).code, "AUTH_INVALID");
});
