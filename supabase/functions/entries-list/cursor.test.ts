// Teste do módulo `cursor` (T-038).

import { assert, assertEquals, assertThrowsAsync } from "../_shared/_test_utils.ts";
import { CerneError } from "../_shared/errors.ts";
import { decodeCursor, encodeCursor } from "./cursor.ts";

Deno.test("ida e volta: decodeCursor(encodeCursor(x)) === x", () => {
  const original = {
    occurredAt: "2026-09-10T12:00:00Z",
    id: "11111111-1111-1111-1111-111111111111",
  };
  const encoded = encodeCursor(original);
  assertEquals(decodeCursor(encoded), original);
});

Deno.test("cursor é opaco (não é o JSON cru, nem tem caracteres problemáticos de URL)", () => {
  const encoded = encodeCursor({ occurredAt: "2026-09-10T12:00:00Z", id: "id-1" });
  assert(!encoded.includes("occurredAt"), "não deveria vazar o JSON legível");
  assert(!/[+/=]/.test(encoded), "base64url não deveria ter +, / ou =");
});

Deno.test("cursor adulterado (não é base64 válido) → VALIDATION_ERROR", async () => {
  const err = await assertThrowsAsync(() => Promise.resolve(decodeCursor("!!!não-é-base64!!!")));
  assert(err instanceof CerneError);
  assertEquals((err as CerneError).code, "VALIDATION_ERROR");
});

Deno.test("cursor decodifica para JSON sem os campos certos → VALIDATION_ERROR", async () => {
  const bogus = btoa(JSON.stringify({ foo: "bar" }));
  const err = await assertThrowsAsync(() => Promise.resolve(decodeCursor(bogus)));
  assert(err instanceof CerneError);
  assertEquals((err as CerneError).code, "VALIDATION_ERROR");
});
