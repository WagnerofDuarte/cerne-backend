// Teste do gerador de documentos do handoff (T-064, Fase 7).

import { assert, assertEquals } from "../supabase/functions/_shared/_test_utils.ts";
import { ERROR_CODES, httpStatusFor, isRetryable } from "../supabase/functions/_shared/errors.ts";
import {
  buildMapaEstadosTelaMd,
  buildPoliticaDefeitoMd,
  buildReadmeMd,
  buildSeloSincronizacaoMd,
  buildTaxonomiaErrosMd,
} from "./gen-handoff-docs.ts";

Deno.test("taxonomia_erros.md lista exatamente os 13 códigos de errors.ts", () => {
  const md = buildTaxonomiaErrosMd(ERROR_CODES);
  for (const code of ERROR_CODES) {
    assert(md.includes(`\`${code}\``), `esperava o código ${code} no documento gerado`);
  }
  assert(md.includes("**13 códigos**"));
});

Deno.test("taxonomia_erros.md reflete o HTTP/retryable real de cada código (nunca redigitado)", () => {
  const md = buildTaxonomiaErrosMd(ERROR_CODES);
  for (const code of ERROR_CODES) {
    const http = httpStatusFor(code);
    const linha = md.split("\n").find((l) => l.includes(`\`${code}\``));
    assert(linha, `esperava uma linha para ${code}`);
    if (http === null) {
      assert(linha.includes("sem resposta HTTP"));
    } else {
      assert(linha.includes(String(http)), `esperava o HTTP ${http} na linha de ${code}`);
    }
    assert(linha.includes(isRetryable(code) ? "| sim |" : "| não |"));
  }
});

Deno.test("taxonomia_erros.md documenta as duas armadilhas (nunca 403, nunca 409)", () => {
  const md = buildTaxonomiaErrosMd(ERROR_CODES);
  assert(md.includes("Nunca `403`"));
  assert(md.includes("Nunca `409`"));
});

Deno.test("mapa_estados_tela.md cobre os 6 estados da tela de exportação (RF05)", () => {
  const md = buildMapaEstadosTelaMd();
  for (const status of ["pendente", "processando", "dados_prontos", "concluído", "erro"]) {
    assert(md.includes(status), `esperava o status "${status}" no mapa de estados`);
  }
});

Deno.test("selo_sincronizacao.md cita os campos reais do contrato (serverRevision/updatedAt)", () => {
  const md = buildSeloSincronizacaoMd();
  assert(md.includes("serverRevision"));
  assert(md.includes("updatedAt"));
  assert(md.includes("Sincronizando"));
  assert(md.includes("Erro de sincronização"));
  assert(md.includes("Sincronizado"));
});

Deno.test("politica_defeito_D16.md cobre as 3 gravidades", () => {
  const md = buildPoliticaDefeitoMd();
  assert(md.includes("Não bloqueante"));
  assert(md.includes("**Bloqueante**"));
  assert(md.includes("Bloqueante descoberto no ciclo B"));
});

Deno.test("README.md do handoff deixa explícito que o código-fonte não vai no pacote", () => {
  const md = buildReadmeMd();
  assert(md.toLowerCase().includes("sem o código-fonte do backend"));
});

Deno.test("todos os geradores são determinísticos (mesma chamada, mesmo texto)", () => {
  assertEquals(buildTaxonomiaErrosMd(ERROR_CODES), buildTaxonomiaErrosMd(ERROR_CODES));
  assertEquals(buildMapaEstadosTelaMd(), buildMapaEstadosTelaMd());
  assertEquals(buildSeloSincronizacaoMd(), buildSeloSincronizacaoMd());
  assertEquals(buildPoliticaDefeitoMd(), buildPoliticaDefeitoMd());
  assertEquals(buildReadmeMd(), buildReadmeMd());
});
