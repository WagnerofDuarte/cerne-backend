// Teste do módulo `worker` (T-054) — orquestração do worker de exportação.
// Anthropic/Storage/replay mockados por injeção de dependência; nenhuma
// chamada real é feita.

import { assert, assertEquals } from "../_shared/_test_utils.ts";
import { EXPORT_NARRATIVE_MAX_TOKENS, processExportJob } from "./worker.ts";

const BASE_JOB = {
  id: "job-1",
  user_id: "user-1",
  period_start: null,
  period_end: null,
  status: "pending",
  narrative_status: "pending",
  entry_count: 2,
  raw_file_path: null,
  pdf_file_path: null,
  error_code: null,
  narrative_error_code: null,
  created_at: "2026-09-10T00:00:00Z",
  updated_at: "2026-09-10T00:00:00Z",
  completed_at: null,
};

const ENTRIES = [
  { id: "e1", occurred_at: "2026-09-01T00:00:00Z", source: "manual", content: "fui ao parque" },
  { id: "e2", occurred_at: "2026-09-02T00:00:00Z", source: "audio", content: "dormi cedo" },
];

interface FakeClientOpts {
  job?: Record<string, unknown> | null;
  entries?: Array<Record<string, unknown>>;
  uploadError?: unknown;
  forcedFault?: string;
}

function fakeClient(opts: FakeClientOpts) {
  const updatePatches: Array<Record<string, unknown>> = [];
  const uploads: Array<{ path: string }> = [];
  // `opts.job` pode ser `null` DE PROPÓSITO (simula "job não encontrado") —
  // `??` trataria isso como "não informado" e cairia no BASE_JOB por
  // engano, então a distinção é feita com `"job" in opts`.
  const jobResult = "job" in opts ? opts.job : BASE_JOB;

  const client = {
    from: (table: string) => {
      if (table === "export_jobs") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: jobResult, error: null }) }),
          }),
          update: (patch: Record<string, unknown>) => {
            updatePatches.push(patch);
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      // entries — o handler sempre encadeia .order(...).order(...) depois
      // do(s) filtro(s), independente de período (ver `fetchEntriesForExport`).
      const entriesBuilder = {
        eq: () => entriesBuilder,
        gte: () => entriesBuilder,
        lt: () => entriesBuilder,
        order: () => entriesBuilder,
        then: (resolve: (r: { data: unknown; error: null }) => void) =>
          resolve({ data: opts.entries ?? ENTRIES, error: null }),
      };
      return { select: () => entriesBuilder };
    },
    storage: {
      from: () => ({
        upload: (path: string, _bytes: Uint8Array, _o: unknown) => {
          uploads.push({ path });
          if (opts.uploadError && path.endsWith("raw.json")) {
            return Promise.resolve({ error: opts.uploadError });
          }
          return Promise.resolve({ error: null });
        },
      }),
    },
    rpc: (name: string, _args: unknown) => {
      // cache de replay sempre miss neste teste — cada chamada de teste que
      // precisa de hit real sobrescreve isto (nenhuma precisa, por ora).
      if (name === "experiment_replay_cache_lookup") {
        return Promise.resolve({ data: [], error: null });
      }
      if (name === "export_get_fault") {
        return Promise.resolve({ data: opts.forcedFault ?? null, error: null });
      }
      return Promise.resolve({ error: null });
    },
    // deno-lint-ignore no-explicit-any
  } as any;

  return { client, updatePatches, uploads };
}

function fakeAnthropicFetch(text: string): typeof fetch {
  const body = JSON.stringify({
    id: "msg1",
    model: "claude-haiku-4-5-20251001",
    content: [{ type: "text", text }],
  });
  return (() =>
    Promise.resolve(
      new Response(body, { status: 200, headers: { "Content-Type": "application/json" } }),
    )) as typeof fetch;
}

function fakeFailingFetch(): typeof fetch {
  const body = JSON.stringify({ error: "boom" });
  return (() => Promise.resolve(new Response(body, { status: 500 }))) as typeof fetch;
}

Deno.test("job inexistente: não faz nada (sem lançar, sem update)", async () => {
  const { client, updatePatches } = fakeClient({ job: null });
  await processExportJob("job-x", {
    client,
    anthropicApiKey: "k",
    promptVersion: "v1",
    replayMode: "off",
    fetchImpl: fakeAnthropicFetch("x"),
  });
  assertEquals(updatePatches, []);
});

