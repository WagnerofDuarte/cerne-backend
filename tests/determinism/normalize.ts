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

export interface ReportRequest {
  readonly url: string;
}

export interface ReportCall {
  readonly request: ReportRequest;
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
// Achado real (Wagner, T-062): o Postgres serializa `timestamptz` como
// deslocamento numérico (`+00:00`), não como `Z` — diferente de todo
// timestamp que o próprio código deste projeto gera via `.toISOString()`
// (esses sim terminam em `Z`). Um campo vindo direto do banco (ex.:
// `insights.created_at`) precisa das duas variantes reconhecidas, senão
// só metade dos timestamps normaliza e a comparação derruba por um
// campo que é, na prática, "a hora em que rodei o teste" — não
// não-determinismo de verdade.
const ISO_TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g;

/**
 * Os 3 endpoints "sem sessão prévia" (gateway.ts: signup/login/refresh) —
 * cada chamada emite uma sessão GoTrue nova (JWT + refreshToken opaco),
 * nunca reproduzível entre execuções por desenho, mesmo com tudo mais
 * idêntico. `auth-session` fica de fora de propósito: só lê a sessão já
 * existente, não emite nada novo.
 */
const OPAQUE_AUTH_PATH_SEGMENTS = ["/auth-login", "/auth-refresh", "/auth-signup"];

function isOpaqueAuthEndpoint(url: string): boolean {
  return OPAQUE_AUTH_PATH_SEGMENTS.some((segment) => url.includes(segment));
}

const EXPORT_STATUS_PATH_SEGMENT = "/export-status-get/";

/** Únicos estados de `export_jobs.status` que este teste garante estáveis — os intermediários (`pending`/`processing`) não são. */
const TERMINAL_EXPORT_STATUSES = new Set(["done", "error"]);

function isExportStatusEndpoint(url: string): boolean {
  return url.includes(EXPORT_STATUS_PATH_SEGMENT);
}

/**
 * Achado real (Wagner, 11/09/2026, 1ª execução real do job `determinism`
 * no GitHub Actions após o congelamento da Fase 7): o roteiro faz polling
 * de `GET /export-status-get/:jobId` (`[Options] retry`/`retry-interval`
 * do Hurl) até `status == "done"`. Cada tentativa intermediária captura o
 * estado do job NAQUELE instante — que depende de quando o `pg_cron`
 * acorda em relógio de parede real, nunca sincronizado com o teste. Duas
 * execuções podem legitimamente pegar `pending` numa tentativa em que a
 * outra já pegou `processing` (foi exatamente isso que derrubou a 1ª
 * comparação real: mesmo `jobId`, mesma posição no transcript, só o
 * `status` divergindo) — não é não-determinismo do backend, as duas
 * terminam em `done`. Mesma categoria de um achado já registrado na Fase
 * 5 (o NÚMERO de tentativas pode variar entre execuções, "comportamento
 * esperado, não um problema") — esta é a versão mais estrita: também o
 * CONTEÚDO de uma tentativa no meio do caminho pode variar.
 *
 * Solução: qualquer resposta de `export-status-get` cujo `status` não seja
 * terminal (`done`/`error`) é excluída INTEIRA do transcript (nem a linha
 * de status/headers entra) — não só o corpo. Isso resolve as duas faces
 * do mesmo problema de uma vez: conteúdo intermediário divergente E
 * número de tentativas divergente (se uma execução precisar de 3
 * tentativas e a outra de 5, as intermediárias somem das duas, e só o
 * `done` final — que é o que o roteiro de fato garante via `[Asserts]` —
 * entra na comparação).
 */
function isNonTerminalExportStatusResponse(url: string, body: string): boolean {
  if (!isExportStatusEndpoint(url)) return false;
  try {
    const parsed = JSON.parse(body);
    const status = parsed?.data?.status;
    return !(typeof status === "string" && TERMINAL_EXPORT_STATUSES.has(status));
  } catch {
    // corpo ilegível como JSON — não é o formato esperado de resposta de
    // status; deixa cair no comportamento padrão (comparado normalmente),
    // mais seguro que ocultar algo que pode ser um erro real.
    return false;
  }
}

/**
 * Achado real (Wagner, T-062, mesma execução dos achados acima): o
 * `Location` de `export.download.get` (T-055, único redirect dos 23
 * endpoints) é uma URL assinada do Storage — `.../object/sign/.../raw.json
 * ?token=<JWT>`. Esse token embute `iat`/`exp` (o link expira) e é
 * assinado por HMAC, então o token inteiro NUNCA é igual entre duas
 * gerações, mesmo para o exato mesmo arquivo — por desenho de segurança
 * de URL assinada, não não-determinismo do projeto. O caminho antes do
 * `?` (bucket/usuário/job/arquivo) continua útil de comparar — só a
 * query string (o token em si) vira opaca.
 */
function stripSignedUrlToken(headerName: string, value: string): string {
  if (headerName.toLowerCase() !== "location") return value;
  const queryStart = value.indexOf("?token=");
  if (queryStart === -1) return value;
  return `${value.slice(0, queryStart)}?token=<url-assinada-sempre-nova>`;
}

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
  // Posição de SAÍDA — não o `entry.index` bruto do Hurl. Necessário desde
  // o achado do export-status-get (acima): se uma execução precisar de
  // menos tentativas intermediárias que a outra antes das excluirmos,
  // tudo que vem DEPOIS ainda teria um `entry.index` bruto diferente
  // entre as duas execuções, mesmo idêntico em conteúdo — um contador que
  // só avança para o que de fato entra no transcript é imune a isso.
  let outputPosition = 0;

  for (const report of reports) {
    const sortedEntries = [...report.entries].sort((a, b) => a.index - b.index);
    for (const entry of sortedEntries) {
      for (const call of entry.calls) {
        const res = call.response;

        let body: string;
        try {
          body = readBody(res.body);
        } catch (err) {
          body = `<corpo ilegível: ${err instanceof Error ? err.message : err}>`;
        }

        if (isNonTerminalExportStatusResponse(call.request.url, body)) {
          // Poll intermediário de export-status-get (pending/processing) —
          // excluído inteiro do transcript, ver comentário da função acima.
          continue;
        }

        lines.push(`=== entry ${outputPosition++} status=${res.status} ===`);
        const sortedHeaders = [...res.headers].sort((a, b) => a.name.localeCompare(b.name));
        for (const header of sortedHeaders) {
          if (VOLATILE_HEADERS.has(header.name.toLowerCase())) continue;
          const value = stripSignedUrlToken(header.name, header.value);
          lines.push(`header ${header.name.toLowerCase()}: ${normalizer.normalize(value)}`);
        }
        if (isOpaqueAuthEndpoint(call.request.url)) {
          // Achado real (Wagner, T-062, 1ª execução completa contra o
          // Supabase CLI): o corpo de auth-login/refresh/signup embute um
          // JWT inteiro (com `exp`/`iat` em epoch, não capturados pelas
          // regex de UUID/ISO acima) + um `refreshToken` opaco do GoTrue —
          // nenhum dos dois é reproduzível entre execuções, por design
          // (sessão nova a cada login), e não é o tipo de não-determinismo
          // que este teste existe para pegar (D1: "proxy fino do GoTrue",
          // fora do que o projeto controla/cacheia). Comparar só status +
          // headers pra esses 3 endpoints; o corpo em si nunca é igual.
          lines.push(
            "<corpo de auth GoTrue — sessão/token sempre novos por design, não comparado>",
          );
          continue;
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
