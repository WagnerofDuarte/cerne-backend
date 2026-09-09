#!/usr/bin/env -S deno run --allow-read
// T-062 — CLI do teste de determinismo: recebe dois diretórios de
// `--report-json` do `hurl` (duas execuções independentes de
// roteiro_validacao.hurl) e decide passa/falha. Chamado por `run.sh`
// depois das duas execuções reais; ver esse arquivo para o fluxo
// completo (db reset -> functions serve -> hurl -> hurl de novo -> aqui).
//
// Uso:
//   deno run --allow-read tests/determinism/compare.ts <dir1> <dir2>
//
// Saída: 0 e "IDÊNTICO" se as duas execuções bateram; 1 e a 1ª linha onde
// divergiram, caso contrário — mensagem pensada para virar o "achado
// real" de uma falha de determinismo, não só um "FAIL" genérico.

import { buildTranscript, diffTranscripts, type HurlFileReport } from "./normalize.ts";

function loadReport(
  dir: string,
): { reports: HurlFileReport[]; readBody: (path: string) => string } {
  const reportPath = `${dir}/report.json`;
  let raw: string;
  try {
    raw = Deno.readTextFileSync(reportPath);
  } catch (err) {
    throw new Error(`não consegui ler ${reportPath}: ${err instanceof Error ? err.message : err}`);
  }
  const reports = JSON.parse(raw) as HurlFileReport[];
  return { reports, readBody: (path: string) => Deno.readTextFileSync(`${dir}/${path}`) };
}

function main() {
  const [dir1, dir2] = Deno.args;
  if (!dir1 || !dir2) {
    console.error("Uso: deno run --allow-read tests/determinism/compare.ts <dir1> <dir2>");
    Deno.exit(2);
  }

  const run1 = loadReport(dir1!);
  const run2 = loadReport(dir2!);

  const t1 = buildTranscript(run1.reports, run1.readBody);
  const t2 = buildTranscript(run2.reports, run2.readBody);

  const result = diffTranscripts(t1, t2);
  if (result.identical) {
    console.log(
      `✅ IDÊNTICO — as duas execuções de roteiro_validacao.hurl produziram o mesmo resultado (${
        t1.split("\n").length
      } linhas normalizadas).`,
    );
    Deno.exit(0);
  }

  console.error(`❌ DIVERGÊNCIA — as duas execuções NÃO são idênticas (não-determinismo real).`);
  console.error(`1ª diferença na linha ${result.firstDifferenceLine}:`);
  console.error(`  execução 1 (${dir1}): ${result.expected}`);
  console.error(`  execução 2 (${dir2}): ${result.actual}`);
  Deno.exit(1);
}

main();