Deno.test("caminho feliz com narrativa: grava bruto, marca data_ready, gera PDF, marca done", async () => {
  const { client, updatePatches, uploads } = fakeClient({});
  await processExportJob("job-1", {
    client,
    anthropicApiKey: "k",
    promptVersion: "v1",
    replayMode: "off",
    fetchImpl: fakeAnthropicFetch("Você teve uma semana tranquila."),
    nowIso: () => "2026-09-10T12:00:00.000Z",
  });

  assertEquals(uploads.map((u) => u.path), ["user-1/job-1/raw.json", "user-1/job-1/summary.pdf"]);
  assertEquals(updatePatches[0], { status: "processing" });
  assertEquals(updatePatches[1], { status: "data_ready", raw_file_path: "user-1/job-1/raw.json" });
  assertEquals(updatePatches[2], {
    status: "done",
    narrative_status: "done",
    pdf_file_path: "user-1/job-1/summary.pdf",
    completed_at: "2026-09-10T12:00:00.000Z",
  });
});

Deno.test("narrative_status='skipped': nunca chama Anthropic, marca done direto depois do bruto", async () => {
  let fetchCalled = false;
  const spyFetch: typeof fetch = (...args) => {
    fetchCalled = true;
    return fakeAnthropicFetch("x")(...args);
  };
  const { client, updatePatches } = fakeClient({
    job: { ...BASE_JOB, narrative_status: "skipped" },
  });
  await processExportJob("job-1", {
    client,
    anthropicApiKey: "k",
    promptVersion: "v1",
    replayMode: "off",
    fetchImpl: spyFetch,
    nowIso: () => "2026-09-10T12:00:00.000Z",
  });
  assert(!fetchCalled, "narrativa pulada nunca deveria chamar a Anthropic");
  assertEquals(updatePatches[updatePatches.length - 1], {
    status: "done",
    completed_at: "2026-09-10T12:00:00.000Z",
  });
});

Deno.test("narrativa falha: narrative_status='failed', status permanece 'data_ready' (§8.4, literal)", async () => {
  const { client, updatePatches } = fakeClient({});
  await processExportJob("job-1", {
    client,
    anthropicApiKey: "k",
    promptVersion: "v1",
    replayMode: "off",
    fetchImpl: fakeFailingFetch(),
    nowIso: () => "2026-09-10T12:00:00.000Z",
  });
  const last = updatePatches[updatePatches.length - 1];
  assertEquals(last, {
    narrative_status: "failed",
    narrative_error_code: "AI_GENERATION_TIMEOUT",
    completed_at: "2026-09-10T12:00:00.000Z",
  });
  // o penúltimo update (data_ready) nunca é revertido — bruto continua disponível.
  assertEquals(updatePatches[1], { status: "data_ready", raw_file_path: "user-1/job-1/raw.json" });
});

Deno.test("ai_timeout marcado por export-summary-create (export_get_fault): força a falha sem chamar a Anthropic (migração 0018)", async () => {
  let fetchCalled = false;
  const spyFetch: typeof fetch = (...args) => {
    fetchCalled = true;
    return fakeAnthropicFetch("nunca deveria chegar aqui")(...args);
  };
  const { client, updatePatches } = fakeClient({ forcedFault: "ai_timeout" });
  await processExportJob("job-1", {
    client,
    anthropicApiKey: "k",
    promptVersion: "v1",
    replayMode: "off",
    fetchImpl: spyFetch,
    nowIso: () => "2026-09-10T12:00:00.000Z",
  });
  assert(!fetchCalled, "ai_timeout marcado deveria falhar sem bater na rede");
  assertEquals(updatePatches[updatePatches.length - 1], {
    narrative_status: "failed",
    narrative_error_code: "AI_GENERATION_TIMEOUT",
    completed_at: "2026-09-10T12:00:00.000Z",
  });
});

Deno.test("upload do bruto falha: job vira 'error', narrativa nem é tentada", async () => {
  let fetchCalled = false;
  const spyFetch: typeof fetch = (...args) => {
    fetchCalled = true;
    return fakeAnthropicFetch("x")(...args);
  };
  const { client, updatePatches } = fakeClient({ uploadError: new Error("storage indisponível") });
  await processExportJob("job-1", {
    client,
    anthropicApiKey: "k",
    promptVersion: "v1",
    replayMode: "off",
    fetchImpl: spyFetch,
    nowIso: () => "2026-09-10T12:00:00.000Z",
  });
  assert(!fetchCalled, "sem o bruto gravado, a narrativa nunca deveria ser tentada");
  assertEquals(updatePatches[updatePatches.length - 1], {
    status: "error",
    completed_at: "2026-09-10T12:00:00.000Z",
  });
});

Deno.test("EXPORT_NARRATIVE_MAX_TOKENS é um valor positivo razoável (documentado, não zero)", () => {
  assert(EXPORT_NARRATIVE_MAX_TOKENS > 0);
});
