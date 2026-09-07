// Teste do módulo `profiles-repo` (gap-fill da Fase 3, estendido na Fase 4).

import { assertEquals, assertThrowsAsync } from "./_test_utils.ts";
import type { DbClient } from "./db.ts";
import { CerneError } from "./errors.ts";
import { fetchPersona, fetchServerRevision } from "./profiles-repo.ts";

function fakeDb(result: { data: unknown; error: unknown }): DbClient {
  return {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_c: string, _v: unknown) => ({
          single: () => Promise.resolve(result),
        }),
      }),
    }),
  } as unknown as DbClient;
}

Deno.test("fetchServerRevision: devolve o número de profiles.server_revision", async () => {
  const db = fakeDb({ data: { server_revision: 7 }, error: null });
  assertEquals(await fetchServerRevision(db, "u1"), 7);
});

Deno.test("fetchServerRevision: perfil ausente -> NOT_FOUND (caminho defensivo)", async () => {
  const db = fakeDb({ data: null, error: null });
  const err = await assertThrowsAsync(() => fetchServerRevision(db, "u1"));
  assertEquals((err as CerneError).code, "NOT_FOUND");
});

Deno.test("fetchPersona: devolve a persona atual do perfil", async () => {
  const db = fakeDb({ data: { persona: "socratico" }, error: null });
  assertEquals(await fetchPersona(db, "u1"), "socratico");
});

Deno.test("fetchPersona: perfil ausente -> NOT_FOUND (caminho defensivo)", async () => {
  const db = fakeDb({ data: null, error: null });
  const err = await assertThrowsAsync(() => fetchPersona(db, "u1"));
  assertEquals((err as CerneError).code, "NOT_FOUND");
});
