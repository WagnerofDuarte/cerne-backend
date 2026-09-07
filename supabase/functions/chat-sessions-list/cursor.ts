// T-045 — Cursor de paginação de `GET /chat/sessions`.
//
// Mesmo desenho do cursor de `GET /entries` (`entries-list/cursor.ts`,
// T-038): keyset opaco (base64url de um JSON pequeno), posição exata
// (`updatedAt`, `id`) da última linha da página anterior, na mesma
// ordenação da consulta (`updated_at DESC, id ASC`, §8.3).

import type { ChatSessionsCursor } from "../_shared/chat-repo.ts";
import { throwError } from "../_shared/errors.ts";

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

export function encodeCursor(cursor: ChatSessionsCursor): string {
  return base64UrlEncode(JSON.stringify({ u: cursor.updatedAt, i: cursor.id }));
}

/** `VALIDATION_ERROR` para qualquer cursor que não decodifique — nunca um 500 por um cursor adulterado ou de uma versão antiga do app. */
export function decodeCursor(raw: string): ChatSessionsCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(base64UrlDecode(raw));
  } catch {
    throwError("VALIDATION_ERROR", "cursor inválido");
  }
  const obj = parsed as { u?: unknown; i?: unknown };
  if (typeof obj.u !== "string" || typeof obj.i !== "string") {
    throwError("VALIDATION_ERROR", "cursor inválido");
  }
  return { updatedAt: obj.u, id: obj.i };
}
