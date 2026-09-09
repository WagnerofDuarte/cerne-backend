// Teste do handler `export-download-get` (T-055).

import { assert, assertEquals } from "../_shared/_test_utils.ts";
import type { DbClient } from "../_shared/db.ts";
import { CerneError } from "../_shared/errors.ts";
import type { AuthContext, GatewayContext } from "../_shared/gateway.ts";
import { type DownloadExportQuery, handleDownloadExport } from "./handler.ts";

function ctxFor(
  jobId: string,
  query: DownloadExportQuery,
  auth: AuthContext,
): GatewayContext<undefined, DownloadExportQuery> {
  return {
    req: new Request(`https://example.test/export-download-get/${jobId}`),
    requestId: "req-1",
    now: new Date("2026-09-10T00:00:00Z"),
    params: { jobId },
    body: undefined,
    query,
    auth,
    fault: null,
  };
}

function fakeDb(
  row: Record<string, unknown> | null,
  opts: { signedUrl?: string | null; signError?: unknown } = {},
): { db: DbClient; signedPaths: string[] } {
  const signedPaths: string[] = [];
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: row, error: null }) }),
        }),
      }),
    }),
    storage: {
      from: () => ({
        createSignedUrl: (path: string, _ttl: number) => {
          signedPaths.push(path);
          if (opts.signError) return Promise.resolve({ data: null, error: opts.signError });
          return Promise.resolve({
            data: { signedUrl: opts.signedUrl ?? `https://storage.example.test/${path}` },
            error: null,
          });
        },
      }),
    },
  } as unknown as DbClient;
  return { db, signedPaths };
}

function auth(db: DbClient): AuthContext {
  return { userId: "user-1", accessToken: "t", db };
}

Deno.test("job inexistente ou de outro dono → NOT_FOUND", async () => {
  const { db } = fakeDb(null);
  let threw: unknown;
  try {
    await handleDownloadExport(ctxFor("33333333-3333-3333-3333-333333333333", {}, auth(db)));
  } catch (err) {
    threw = err;
  }
  assert(threw instanceof CerneError);
  assertEquals((threw as CerneError).code, "NOT_FOUND");
});

Deno.test("job ainda não pronto (pending/processing) → NOT_FOUND (lacuna preenchida pragmaticamente, ver handler.ts)", async () => {
  const { db } = fakeDb({
    id: "11111111-1111-1111-1111-111111111111",
    status: "processing",
    pdf_file_path: null,
    raw_file_path: null,
  });
  let threw: unknown;
  try {
    await handleDownloadExport(ctxFor("11111111-1111-1111-1111-111111111111", {}, auth(db)));
  } catch (err) {
    threw = err;
  }
  assert(threw instanceof CerneError);
  assertEquals((threw as CerneError).code, "NOT_FOUND");
});

Deno.test("format=pdf (default) com PDF pronto → assina o caminho do PDF", async () => {
  const { db, signedPaths } = fakeDb({
    id: "11111111-1111-1111-1111-111111111111",
    status: "done",
    pdf_file_path: "user-1/job-1/summary.pdf",
    raw_file_path: "user-1/job-1/raw.json",
  });
  const result = await handleDownloadExport(
    ctxFor("11111111-1111-1111-1111-111111111111", {}, auth(db)),
  );
  assertEquals(result.location, "https://storage.example.test/user-1/job-1/summary.pdf");
  assertEquals(signedPaths, ["user-1/job-1/summary.pdf"]);
});

Deno.test("narrativa falhou (sem PDF) mesmo com status data_ready → cai para o bruto, nunca 4xx/5xx por causa da narrativa (§8.4)", async () => {
  const { db, signedPaths } = fakeDb({
    id: "11111111-1111-1111-1111-111111111111",
    status: "data_ready",
    pdf_file_path: null,
    raw_file_path: "user-1/job-1/raw.json",
  });
  const result = await handleDownloadExport(
    ctxFor("11111111-1111-1111-1111-111111111111", {}, auth(db)),
  );
  assertEquals(result.location, "https://storage.example.test/user-1/job-1/raw.json");
  assertEquals(signedPaths, ["user-1/job-1/raw.json"]);
});

Deno.test("format=raw pega sempre o bruto, mesmo com PDF disponível", async () => {
  const { db, signedPaths } = fakeDb({
    id: "11111111-1111-1111-1111-111111111111",
    status: "done",
    pdf_file_path: "user-1/job-1/summary.pdf",
    raw_file_path: "user-1/job-1/raw.json",
  });
  await handleDownloadExport(
    ctxFor("11111111-1111-1111-1111-111111111111", { format: "raw" }, auth(db)),
  );
  assertEquals(signedPaths, ["user-1/job-1/raw.json"]);
});

Deno.test("falha ao assinar a URL → NOT_FOUND (nunca vaza erro interno de Storage)", async () => {
  const { db } = fakeDb(
    {
      id: "11111111-1111-1111-1111-111111111111",
      status: "done",
      pdf_file_path: "p.pdf",
      raw_file_path: "r.json",
    },
    { signError: new Error("boom") },
  );
  let threw: unknown;
  try {
    await handleDownloadExport(ctxFor("11111111-1111-1111-1111-111111111111", {}, auth(db)));
  } catch (err) {
    threw = err;
  }
  assert(threw instanceof CerneError);
  assertEquals((threw as CerneError).code, "NOT_FOUND");
});
