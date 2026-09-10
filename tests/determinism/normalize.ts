// T-062 — Normalização + comparação do teste de determinismo (Plano
// técnico §11.3/§15.3): "Executa o roteiro de validação duas vezes contra
// banco recém-criado, em reprodução estrita, compara respostas caractere
// por caractere (ids e timestamps normalizados)."
//
// Entrada: o `--report-json <DIR>` do `hurl` (dois diretórios, um por
// execução de `tests/determinism/roteiro_validacao.hurl`) — `report.json`
// (lista de entradas na ordem em que as requisições foram feitas, com
// `index`/status/headers/captures) mais um arquivo por corpo de resposta
// em `store/`. Formato confirmado contra o binário `hurl` 6.1.1 real
// nesta sessão (não documentado formalmente no manual do CLI).
//
// Estratégia de normalização: qualquer UUID (`[Options]`/corpo/header) ou
// timestamp ISO 8601 vira um placeholder posicional (`<uuid:N>`/`<ts:N>`,
// N = ordem da 1ª aparição, contador ÚNICO para a execução inteira, não
// por entrada) — o MESMO valor real, se reaparecer depois (ex.: um id
// criado numa entrada e lido de novo numa GET mais adiante), sempre vira o
// MESMO placeholder. Isso é mais rigoroso que zerar contador por entrada:
// pega não só "os valores mudam" (óbvio, são gerados) mas "a RELAÇÃO entre
// eles muda" (ex.: o id devolvido pela criação deixa de ser o mesmo id
// usado por uma leitura logo depois) — um bug real de determinismo que um
// reset por entrada não pegaria.

export interface ReportHeader {
  readonly name: string;
  readonly value: string;
}

export interface ReportResponse {
  readonly status: number;
  readonly headers: readonly ReportHeader[];
  /** Caminho relativo ao diretório do relatório (`store/..._response[.json]`). */
  readonly body: string;
}

export interface ReportCall {
  readonly response: ReportResponse;
}

export interface ReportEntry {
  readonly index: number;
  readonly calls: readonly ReportCall[];
}

export interface HurlFileReport {
  readonly entries: readonly ReportEntry[];
}

/**
 * Headers que mudam por natureza sem indicar não-determinismo real.
 *
 * Achado real (Wagner, T-062, 1ª execução completa de `run.sh` contra o
 * Supabase CLI de verdade): `x-kong-proxy-latency`/`x-kong-upstream-
 * latency` — o Kong (proxy que o `supabase functions serve` local roda na
 * frente de toda função, ver também `docs/roteiro_de_validacao.md`) marca
 * cada resposta com quantos milissegundos ela levou pra passar por ele.
 * Isso nunca é reproduzível entre duas execuções — é tempo de rede/CPU do
 * momento, não comportamento do sistema — e por isso já derrubou a 1ª
 * comparação real (`0` vs `1`) mesmo com as duas execuções 100% idênticas
 * em tudo que a aplicação de fato controla (zero `REPLAY_MISS`, todas as
 * asserções de negócio batendo). Nunca apareceu nesta sessão porque o mock
 * HTTP usado para validar `normalize.ts` não tem Kong na frente.
 */
const VOLATILE_HEADERS = new Set([
  "date",
  "content-length",
  "x-kong-proxy-latency",
  "x-kong-upstream-latency",
]);

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ISO_TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;

class PositionalNormalizer {
  private readonly uuidPlaceholders = new Map<string, string>();
  private readonly tsPlaceholders = new Map<string, string>();
  private uuidCounter = 0;
  private tsCounter = 0;

  normalize(text: string): string {
    const withoutUuids = text.replace(UUID_RE, (match) => {
      const key = match.toLowerCase();
      let placeholder = this.uuidPlaceholders.get(key);
      if (!placeholder) {
        placeholder = `<uuid:${this.uuidCounter++}>`;
        this.uuidPlaceholders.set(key, placeholder);
      }
      return placeholder;
    });
    return withoutUuids.replace(ISO_TIMESTAMP_RE, (match) => {
      let placeholder = this.tsPlaceholders.get(match);
      if (!placeholder) {
        placeholder = `<ts:${this.tsCounter++}>`;
        this.tsPlaceholders.set(match, placeholder);
      }
      return placeholder;
    });
  }
}

/**
 * Monta um transcript normalizado de UMA execução — concatenação, na
 * ordem das requisições (`entry.index`), de status + headers não-voláteis
 * + corpo, com todo UUID/timestamp substituído por um placeholder
 * posicional. Duas execuções idênticas em tudo que importa produzem o
 * MESMO transcript, comparável com `===` (§15.3, "byte a byte").
 *
 * `readBody` é injetado (em vez deste módulo ler arquivo direto) para
 * testar com fixtures em memória, sem precisar de um relatório real do
 * `hurl` em disco.
 */
export function buildTranscript(
  reports: readonly HurlFileReport[],
  readBody: (relativePath: string) => string,
): string {
  const normalizer = new PositionalNormalizer();
  const lines: string[] = [];

  for (const report of reports) {
    const sortedEntries = [...report.entries].sort((a, b) => a.index - b.index);
    for (const entry of sortedEntries) {
      for (const call of entry.calls) {
        const res = call.response;
        lines.push(`=== entry ${entry.index} status=${res.status} ===`);
        const sortedHeaders = [...res.headers].sort((a, b) => a.name.localeCompare(b.name));
        for (const header of sortedHeaders) {
          if (VOLATILE_HEADERS.has(header.name.toLowerCase())) continue;
          lines.push(`header ${header.name.toLowerCase()}: ${normalizer.normalize(header.value)}`);
        }
        let body: string;
        try {
          body = readBody(res.body);
        } catch (err) {
          body = `<corpo ilegível: ${err instanceof Error ? err.message : err}>`;
        }
        lines.push(normalizer.normalize(body));
      }
    }
  }

  return lines.join("\n");
}

export interface DiffResult {
  readonly identical: boolean;
  /** Só presente quando `identical` é falso — a 1ª linha onde os dois transcripts divergem. */
  readonly firstDifferenceLine?: number;
  readonly expected?: string;
  readonly actual?: string;
}

/** Compara dois transcripts já normalizados, linha a linha — mais legível que um diff de string única gigante quando algo diverge. */
export function diffTranscripts(a: string, b: string): DiffResult {
  if (a === b) return { identical: true };

  const linesA = a.split("\n");
  const linesB = b.split("\n");
  const max = Math.max(linesA.length, linesB.length);
  for (let i = 0; i < max; i++) {
    if (linesA[i] !== linesB[i]) {
      return {
        identical: false,
        firstDifferenceLine: i + 1,
        expected: linesA[i] ?? "<linha ausente na 1ª execução>",
        actual: linesB[i] ?? "<linha ausente na 2ª execução>",
      };
    }
  }
  // Não deveria chegar aqui (a !== b já teria achado uma linha diferente) —
  // rede de segurança para o caso raro de diferença só em quebra de linha.
  return { identical: false, firstDifferenceLine: -1, expected: a, actual: b };
}
