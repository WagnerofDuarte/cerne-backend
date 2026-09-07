// Teste do módulo `rag` (T-043).
// Critério de conclusão: "mesma pergunta produz sempre os mesmos
// retrievedEntryIds, na mesma ordem".

import { assert, assertEquals, assertThrowsAsync } from "./_test_utils.ts";
import type { DbClient } from "./db.ts";
import { CerneError } from "./errors.ts";
import type { ReplayDeps } from "./replay.ts";
import { RAG_TOP_K, runRag } from "./rag.ts";

const offReplay: ReplayDeps = {
  mode: "off",
  lookup: () => Promise.resolve(null),
  store: () => Promise.resolve(),
};

function fakeVoyageFetch(status: number, body: unknown): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    )) as typeof fetch;
}

function makeDb(
  rpcRows: Array<Record<string, unknown>>,
): { db: DbClient; calls: { rpc: number; lastArgs?: Record<string, unknown> } } {
  const calls: { rpc: number; lastArgs?: Record<string, unknown> } = { rpc: 0 };
  const db = {
    rpc: (_name: string, args: Record<string, unknown>) => {
      calls.rpc++;
      calls.lastArgs = args;
      return Promise.resolve({ data: rpcRows, error: null });
    },
  } as unknown as DbClient;
  return { db, calls };
}

const baseArgs = {
  userMessage: "estou ansioso com a apresentação de amanhã",
  promptVersion: "v1",
  voyageApiKey: "voyage-key",
  replay: offReplay,
};

Deno.test("runRag: chama a RPC com limit=5 e sem filtros de source/data", async () => {
  const { db, calls } = makeDb([]);
  const fetchImpl = fakeVoyageFetch(200, { data: [{ embedding: Array(1024).fill(0.01) }] });
  await runRag({ ...baseArgs, db, fetchImpl });
  assertEquals(calls.rpc, 1);
  assertEquals(calls.lastArgs?.p_limit, RAG_TOP_K);
  assertEquals(calls.lastArgs?.p_source, null);
  assertEquals(calls.lastArgs?.p_date_from, null);
  assertEquals(calls.lastArgs?.p_date_to, null);
});

Deno.test("runRag: devolve as entradas na ordem em que a RPC devolveu (relevância, não alfabética)", async () => {
  const { db } = makeDb([
    { id: "z-mais-relevante", content: "texto 1" },
    { id: "a-menos-relevante", content: "texto 2" },
  ]);
  const fetchImpl = fakeVoyageFetch(200, { data: [{ embedding: Array(1024).fill(0.02) }] });
  const result = await runRag({ ...baseArgs, db, fetchImpl });
  assertEquals(result.retrievedEntries, [
    { id: "z-mais-relevante", content: "texto 1" },
    { id: "a-menos-relevante", content: "texto 2" },
  ]);
});

Deno.test("runRag: mesma pergunta, mesma resposta da RPC -> exatamente os mesmos retrievedEntryIds, na mesma ordem", async () => {
  const rows = [
    { id: "e1", content: "a" },
    { id: "e2", content: "b" },
    { id: "e3", content: "c" },
  ];
  const fetchImpl = fakeVoyageFetch(200, { data: [{ embedding: Array(1024).fill(0.03) }] });

  const { db: db1 } = makeDb(rows);
  const result1 = await runRag({ ...baseArgs, db: db1, fetchImpl });

  const { db: db2 } = makeDb(rows);
  const result2 = await runRag({ ...baseArgs, db: db2, fetchImpl });

  assertEquals(
    result1.retrievedEntries.map((e) => e.id),
    result2.retrievedEntries.map((e) => e.id),
  );
});

Deno.test("runRag: sem resultado nenhum, devolve lista vazia (não é erro)", async () => {
  const { db } = makeDb([]);
  const fetchImpl = fakeVoyageFetch(200, { data: [{ embedding: Array(1024).fill(0.01) }] });
  const result = await runRag({ ...baseArgs, db, fetchImpl });
  assertEquals(result.retrievedEntries, []);
});

Deno.test("runRag: Voyage indisponível -> EMBEDDING_FAILED (502), antes de qualquer stream começar", async () => {
  const { db } = makeDb([]);
  const fetchImpl = fakeVoyageFetch(503, { error: "unavailable" });
  const err = await assertThrowsAsync(() => runRag({ ...baseArgs, db, fetchImpl }));
  assert(err instanceof CerneError);
  assertEquals((err as CerneError).code, "EMBEDDING_FAILED");
  assertEquals((err as CerneError).http, 502);
});
