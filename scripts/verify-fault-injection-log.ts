#!/usr/bin/env -S deno run --allow-net --allow-env
// T-063 — Verifica os 15 cenários de injeção de falha (D6, §10.3): 5
// endpoints de escrita × 3 tipos (`timeout`, `malformed`, `offline`).
//
// Complementa `tests/hurl/falhas_15.hurl`, que já prova os 10 cenários
// observáveis por HTTP (`timeout`/`malformed` × 5 endpoints — ver o
// comentário no topo daquele arquivo para o porquê dos outros 5 não
// caberem no Hurl). Este script cobre o que falta:
//
//   1. Dispara os 5 cenários de `offline` de verdade — cada requisição usa
//      um `AbortSignal.timeout` CURTO (`OFFLINE_CLIENT_TIMEOUT_MS`, bem
//      menor que os 150s do teto do runtime de Edge Functions local) e
//      espera que ela nunca receba resposta (confirma "conexão encerrada
//      sem responder", §10.2 — não só confia no design de
//      `gateway.ts::simulateOffline`, testa de verdade).
//   2. Consulta `experiment.fault_injection_log` DIRETO no Postgres (não
//      existe rota HTTP para esse schema — migração 0008/0010, decisão
//      registrada lá) e confere as 15 combinações distintas (endpoint,
//      fault_type) esperadas, cada uma com pelo menos 1 linha.
//
// PRÉ-REQUISITO: rodar `tests/hurl/falhas_15.hurl` (os 10 cenários de
// `timeout`/`malformed`) ANTES deste script — ele não os dispara de novo.
//
// Uso:
//   deno run -A scripts/verify-fault-injection-log.ts
//
// Variáveis de ambiente:
//   SUPABASE_DB_URL       (default: postgresql://postgres:postgres@127.0.0.1:54322/postgres)
//   BASE_URL              (default: http://127.0.0.1:54321/functions/v1)
//   TEST_ACCOUNT_PASSWORD (default: Cerne-Teste-2026!, ver supabase/seed/ancora.md)
//   TEST_FAULT_KEY        (obrigatório — mesmo valor do ambiente/.env.local)

import postgres from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const BASE_URL = Deno.env.get("BASE_URL") ?? "http://127.0.0.1:54321/functions/v1";
const TEST_ACCOUNT_PASSWORD = Deno.env.get("TEST_ACCOUNT_PASSWORD") ?? "Cerne-Teste-2026!";
const TEST_FAULT_KEY = Deno.env.get("TEST_FAULT_KEY");

/** Bem abaixo do teto de 150s do runtime local — só precisa confirmar que nada volta. */
const OFFLINE_CLIENT_TIMEOUT_MS = 5_000;

// Os 5 endpoints congelados (§10.3) — `endpoint` aqui é o `contract.path`
// literal que `gateway.ts` grava em `fault_injection_log` (T-029), não a
// URL da função (`{{base_url}}/entries-create` vira `/entries`, etc.).
interface FaultTarget {
  readonly endpoint: string;
  readonly build: (
    ctx: { accessToken: string; sessionId: string },
  ) => { path: string; body: unknown };
}

const TARGETS: readonly FaultTarget[] = [
  {
    endpoint: "/entries",
    build: () => ({
      path: "/entries-create",
      body: {
        content: "conteúdo irrelevante (offline nunca chega na validação)",
        source: "manual",
      },
    }),
  },
  {
    endpoint: "/chat/sessions/:id/messages",
    build: (ctx) => ({
      path: `/chat-messages-send/${ctx.sessionId}`,
      body: { content: "mensagem irrelevante" },
    }),
  },
  {
    endpoint: "/media/ocr",
    build: () => ({
      path: "/media-ocr",
      body: { image: "aWdub3JhZG8=", mimeType: "image/png" },
    }),
  },
  {
    endpoint: "/export/summary",
    build: () => ({
      path: "/export-summary-create",
      body: { periodStart: null, periodEnd: null, includeNarrative: false },
    }),
  },
  {
    endpoint: "/chat/sessions/:id/insight",
    build: (ctx) => ({
      path: `/chat-insight-create/${ctx.sessionId}`,
      body: { triggerType: "message_count", triggerKey: "fault-offline" },
    }),
  },
];

