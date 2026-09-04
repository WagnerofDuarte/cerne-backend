// Teste do conversor Zod -> JSON Schema (parte do T-033).

import { z } from "zod";
import { assert, assertEquals } from "../../supabase/functions/_shared/_test_utils.ts";
import { zodToJsonSchema } from "./zod-to-json-schema.ts";

Deno.test("tipos primitivos", () => {
  assertEquals(zodToJsonSchema(z.string()), { type: "string" });
  assertEquals(zodToJsonSchema(z.number()), { type: "number" });
  assertEquals(zodToJsonSchema(z.boolean()), { type: "boolean" });
});

Deno.test("string com checks (min/max/uuid/email/datetime)", () => {
  assertEquals(zodToJsonSchema(z.string().min(1).max(80)), {
    type: "string",
    minLength: 1,
    maxLength: 80,
  });
  assertEquals(zodToJsonSchema(z.string().uuid()), { type: "string", format: "uuid" });
  assertEquals(zodToJsonSchema(z.string().email()), { type: "string", format: "email" });
  assertEquals(zodToJsonSchema(z.string().datetime({ offset: true })), {
    type: "string",
    format: "date-time",
  });
});

Deno.test("number inteiro com min/max vira type: integer", () => {
  assertEquals(zodToJsonSchema(z.number().int().min(0).max(50)), {
    type: "integer",
    minimum: 0,
    maximum: 50,
  });
});

Deno.test("enum vira type:string + enum dos valores", () => {
  assertEquals(zodToJsonSchema(z.enum(["a", "b", "c"])), { type: "string", enum: ["a", "b", "c"] });
});

Deno.test("literal vira enum de 1 valor", () => {
  assertEquals(zodToJsonSchema(z.literal("DELETE")), { type: "string", enum: ["DELETE"] });
});

Deno.test("array", () => {
  assertEquals(zodToJsonSchema(z.array(z.string())), {
    type: "array",
    items: { type: "string" },
  });
});

Deno.test("objeto: campo opcional não entra em required, obrigatório entra", () => {
  const schema = z.object({ a: z.string(), b: z.string().optional() });
  const result = zodToJsonSchema(schema);
  assertEquals(result.type, "object");
  assertEquals(result.required, ["a"]);
  assertEquals((result.properties as Record<string, unknown>).b, { type: "string" });
});

Deno.test("objeto com .default() não entra em required (a chave é dispensável)", () => {
  const schema = z.object({ includeNarrative: z.boolean().default(true) });
  const result = zodToJsonSchema(schema);
  assertEquals(result.required, undefined);
  assertEquals((result.properties as Record<string, unknown>).includeNarrative, {
    type: "boolean",
    default: true,
  });
});

Deno.test("nullable vira nullable:true, mas continua obrigatório (precisa vir com valor null explícito)", () => {
  const schema = z.object({ chatMessageId: z.string().uuid().nullable() });
  const result = zodToJsonSchema(schema);
  assertEquals(result.required, ["chatMessageId"]);
  assertEquals((result.properties as Record<string, unknown>).chatMessageId, {
    type: "string",
    format: "uuid",
    nullable: true,
  });
});

Deno.test(".strict() vira additionalProperties: false", () => {
  const schema = z.object({ a: z.string() }).strict();
  assertEquals(zodToJsonSchema(schema).additionalProperties, false);
});

Deno.test(".catchall() vira additionalProperties com a forma do catchall", () => {
  const schema = z.object({ id: z.string() }).catchall(z.unknown());
  assertEquals(zodToJsonSchema(schema).additionalProperties, {});
});

Deno.test(".refine() desenrola para o schema de base (limitação documentada)", () => {
  const schema = z
    .object({ source: z.enum(["a", "b"]), x: z.string().optional() })
    .refine((v) => (v.source === "a") === (v.x !== undefined));
  const result = zodToJsonSchema(schema);
  assertEquals(result.type, "object");
  assert((result.properties as Record<string, unknown>).source !== undefined);
});

Deno.test("record vira object com additionalProperties da forma do valor", () => {
  const schema = z.record(z.unknown());
  assertEquals(zodToJsonSchema(schema), { type: "object", additionalProperties: {} });
});

Deno.test("construtor não suportado lança em vez de inventar um formato genérico", () => {
  let threw = false;
  try {
    zodToJsonSchema(z.union([z.string(), z.number()]));
  } catch {
    threw = true;
  }
  assert(threw);
});
