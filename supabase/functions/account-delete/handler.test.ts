// Teste do handler `account-delete` (T-059).
// A cascata em si (profiles -> entries/tags/.../export_jobs, via `auth.users`)
// já está provada em `supabase/tests/account_delete_rpc.sql` (pgTAP) — este
// arquivo cobre só a orquestração do handler: purga do bucket antes da RPC,
// e a purga nunca bloqueia a exclusão mesmo se falhar (ver nota em handler.ts).

import { assert, assertEquals } from "../_shared/_test_utils.ts";
import type { DbClient } from "../_shared/db.ts";
import type { AuthContext, GatewayContext } from "../_shared/gateway.ts";
import { handleDeleteAccount } from "./handler.ts";

function ctxFor(auth: AuthContext): GatewayContext<{ confirmation: "DELETE" }, undefined> {
  return {
    req: new Request("https://example.test/account-delete", { method: "DELETE" }),
    requestId: "req-1",
    now: new Date("2026-09-10T00:00:00Z"),
    params: {},
    body: { confirmation: "DELETE" },
    query: undefined,
    auth,
    fault: null,
  };
}

interface FakeDbState {
  removedPaths?: string[];
  rpcCalled: boolean;
}

function fakeDb(opts: {
  jobFolders?: Array<{ name: string }> | null;
  filesByFolder?: Record<string, Array<{ name: string }>>;
  listError?: boolean;
  rpcError?: unknown;
}): { db: DbClient; state: FakeDbState } {
  const state: FakeDbState = { rpcCalled: false };
  const db = {
    storage: {
      from: () => ({
        list: (path: string) => {
          if (opts.listError) throw new Error("storage indisponível");
          if (!path.includes("/")) {
            // listagem de topo (prefixo = userId) — devolve as "pastas" de job.
            return Promise.resolve({ data: opts.jobFolders ?? [], error: null });
          }
          const folder = path.split("/")[1]!;
          return Promise.resolve({ data: opts.filesByFolder?.[folder] ?? [], error: null });
        },
        remove: (paths: string[]) => {
          state.removedPaths = paths;
          return Promise.resolve({ data: null, error: null });
        },
      }),
    },
    rpc: (name: string) => {
      state.rpcCalled = true;
      return name === "delete_own_account"
        ? Promise.resolve({ error: opts.rpcError ?? null })
        : Promise.resolve({ error: null });
    },
  } as unknown as DbClient;
  return { db, state };
}

Deno.test("sem nenhum arquivo exportado: nunca chama remove(), mas chama a RPC e apaga a conta", async () => {
  const { db } = fakeDb({ jobFolders: [] });
  const result = await handleDeleteAccount(ctxFor({ userId: "user-1", accessToken: "t", db }));
  assertEquals(result.envelope.data, { ok: true });
});

Deno.test("com arquivos em 2 jobs: remove() recebe os caminhos completos dos 2 arquivos", async () => {
  const calls: unknown[] = [];
  const db = {
    storage: {
      from: () => ({
        list: (path: string) => {
          if (path === "user-1") {
            return Promise.resolve({ data: [{ name: "job-1" }, { name: "job-2" }], error: null });
          }
          if (path === "user-1/job-1") {
            return Promise.resolve({
              data: [{ name: "raw.json" }, { name: "summary.pdf" }],
              error: null,
            });
          }
          return Promise.resolve({ data: [{ name: "raw.json" }], error: null });
        },
        remove: (paths: string[]) => {
          calls.push(paths);
          return Promise.resolve({ data: null, error: null });
        },
      }),
    },
    rpc: () => Promise.resolve({ error: null }),
  } as unknown as DbClient;

  await handleDeleteAccount(ctxFor({ userId: "user-1", accessToken: "t", db }));
  assertEquals(calls, [[
    "user-1/job-1/raw.json",
    "user-1/job-1/summary.pdf",
    "user-1/job-2/raw.json",
  ]]);
});

Deno.test("purga falha (Storage indisponível): não bloqueia a exclusão da conta (trade-off documentado)", async () => {
  const { db, state } = fakeDb({ listError: true });
  const result = await handleDeleteAccount(ctxFor({ userId: "user-1", accessToken: "t", db }));
  assertEquals(result.envelope.data, { ok: true });
  assert(
    state.rpcCalled,
    "mesmo com a purga falhando, delete_own_account deveria ter sido chamada",
  );
});

Deno.test("erro da RPC delete_own_account propaga (diferente da purga, este é o passo crítico)", async () => {
  const { db } = fakeDb({ jobFolders: [], rpcError: new Error("boom") });
  let threw = false;
  try {
    await handleDeleteAccount(ctxFor({ userId: "user-1", accessToken: "t", db }));
  } catch {
    threw = true;
  }
  assert(threw, "erro na exclusão de verdade da conta deveria propagar, nunca ser engolido");
});
