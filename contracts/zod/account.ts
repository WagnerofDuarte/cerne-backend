// T-026 — Contratos de Conta (Plano técnico §8.6).

import { z } from "zod";
import { envelope, isoDateTimeSchema, personaEnum, uuidSchema } from "./common.ts";

export const profileSchema = z.object({
  id: uuidSchema,
  email: z.string().email(),
  displayName: z.string(),
  persona: personaEnum,
  biometricEnabled: z.boolean(),
  serverRevision: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

// --- PATCH /account/settings --------------------------------------------
//
// `.strict()` é o que implementa "campo `email` presente → VALIDATION_ERROR"
// (§8.6): `email` não faz parte do shape, então qualquer chave fora de
// displayName/persona/biometricEnabled — `email` incluso — já falha o
// parse do Zod. O gateway (T-031) mapeia qualquer falha de parse para
// VALIDATION_ERROR de forma genérica; não é preciso checar `email`
// separadamente no handler.
export const updateAccountSettingsRequestSchema = z
  .object({
    displayName: z.string().min(1).max(80).optional(),
    persona: personaEnum.optional(),
    biometricEnabled: z.boolean().optional(),
  })
  .strict();

export const updateAccountSettingsResponseSchema = envelope(profileSchema);

// --- DELETE /account -----------------------------------------------------

export const deleteAccountRequestSchema = z.object({
  confirmation: z.literal("DELETE"),
});

export const deleteAccountResponseSchema = envelope(z.object({ ok: z.literal(true) }));
