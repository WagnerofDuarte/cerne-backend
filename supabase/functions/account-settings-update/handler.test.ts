// Teste do handler `account-settings-update` (T-058).
// "Campo email presente -> VALIDATION_ERROR" já é coberto no nível do Zod
// (.strict() em contracts/zod/account.ts) — este arquivo cobre a lógica do
// handler em si: monta o UPDATE só com os campos enviados, devolve o
// perfil atualizado.

import { assert, assertEquals } from "../_shared/_test_utils.ts";
import type { DbClient } from "../_shared/db.ts";
import type { AuthContext, GatewayContext } from "../_shared/gateway.ts";
import { handleUpdateAccountSettings, type UpdateAccountSettingsBody } from "./handler.ts";

function ctxFor(
  body: UpdateAccountSettingsBody,
  auth: AuthContext,
): GatewayContext<UpdateAccountSettingsBody, undefined> {
  return {
    req: new Request("https://example.test/account-settings-update", { method: "PATCH" }),
    requestId: "req-1",
    now: new Date("2026-09-10T12:00:00Z"),
    params: {},
    body,
    query: undefined,
    auth,
    fault: null,
  };
}

const PROFILE_ROW = {
  id: "user-1",
  email: "user@cerne.test",
  display_name: "Nome Antigo",
  biometric_enabled: false,
  persona: "empatico",
  server_revision: 5,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function fakeDb(
  opts: { updateError?: unknown; selectData?: Record<string, unknown> | null } = {},
): { db: DbClient; updateCalls: Array<Record<string, unknown>> } {
  const updateCalls: Array<Record<string, unknown>> = [];
  const db = {
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        updateCalls.push(patch);
        return { eq: () => Promise.resolve({ error: opts.updateError ?? null }) };
      },
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: opts.selectData ?? { ...PROFILE_ROW }, error: null }),
        }),
      }),
    }),
  } as unknown as DbClient;
  return { db, updateCalls };
}

Deno.test("body vazio: não chama UPDATE, só devolve o perfil atual", async () => {
  const { db, updateCalls } = fakeDb();
  const result = await handleUpdateAccountSettings(
    ctxFor({}, { userId: "user-1", accessToken: "t", db }),
  );
  assertEquals(updateCalls, []);
  assertEquals(result.status, 200);
  assertEquals((result.envelope.data as Record<string, unknown>).displayName, "Nome Antigo");
});

Deno.test("displayName + persona: UPDATE em snake_case, mais updated_at = ctx.now", async () => {
  const { db, updateCalls } = fakeDb();
  await handleUpdateAccountSettings(
    ctxFor(
      { displayName: "Nome Novo", persona: "analitico" },
      { userId: "user-1", accessToken: "t", db },
    ),
  );
  assertEquals(updateCalls, [
    {
      display_name: "Nome Novo",
      persona: "analitico",
      updated_at: "2026-09-10T12:00:00.000Z",
    },
  ]);
});

Deno.test("biometricEnabled sozinho vira biometric_enabled", async () => {
  const { db, updateCalls } = fakeDb();
  await handleUpdateAccountSettings(
    ctxFor({ biometricEnabled: true }, { userId: "user-1", accessToken: "t", db }),
  );
  assertEquals(updateCalls[0]?.biometric_enabled, true);
});

Deno.test("devolve o perfil em camelCase (id/email/displayName/persona/biometricEnabled/serverRevision)", async () => {
  const { db } = fakeDb();
  const result = await handleUpdateAccountSettings(
    ctxFor({ displayName: "X" }, { userId: "user-1", accessToken: "t", db }),
  );
  assertEquals(result.envelope.data, {
    id: "user-1",
    email: "user@cerne.test",
    displayName: "Nome Antigo",
    biometricEnabled: false,
    persona: "empatico",
    serverRevision: 5,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
});

Deno.test("erro do UPDATE propaga (vira 500 genérico no gateway, fora da taxonomia)", async () => {
  const { db } = fakeDb({ updateError: new Error("boom") });
  let threw = false;
  try {
    await handleUpdateAccountSettings(
      ctxFor({ displayName: "X" }, { userId: "user-1", accessToken: "t", db }),
    );
  } catch {
    threw = true;
  }
  assert(threw);
});
