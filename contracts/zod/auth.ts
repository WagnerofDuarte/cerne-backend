// T-026 — Contratos de Autenticação (Plano técnico §8.1, D1).
//
// 4 dos 5 endpoints são "proxy fino do GoTrue" (D1): o servidor não define
// a forma de `session`/`user`, só repassa o que o GoTrue devolve,
// convertido para camelCase. Por isso os dois schemas abaixo são
// propositalmente permissivos (`.catchall`) nos campos que o GoTrue pode
// enviar além do necessário — travar demais aqui quebraria o proxy à toa
// numa mudança de versão do GoTrue.

import { z } from "zod";
import { envelope, uuidSchema } from "./common.ts";

export const authUserSchema = z.object({
  id: uuidSchema,
  email: z.string().email(),
}).catchall(z.unknown());

export const authSessionSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int(),
  expiresAt: z.number().int(),
  tokenType: z.string(),
}).catchall(z.unknown());

export const signupRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});

const sessionAndUserResponseSchema = envelope(
  z.object({ session: authSessionSchema, user: authUserSchema }),
);

export const signupResponseSchema = sessionAndUserResponseSchema;
export const loginResponseSchema = sessionAndUserResponseSchema;

export const refreshResponseSchema = envelope(z.object({ session: authSessionSchema }));

// GET /auth/session — "Único com lógica própria" (§8.1): não é proxy, tem
// serverRevision (de profiles) além do que o GoTrue sabe.
export const getSessionResponseSchema = envelope(
  z.object({
    user: authUserSchema,
    expiresAt: z.number().int(),
    serverRevision: z.number().int().nonnegative(),
  }),
);

export const logoutResponseSchema = envelope(z.object({ ok: z.literal(true) }));
