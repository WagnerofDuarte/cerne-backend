// T-033 — Conversor Zod -> JSON Schema, escrito à mão.
//
// Não puxamos uma lib pronta (ex.: `@asteasolutions/zod-to-openapi`) de
// propósito: ela exige anotar cada schema com `.openapi(...)`, o que
// tocaria de volta em todo `contracts/zod/*.ts` (T-026, já revisado e
// testado) só para servir a geração de documentação. Este conversor cobre
// exatamente os construtores Zod usados em `contracts/zod/` — não é um
// conversor Zod->JSON-Schema geral.
//
// Limitação registrada: `.refine(...)` (ex.: o refinamento
// source==='chat'<=>chatMessageId em createEntryRequestSchema) não tem
// representação em JSON Schema puro — a regra é *desenrolada* para o
// schema base, sem o refinamento. O OpenAPI gerado documenta a forma dos
// campos corretamente, mas não essa regra cruzada entre campos; o teste
// de contrato de verdade (Hurl, Fase 3) é quem valida isso na prática.

// deno-lint-ignore no-explicit-any
type AnyZodType = any;

export interface JsonSchema {
  [key: string]: unknown;
}

export function zodToJsonSchema(schema: AnyZodType): JsonSchema {
  const def = schema._def;
  const typeName = def?.typeName;

  switch (typeName) {
    case "ZodObject":
      return objectSchema(schema);
    case "ZodString":
      return stringSchema(def);
    case "ZodNumber":
      return numberSchema(def);
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodEnum":
      return { type: "string", enum: [...def.values] };
    case "ZodLiteral":
      return { type: typeof def.value, enum: [def.value] };
    case "ZodArray":
      return { type: "array", items: zodToJsonSchema(def.type) };
    case "ZodRecord":
      return { type: "object", additionalProperties: zodToJsonSchema(def.valueType) };
    case "ZodOptional":
      return zodToJsonSchema(def.innerType);
    case "ZodNullable":
      return { ...zodToJsonSchema(def.innerType), nullable: true };
    case "ZodDefault":
      return { ...zodToJsonSchema(def.innerType), default: def.defaultValue() };
    case "ZodEffects":
      // .refine(...) — desenrola para o schema de base (ver limitação no
      // cabeçalho do arquivo).
      return zodToJsonSchema(def.schema);
    case "ZodUnknown":
    case "ZodAny":
      return {};
    default:
      throw new Error(
        `zodToJsonSchema: construtor Zod não suportado (${typeName ?? "desconhecido"}) — ` +
          `adicionar um caso novo aqui, não inventar um formato genérico.`,
      );
  }
}

function isOptionalLike(fieldSchema: AnyZodType): boolean {
  const typeName = fieldSchema?._def?.typeName;
  if (typeName === "ZodOptional" || typeName === "ZodDefault") return true;
  // z.string().nullable() sem .optional() ainda é obrigatório no corpo
  // (precisa vir com valor `null` explícito) — só ZodOptional/ZodDefault
  // tornam a chave dispensável.
  return false;
}

function objectSchema(schema: AnyZodType): JsonSchema {
  const def = schema._def;
  const shape: Record<string, AnyZodType> = def.shape();
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const [key, fieldSchema] of Object.entries(shape)) {
    properties[key] = zodToJsonSchema(fieldSchema);
    if (!isOptionalLike(fieldSchema)) required.push(key);
  }

  const result: JsonSchema = { type: "object", properties };
  if (required.length > 0) result.required = required;

  // .strict() -> unknownKeys === "strict"; catchall (ex.: authUserSchema)
  // vira additionalProperties com a forma do catchall em vez de `false`.
  if (def.catchall && def.catchall._def?.typeName !== "ZodNever") {
    result.additionalProperties = zodToJsonSchema(def.catchall);
  } else if (def.unknownKeys === "strict") {
    result.additionalProperties = false;
  }

  return result;
}

function stringSchema(def: AnyZodType): JsonSchema {
  const result: JsonSchema = { type: "string" };
  for (const check of def.checks ?? []) {
    switch (check.kind) {
      case "min":
        result.minLength = check.value;
        break;
      case "max":
        result.maxLength = check.value;
        break;
      case "uuid":
        result.format = "uuid";
        break;
      case "email":
        result.format = "email";
        break;
      case "datetime":
        result.format = "date-time";
        break;
      case "regex":
        result.pattern = check.regex.source;
        break;
    }
  }
  return result;
}

function numberSchema(def: AnyZodType): JsonSchema {
  const result: JsonSchema = { type: "number" };
  for (const check of def.checks ?? []) {
    switch (check.kind) {
      case "int":
        result.type = "integer";
        break;
      case "min":
        result.minimum = check.value;
        break;
      case "max":
        result.maximum = check.value;
        break;
    }
  }
  return result;
}
