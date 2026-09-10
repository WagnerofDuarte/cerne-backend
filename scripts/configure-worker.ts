#!/usr/bin/env -S deno run --allow-net --allow-env
// T-051/T-054 (Fase 5) — Configura `experiment.worker_config` sem depender
// de `psql` estar instalado na máquina de quem roda isto.
//
// Achado real (Wagner, T-062/`run.sh`, macOS): o Mac não vem com o
// cliente `psql` instalado por padrão (diferente do Linux, onde o pacote
// `postgresql-client` costuma já estar presente) — `tests/hurl/README.md`
// e `tests/determinism/run.sh` pediam um `psql -c "insert into ..."` cru,
// que quebra em qualquer máquina sem esse binário. Este script faz o
// mesmo INSERT/UPDATE usando a mesma biblioteca Deno já usada pelos
// outros scripts de banco do projeto (`replay-cache-export/import.ts`) —
// sem depender de nenhum binário externo além do próprio `deno`.
//
// Idempotente: `on conflict (id) do update` — seguro rodar de novo depois
// de qualquer `supabase db reset` (a tabela é um singleton, `id` é sempre
// `true`, migração 0014).
//
// Uso:
//   deno run --allow-net --allow-env scripts/configure-worker.ts
//
// Variáveis de ambiente:
//   SUPABASE_DB_URL      (default: postgresql://postgres:postgres@127.0.0.1:54322/postgres)
//   FUNCTIONS_BASE_URL   (default: http://host.docker.internal:54321/functions/v1 —
//                         ver tests/hurl/README.md, achado real do T-059v:
//                         127.0.0.1 NÃO funciona aqui, pg_net roda dentro
//                         do container do Postgres)
//   EXPORT_WORKER_SECRET (obrigatório — o MESMO valor do supabase/.env.local)

import postgres from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const FUNCTIONS_BASE_URL = Deno.env.get("FUNCTIONS_BASE_URL") ??
  "http://host.docker.internal:54321/functions/v1";
const EXPORT_WORKER_SECRET = Deno.env.get("EXPORT_WORKER_SECRET");

async function main() {
  if (!EXPORT_WORKER_SECRET) {
    console.error(
      "Falta EXPORT_WORKER_SECRET no ambiente — precisa ser o MESMO valor do supabase/.env.local.",
    );
    Deno.exit(1);
  }

  console.log(`Conectando em ${DB_URL.replace(/:[^:@]*@/, ":***@")}...`);
  const sql = postgres(DB_URL);
  try {
    await sql`
      insert into experiment.worker_config (id, functions_base_url, shared_secret)
      values (true, ${FUNCTIONS_BASE_URL}, ${EXPORT_WORKER_SECRET})
      on conflict (id) do update
      set functions_base_url = excluded.functions_base_url,
          shared_secret = excluded.shared_secret
    `;
    console.log(`experiment.worker_config configurado: functions_base_url=${FUNCTIONS_BASE_URL}`);
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  await main();
}
