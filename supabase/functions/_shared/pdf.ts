// Módulo `pdf` — gap-fill da Fase 5 (T-054, RF05: "exportável em PDF").
//
// Nenhum documento-fonte especifica biblioteca ou formato visual do PDF —
// "Escopo medido: geração do job, download, tratamento de falha — nunca a
// qualidade do texto" (`Contexto Geral.md` RF05). Em vez de trazer uma
// dependência nova (`deno.json` só declara `zod`/`@supabase/supabase-js`/
// `yaml` até aqui, todas já necessárias por outras fases), este módulo
// escreve um PDF válido "na mão" — texto simples, fonte padrão Helvetica
// (não precisa embutir arquivo de fonte), sem imagem nem layout, suficiente
// para o critério de aceite ser satisfeito sem inflar a superfície de
// dependências do projeto.

const PAGE_WIDTH = 612; // Letter, em pontos (72pt = 1 polegada)
const PAGE_HEIGHT = 792;
const MARGIN = 56;
const FONT_SIZE = 11;
const LINE_HEIGHT = 15;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
// Largura média de caractere da Helvetica em 11pt é irregular (não é fonte
// monoespaçada) — usar uma estimativa conservadora (~5.6pt/caractere) evita
// estourar a margem direita na maioria dos textos em português, ao custo de
// deixar alguma folga em linhas com muitos caracteres estreitos (i, l, .).
// Não crítico: "nunca a qualidade do texto" (RF05).
const AVG_CHAR_WIDTH = FONT_SIZE * 0.52;
const MAX_CHARS_PER_LINE = Math.max(20, Math.floor(CONTENT_WIDTH / AVG_CHAR_WIDTH));
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - MARGIN * 2) / LINE_HEIGHT);

/** Escapa `(`, `)` e `\` — os três caracteres especiais de uma string literal PDF (`(...)`). */
function escapePdfString(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** PDF `string` literal só aceita Latin-1 (WinAnsiEncoding) — fora disso, substitui por `?` em vez de corromper o arquivo. */
function toLatin1(text: string): string {
  return Array.from(text).map((ch) => (ch.codePointAt(0)! <= 255 ? ch : "?")).join("");
}

/** Quebra um parágrafo em linhas de até `MAX_CHARS_PER_LINE` caracteres, respeitando espaços entre palavras. */
function wrapParagraph(paragraph: string): string[] {
  const words = paragraph.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > MAX_CHARS_PER_LINE && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function buildContentStream(lines: readonly string[]): string {
  const startY = PAGE_HEIGHT - MARGIN;
  const body = lines
    .map((line) => `(${escapePdfString(toLatin1(line))}) Tj T*`)
    .join("\n");
  return [
    "BT",
    `/F1 ${FONT_SIZE} Tf`,
    `${LINE_HEIGHT} TL`,
    `${MARGIN} ${startY} Td`,
    body,
    "ET",
  ].join("\n");
}

export interface BuildExportPdfArgs {
  readonly title: string;
  /** Metadados de uma linha cada (período, contagem de entradas, geradoEm, ...), impressos antes do corpo. */
  readonly metaLines: readonly string[];
  /** Corpo do documento — cada item é um parágrafo, quebrado em linhas automaticamente. */
  readonly paragraphs: readonly string[];
}

/**
 * Gera um PDF simples de texto corrido — título, meta-linhas e parágrafos,
 * paginado automaticamente. Devolve os bytes prontos para upload no Storage
 * (`exports/<user_id>/<job_id>/summary.pdf`, T-052).
 */
export function buildExportPdf(args: BuildExportPdfArgs): Uint8Array {
  const allLines: string[] = [
    toLatin1(args.title),
    "",
    ...args.metaLines.map(toLatin1),
    "",
    ...args.paragraphs.flatMap((
      p,
      i,
    ) => [...wrapParagraph(p), ...(i < args.paragraphs.length - 1 ? [""] : [])]),
  ];

  const pages: string[][] = [];
  for (let i = 0; i < allLines.length; i += LINES_PER_PAGE) {
    pages.push(allLines.slice(i, i + LINES_PER_PAGE));
  }
  if (pages.length === 0) pages.push([""]);

  return assemblePdf(pages);
}

// --- Montagem de baixo nível do arquivo PDF --------------------------------
//
// Estrutura mínima válida: 1 Catalog, 1 Pages, N Page (uma por página), 1
// Font, N Content stream (uma por página) — xref e trailer calculados a
// partir dos offsets reais de cada objeto no arquivo final.

/**
 * Codifica 1 caractere = 1 byte (Latin-1/WinAnsi) — NUNCA `TextEncoder`
 * (sempre UTF-8) aqui. Bug real encontrado escrevendo este módulo: o
 * `/Encoding /WinAnsiEncoding` declarado no objeto Font promete 1 byte por
 * caractere, mas `TextEncoder().encode(...)` codifica qualquer acentuação
 * (comum em português — "é", "ã", "í"...) como 2+ bytes UTF-8, deslocando
 * todo `/Length` de stream e todo offset do xref a partir dali — o PDF
 * abriria corrompido em qualquer leitor real. `toLatin1` (acima) já garante
 * que todo código de caractere aqui é <= 255, então `charCodeAt & 0xff` é
 * seguro.
 */
function encodeLatin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

function assemblePdf(pages: readonly string[][]): Uint8Array {
  const objects: string[] = [];

  const pagesObjNum = 2;
  const fontObjNum = 3;
  const firstPageObjNum = 4;
  const pageCount = pages.length;
  const firstContentObjNum = firstPageObjNum + pageCount;

  // 1) Catalog
  objects.push(`<< /Type /Catalog /Pages ${pagesObjNum} 0 R >>`);
  // 2) Pages (preenchido depois de sabermos os números dos objetos Page)
  const kids = Array.from({ length: pageCount }, (_, i) => `${firstPageObjNum + i} 0 R`).join(" ");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
  // 3) Font
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
  // 4..(4+N-1) Page objects
  for (let i = 0; i < pageCount; i++) {
    const contentObjNum = firstContentObjNum + i;
    objects.push(
      `<< /Type /Page /Parent ${pagesObjNum} 0 R ` +
        `/MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 ${fontObjNum} 0 R >> >> ` +
        `/Contents ${contentObjNum} 0 R >>`,
    );
  }
  // (4+N)..(4+2N-1) Content streams
  for (const pageLines of pages) {
    const stream = buildContentStream(pageLines);
    const streamBytes = encodeLatin1(stream);
    objects.push(`<< /Length ${streamBytes.length} >>\nstream\n${stream}\nendstream`);
  }

  // Monta o arquivo, registrando o offset (em bytes) de cada "N 0 obj".
  let file = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(encodeLatin1(file).length);
    file += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = encodeLatin1(file).length;
  const totalObjects = objects.length + 1; // +1 pelo objeto 0 (livre), convenção do formato PDF
  let xref = `xref\n0 ${totalObjects}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  file += xref;
  file += `trailer\n<< /Size ${totalObjects} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return encodeLatin1(file);
}
