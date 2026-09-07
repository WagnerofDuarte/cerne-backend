// T-038 — Cursor de paginação de `GET /entries`.
//
// Paginação por keyset, não por OFFSET (Seção 3.5: determinismo) — o
// cursor é a posição exata (`occurredAt`, `id`) da última linha da página
// anterior, na mesma ordenação que a consulta usa (`occurred_at DESC, id
// ASC`, Seção 8.2). Opaco de propósito (base64url de um JSON pequeno) —
// o cliente nunca deveria interpretar o conteúdo, só devolvê-lo como veio.

import { throwError } from "../_shared/errors.ts";
import type { EntriesCursor } from "../_shared/entries-repo.ts";

function base64UrlEncode(raw: string): string {
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(encoded: string): string {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    encoded.length + ((4 - (encoded.length % 4)) % 4),
    "=",
  );
  return atob(padded);
}

export function encodeCursor(cursor: EntriesCursor): string {
  return base64UrlEncode(JSON.stringify({ o: cursor.occurredAt, i: cursor.id }));
}

/** `VALIDATION_ERROR` para qualquer cursor que não decodifique — nunca um 500 por um cursor adulterado ou de uma versão antiga do app. */
export function decodeCursor(raw: string): EntriesCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(base64UrlDecode(raw));
  } catch {
    throwError("VALIDATION_ERROR", "cursor inválido");
  }
  const obj = parsed as { o?: unknown; i?: unknown };
  if (typeof obj.o !== "string" || typeof obj.i !== "string") {
    throwError("VALIDATION_ERROR", "cursor inválido");
  }
  return { occurredAt: obj.o, id: obj.i };
}
