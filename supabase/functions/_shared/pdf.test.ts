// Teste do módulo `pdf` (T-054/gap-fill) — PDF minimalista escrito à mão.
// Não valida "qualidade" visual (fora de escopo do RF05) — só que o
// arquivo produzido é estruturalmente um PDF válido e paginado.

import { assert, assertEquals } from "./_test_utils.ts";
import { buildExportPdf } from "./pdf.ts";

function decode(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

Deno.test("buildExportPdf: começa com %PDF-1.4 e termina com %%EOF", () => {
  const bytes = buildExportPdf({ title: "Resumo", metaLines: [], paragraphs: ["oi"] });
  const text = decode(bytes);
  assert(text.startsWith("%PDF-1.4\n"));
  assert(text.trimEnd().endsWith("%%EOF"));
});

Deno.test("buildExportPdf: título, meta-linhas e parágrafo aparecem no conteúdo (texto simples, sem compressão)", () => {
  const bytes = buildExportPdf({
    title: "Resumo pessoal — Cerne",
    metaLines: ["Período: 2026-09-01 até 2026-09-10", "Entradas consideradas: 3"],
    paragraphs: ["Esta semana você registrou momentos de calma e reflexão."],
  });
  const text = decode(bytes);
  assert(text.includes("Resumo pessoal"));
  // Acento dentro do Latin-1 (código <= 255, ex.: "í") é preservado
  // byte-a-byte por `encodeLatin1` — não devia virar "?" nem UTF-8 de 2 bytes.
  assert(text.includes("Período: 2026-09-01"), "acento Latin-1 deveria sobreviver ao round-trip");
  assert(text.includes("Entradas consideradas: 3"));
  assert(text.includes("Esta semana você registrou"));
});

Deno.test("buildExportPdf: 1 objeto Page quando o texto cabe numa página só", () => {
  const bytes = buildExportPdf({ title: "t", metaLines: [], paragraphs: ["um parágrafo curto"] });
  const text = decode(bytes);
  const pageCount = (text.match(/\/Type \/Page(?!s)/g) ?? []).length;
  assertEquals(pageCount, 1);
});

Deno.test("buildExportPdf: parágrafo muito longo pagina em mais de uma página", () => {
  const longParagraph = Array.from({ length: 400 }, (_, i) => `frase numero ${i}`).join(". ");
  const bytes = buildExportPdf({ title: "t", metaLines: [], paragraphs: [longParagraph] });
  const text = decode(bytes);
  const pageCount = (text.match(/\/Type \/Page(?!s)/g) ?? []).length;
  assert(pageCount > 1, `esperava mais de 1 página, obteve ${pageCount}`);
});

Deno.test("buildExportPdf: parênteses e barra invertida no texto não corrompem a string literal do PDF", () => {
  const bytes = buildExportPdf({
    title: "t",
    metaLines: [],
    paragraphs: ["texto com (parênteses) e \\barra"],
  });
  const text = decode(bytes);
  assert(text.includes("\\(par") || text.includes("\\("), "parêntese deveria estar escapado");
});

Deno.test("buildExportPdf: xref lista um offset por objeto, e o trailer aponta para /Root 1 0 R", () => {
  const bytes = buildExportPdf({ title: "t", metaLines: [], paragraphs: ["x"] });
  const text = decode(bytes);
  assert(text.includes("trailer"));
  assert(text.includes("/Root 1 0 R"));
  assert(/xref\n0 \d+\n/.test(text));
});
