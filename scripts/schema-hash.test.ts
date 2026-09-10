// Teste do hash de schema (T-064, Fase 7).
//
// Só cobre a parte pura (canonicalize/hash/guardrail) com fixtures
// sintéticas — a consulta ao Postgres real (`fetchSchemaSnapshot`) precisa
// de um banco de verdade e é validada por comando, não por `deno test`
// (mesmo padrão de `replay-cache-export.ts`/`backfill-seed-embeddings.ts`:
// só a lógica determinística é testável sem I/O).

import {
  assert,
  assertEquals,
  assertThrowsSync,
} from "../supabase/functions/_shared/_test_utils.ts";
import {
  assertNoApproximateVectorIndexes,
  canonicalize,
  type IndexRow,
  type SchemaSnapshot,
  sha256Hex,
} from "./schema-hash.ts";

function emptySnapshot(overrides: Partial<SchemaSnapshot> = {}): SchemaSnapshot {
  return {
    extensions: [],
    columns: [],
    tableRls: [],
    constraints: [],
    indexes: [],
    triggers: [],
    functions: [],
    policies: [],
    grants: [],
    ...overrides,
  };
}

Deno.test("canonicalize é determinístico: mesmo snapshot produz o mesmo texto sempre", () => {
  const snapshot = emptySnapshot({
    extensions: [{ extname: "vector", extversion: "0.6.0" }],
    columns: [
      {
        table_schema: "public",
        table_name: "entries",
        column_name: "id",
        ordinal_position: 1,
        is_nullable: "NO",
        column_default: "gen_random_uuid()",
        data_type: "uuid",
      },
    ],
  });

  assertEquals(canonicalize(snapshot), canonicalize(snapshot));
});

Deno.test("canonicalize muda se qualquer campo mudar (sensível a diferença real)", () => {
  const a = emptySnapshot({ extensions: [{ extname: "vector", extversion: "0.6.0" }] });
  const b = emptySnapshot({ extensions: [{ extname: "vector", extversion: "0.6.1" }] });

  assert(
    canonicalize(a) !== canonicalize(b),
    "versões de extensão diferentes deveriam gerar texto diferente",
  );
});

Deno.test("canonicalize é insensível a nada além do conteúdo — não injeta timestamp/ruído", () => {
  const snapshot = emptySnapshot();
  const text = canonicalize(snapshot);

  // Todo bloco deve aparecer, mesmo vazio (0 linhas) — confirma que a seção
  // existe e não foi silenciosamente omitida por engano.
  for (
    const titulo of [
      "extensions",
      "tables.columns",
      "tables.rls",
      "constraints",
      "indexes",
      "triggers",
      "functions",
      "policies",
      "grants",
    ]
  ) {
    assert(text.includes(`## ${titulo} (0)`), `esperava a seção "${titulo}" no texto canônico`);
  }
});

Deno.test("sha256Hex de dois textos idênticos bate; de textos diferentes não bate", async () => {
  const h1 = await sha256Hex("abc");
  const h2 = await sha256Hex("abc");
  const h3 = await sha256Hex("abd");

  assertEquals(h1, h2);
  assert(h1 !== h3);
  assertEquals(h1.length, 64, "SHA-256 em hex tem 64 caracteres");
});

Deno.test("hash do snapshot inteiro é determinístico ponta a ponta", async () => {
  const snapshot = emptySnapshot({
    extensions: [{ extname: "pgcrypto", extversion: "1.3" }],
    tableRls: [
      { table_schema: "public", table_name: "entries", rls_enabled: true, rls_forced: true },
    ],
  });

  const h1 = await sha256Hex(canonicalize(snapshot));
  const h2 = await sha256Hex(canonicalize(snapshot));
  assertEquals(h1, h2);
});

function idx(definition: string): IndexRow {
  return { schema_name: "public", table_name: "entries", index_name: "idx_x", definition };
}

Deno.test("assertNoApproximateVectorIndexes não lança para índice B-tree normal", () => {
  assertNoApproximateVectorIndexes([
    idx("CREATE UNIQUE INDEX idx_x ON public.entries USING btree (id)"),
  ]);
});

Deno.test("assertNoApproximateVectorIndexes não lança para índice parcial de idempotência (T-014)", () => {
  assertNoApproximateVectorIndexes([
    idx(
      "CREATE UNIQUE INDEX entries_chat_message_uniq ON public.entries USING btree (user_id, chat_message_id) WHERE (chat_message_id IS NOT NULL)",
    ),
  ]);
});

Deno.test("assertNoApproximateVectorIndexes lança para HNSW (regra inviolável nº7)", () => {
  const err = assertThrowsSync(() =>
    assertNoApproximateVectorIndexes([
      idx("CREATE INDEX idx_x ON public.entries USING hnsw (embedding vector_cosine_ops)"),
    ])
  );
  assert(err instanceof Error);
  assert((err as Error).message.includes("nº7"));
});

Deno.test("assertNoApproximateVectorIndexes lança para IVFFlat (regra inviolável nº7)", () => {
  const err = assertThrowsSync(() =>
    assertNoApproximateVectorIndexes([
      idx("CREATE INDEX idx_x ON public.entries USING ivfflat (embedding vector_cosine_ops)"),
    ])
  );
  assert(err instanceof Error);
});

Deno.test("assertNoApproximateVectorIndexes com lista vazia não lança", () => {
  assertNoApproximateVectorIndexes([]);
});