async function login(): Promise<string> {
  const res = await fetch(`${BASE_URL}/auth-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "cenario-cheio@cerne.test", password: TEST_ACCOUNT_PASSWORD }),
  });
  if (!res.ok) throw new Error(`login falhou: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return body.data.session.accessToken as string;
}

async function createSession(accessToken: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/chat-sessions-create`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`criar sessão falhou: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return body.data.id as string;
}

/** `true` = confirmado que nenhuma resposta chegou (o esperado para `offline`). */
async function fireOffline(
  target: FaultTarget,
  accessToken: string,
  sessionId: string,
): Promise<boolean> {
  const { path, body } = target.build({ accessToken, sessionId });
  try {
    await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-Test-Key": TEST_FAULT_KEY!,
        "X-Test-Fault": "offline",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(OFFLINE_CLIENT_TIMEOUT_MS),
    });
    // Se chegou aqui, uma resposta de verdade voltou — não é o esperado
    // para `offline` (bug real ou X-Test-Key errado, ver mensagem abaixo).
    return false;
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
    if (!isTimeout) throw err; // outro erro (rede, DNS, ...) não prova nada — propaga
    return true;
  }
}

async function main() {
  if (!TEST_FAULT_KEY) {
    console.error(
      "Falta TEST_FAULT_KEY no ambiente — sem ele X-Test-Fault é ignorado em silêncio (§10.1).",
    );
    Deno.exit(1);
  }

  console.log("Autenticando...");
  const accessToken = await login();
  const sessionId = await createSession(accessToken);

  console.log(
    `\nDisparando os 5 cenários de 'offline' (até ${OFFLINE_CLIENT_TIMEOUT_MS}ms de espera cada)...`,
  );
  let offlineOk = true;
  for (const target of TARGETS) {
    const confirmed = await fireOffline(target, accessToken, sessionId);
    console.log(`  ${confirmed ? "✅" : "❌"} ${target.endpoint}`);
    if (!confirmed) offlineOk = false;
  }
  if (!offlineOk) {
    console.error(
      "\nAlgum endpoint respondeu a uma requisição 'offline' — não deveria (ver §10.2/gateway.ts). Abortando antes de checar o log.",
    );
    Deno.exit(1);
  }

  console.log(
    `\nConferindo experiment.fault_injection_log em ${DB_URL.replace(/:[^:@]*@/, ":***@")}...`,
  );
  const sql = postgres(DB_URL);
  try {
    const rows = await sql<{ endpoint: string; fault_type: string; count: string }[]>`
      select endpoint, fault_type, count(*)::text as count
      from experiment.fault_injection_log
      where fault_type in ('timeout', 'malformed', 'offline')
      group by endpoint, fault_type
      order by endpoint, fault_type
    `;

    const found = new Set(rows.map((r) => `${r.endpoint}::${r.fault_type}`));
    const expectedEndpoints = TARGETS.map((t) => t.endpoint);
    const expectedTypes = ["timeout", "malformed", "offline"] as const;

    let missing = 0;
    for (const endpoint of expectedEndpoints) {
      for (const type of expectedTypes) {
        const key = `${endpoint}::${type}`;
        const ok = found.has(key);
        console.log(`  ${ok ? "✅" : "❌"} ${endpoint} / ${type}`);
        if (!ok) missing++;
      }
    }

    console.log(
      `\n${
        expectedEndpoints.length * expectedTypes.length - missing
      }/15 cenários confirmados no log.`,
    );
    if (missing > 0) {
      console.error(
        `Faltam ${missing}. Rodou tests/hurl/falhas_15.hurl (timeout/malformed) antes deste script?`,
      );
      Deno.exit(1);
    }
    console.log("✅ T-063: 15 cenários distintos confirmados em fault_injection_log.");
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  await main();
}
