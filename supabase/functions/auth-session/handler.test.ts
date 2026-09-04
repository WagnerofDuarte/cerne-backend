// Teste do handler `auth-session` (T-034).

import { assert, assertEquals, assertThrowsAsync } from "../_shared/_test_utils.ts";
import type { AuthContext, GatewayContext } from "../_shared/gateway.ts";
import type { DbClient } from "../_shared/db.ts";
import { CerneError } from "../_shared/errors.ts";
import { handleGetSession } from "./handler.ts";

function makeJwt(payload: Record<string, unknown>): string {
  const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  return `${header}.${body}.assinatura-nao-verificada-aqui`;
}

function fakeDb(profile: { server_revision: number } | null, error: unknown = null): DbClient {
  return {
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _val: string) {
              return { single: () => Promise.resolve({ data: profile, error }) };
            },
          };
        },
      };
    },
  } as unknown as DbClient;
}

function ctxWithAuth(auth: AuthContext): GatewayContext {
  return {
    req: new Request("https://example.test/auth/session"),
    requestId: "req-1",
    now: new Date("2026-09-10T00:00:00Z"),
    params: {},
    body: undefined,
    query: undefined,
    auth,
    fault: null,
  };
}

Deno.test("devolve user (do JWT), expiresAt (do JWT) e serverRevision (do banco)", async () => {
  const token = makeJwt({ sub: "user-1", email: "a@b.test", exp: 1999999999 });
  const ctx = ctxWithAuth({
    userId: "user-1",
    accessToken: token,
    db: fakeDb({ server_revision: 42 }),
  });
  const result = await handleGetSession(ctx);
  assertEquals(result.status, 200);
  assertEquals(result.envelope.data, {
    user: { id: "user-1", email: "a@b.test" },
    expiresAt: 1999999999,
    serverRevision: 42,
  });
});

Deno.test("perfil ausente (caminho defensivo) → NOT_FOUND", async () => {
  const token = makeJwt({ sub: "user-1", email: "a@b.test", exp: 1999999999 });
  const ctx = ctxWithAuth({ userId: "user-1", accessToken: token, db: fakeDb(null) });
  const err = await assertThrowsAsync(() => handleGetSession(ctx));
  assert(err instanceof CerneError);
  assertEquals((err as CerneError).code, "NOT_FOUND");
});
