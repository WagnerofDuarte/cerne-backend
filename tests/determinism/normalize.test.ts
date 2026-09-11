// T-062 — Testes de `normalize.ts`. Fixtures sintéticas no formato real do
// `--report-json` do `hurl` 6.1.1 (confirmado contra o binário de verdade
// nesta sessão, não só documentação) — não precisa de `hurl`/Postgres/
// Docker rodando para este arquivo passar.

// Mesma convenção de scripts/gen-openapi.test.ts — reaproveita o util
// local em vez de "jsr:@std/assert" (jsr.io bloqueado pela política de
// rede do sandbox onde este projeto foi escrito, ver _test_utils.ts).
import { assertEquals } from "../../supabase/functions/_shared/_test_utils.ts";
import { buildTranscript, diffTranscripts, type HurlFileReport } from "./normalize.ts";

function report(entries: HurlFileReport["entries"]): HurlFileReport[] {
  return [{ entries }];
}

/** `url` só importa para o teste de endpoints de auth opacos — o padrão vazio nunca casa com nenhum. */
function call(
  response: HurlFileReport["entries"][number]["calls"][number]["response"],
  url = "",
): HurlFileReport["entries"][number]["calls"][number] {
  return { request: { url }, response };
}

function bodies(map: Record<string, string>): (path: string) => string {
  return (path) => {
    const body = map[path];
    if (body === undefined) throw new Error(`corpo não encontrado: ${path}`);
    return body;
  };
}

Deno.test("duas execuções com UUIDs/timestamps diferentes, mas mesma estrutura, produzem o MESMO transcript", () => {
  const run1 = report([
    {
      index: 1,
      calls: [call({
        status: 200,
        headers: [{ name: "content-type", value: "application/json" }],
        body: "r1",
      })],
    },
  ]);
  const run2 = structuredClone(run1);

  const t1 = buildTranscript(
    run1,
    bodies({
      r1: '{"id":"11111111-1111-1111-1111-111111111111","createdAt":"2026-09-23T09:41:00Z"}',
    }),
  );
  const t2 = buildTranscript(
    run2,
    bodies({
      r1: '{"id":"99999999-9999-9999-9999-999999999999","createdAt":"2026-09-23T10:00:00.123Z"}',
    }),
  );

  assertEquals(diffTranscripts(t1, t2).identical, true);
});

Deno.test("o MESMO id reaparecendo em duas respostas normaliza pro MESMO placeholder nas duas execuções", () => {
  const entries: HurlFileReport["entries"] = [
    { index: 1, calls: [call({ status: 200, headers: [], body: "created" })] },
    { index: 2, calls: [call({ status: 200, headers: [], body: "fetched" })] },
  ];

  const t1 = buildTranscript(
    report(entries),
    bodies({
      created: '{"id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}',
      fetched: '{"data":{"id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}}',
    }),
  );
  const t2 = buildTranscript(
    report(structuredClone(entries)),
    bodies({
      created: '{"id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}',
      fetched: '{"data":{"id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}}',
    }),
  );

  assertEquals(diffTranscripts(t1, t2).identical, true);
});

Deno.test("achado real que este mecanismo existe pra pegar: id devolvido na criação DEIXA de bater com o lido depois -> diferença real, não normalizada", () => {
  const entries: HurlFileReport["entries"] = [
    { index: 1, calls: [call({ status: 200, headers: [], body: "created" })] },
    { index: 2, calls: [call({ status: 200, headers: [], body: "fetched" })] },
  ];

  // run1: o id da criação é o mesmo lido depois (comportamento correto)
  const t1 = buildTranscript(
    report(entries),
    bodies({
      created: '{"id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}',
      fetched: '{"data":{"id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}}',
    }),
  );
  // run2: o id lido depois é um TERCEIRO id, diferente do criado -> bug de
  // verdade (não é só "o UUID é aleatório", é "a relação entre os dois
  // valores mudou") — um normalizador que zera o contador por entrada não
  // pegaria isso; este pega, porque os dois "aaaa..."/"bbbb..." da run1
  // viram o MESMO placeholder <uuid:0>, mas na run2 o 2º id é um valor
  // novo nunca visto -> vira <uuid:1>, diferente do <uuid:0> do id criado.
  const t2 = buildTranscript(
    report(structuredClone(entries)),
    bodies({
      created: '{"id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}',
      fetched: '{"data":{"id":"cccccccc-cccc-cccc-cccc-cccccccccccc"}}',
    }),
  );

  const diff = diffTranscripts(t1, t2);
  assertEquals(diff.identical, false);
});

Deno.test("diferença real no corpo (não id/timestamp) é detectada", () => {
  const entries: HurlFileReport["entries"] = [
    { index: 1, calls: [call({ status: 200, headers: [], body: "b" })] },
  ];

  const t1 = buildTranscript(report(entries), bodies({ b: '{"status":"ready"}' }));
  const t2 = buildTranscript(
    report(structuredClone(entries)),
    bodies({ b: '{"status":"failed"}' }),
  );

  const diff = diffTranscripts(t1, t2);
  assertEquals(diff.identical, false);
  assertEquals(diff.expected?.includes("ready"), true);
  assertEquals(diff.actual?.includes("failed"), true);
});

Deno.test("diferença de status HTTP é detectada", () => {
  const t1 = buildTranscript(
    report([{ index: 1, calls: [call({ status: 200, headers: [], body: "b" })] }]),
    bodies({ b: "{}" }),
  );
  const t2 = buildTranscript(
    report([{ index: 1, calls: [call({ status: 500, headers: [], body: "b" })] }]),
    bodies({ b: "{}" }),
  );

  assertEquals(diffTranscripts(t1, t2).identical, false);
});

Deno.test("headers voláteis (date, content-length) são ignorados — não são não-determinismo real", () => {
  const t1 = buildTranscript(
    report([{
      index: 1,
      calls: [call({
        status: 200,
        headers: [
          { name: "date", value: "Wed, 09 Sep 2026 21:25:21 GMT" },
          { name: "content-length", value: "10" },
        ],
        body: "b",
      })],
    }]),
    bodies({ b: "{}" }),
  );
  const t2 = buildTranscript(
    report([{
      index: 1,
      calls: [call({
        status: 200,
        headers: [
          { name: "date", value: "Wed, 09 Sep 2026 22:00:00 GMT" },
          { name: "content-length", value: "999" },
        ],
        body: "b",
      })],
    }]),
    bodies({ b: "{}" }),
  );

  assertEquals(diffTranscripts(t1, t2).identical, true);
});

Deno.test("achado real (Wagner, T-062): headers de latência do Kong também são ignorados", () => {
  const withLatency = (proxyMs: string, upstreamMs: string) =>
    buildTranscript(
      report([{
        index: 1,
        calls: [call({
          status: 200,
          headers: [
            { name: "X-Kong-Proxy-Latency", value: proxyMs },
            { name: "X-Kong-Upstream-Latency", value: upstreamMs },
            { name: "Via", value: "kong/2.8.1" },
          ],
          body: "b",
        })],
      }]),
      bodies({ b: "{}" }),
    );

  // Valores reais observados na 1ª execução completa do run.sh contra o
  // Supabase CLI — a comparação derrubou por causa só disso, com as duas
  // rodadas 100% idênticas em tudo que a aplicação de fato controla.
  assertEquals(diffTranscripts(withLatency("0", "216"), withLatency("1", "204")).identical, true);
});

Deno.test("achado real (Wagner, T-062): corpo de auth-login/refresh/signup não é comparado — sessão sempre nova por design", () => {
  // Valores reais observados: dois logins com a MESMA conta, JWT e
  // refreshToken completamente diferentes (exp/iat/session_id embutidos
  // no token, opacos para as regex de UUID/ISO acima) — nunca poderiam
  // bater, e não é o tipo de não-determinismo que este teste mede (D1:
  // "proxy fino do GoTrue").
  const loginBody1 =
    '{"data":{"session":{"accessToken":"eyJhbGci...token-A","refreshToken":"dkyasjx752hn","expiresAt":1789009142}}}';
  const loginBody2 =
    '{"data":{"session":{"accessToken":"eyJhbGci...token-B","refreshToken":"d6we6evb36ir","expiresAt":1789009223}}}';

  const t1 = buildTranscript(
    report([{
      index: 1,
      calls: [
        call(
          { status: 200, headers: [], body: "login" },
          "http://127.0.0.1:54321/functions/v1/auth-login",
        ),
      ],
    }]),
    bodies({ login: loginBody1 }),
  );
  const t2 = buildTranscript(
    report([{
      index: 1,
      calls: [
        call(
          { status: 200, headers: [], body: "login" },
          "http://127.0.0.1:54321/functions/v1/auth-login",
        ),
      ],
    }]),
    bodies({ login: loginBody2 }),
  );

  assertEquals(diffTranscripts(t1, t2).identical, true);
});

Deno.test("achado real (Wagner, T-062): token de URL assinada do Storage (Location) não é comparado — expira e é assinado, sempre novo por design", () => {
  // Valores reais observados: mesmo export.download.get, mesmo arquivo
  // (raw.json), token JWT completamente diferente (iat/exp/assinatura
  // HMAC nunca se repetem, por desenho de segurança de URL assinada).
  const location1 =
    "http://kong:8000/storage/v1/object/sign/exports/a0000000-0000-0000-0000-000000000001/bef90778-1bb4-4fb2-aba5-b47ad542e6e0/raw.json?token=eyJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3ODkwMDcyMjF9.tokenA";
  const location2 =
    "http://kong:8000/storage/v1/object/sign/exports/a0000000-0000-0000-0000-000000000001/fc30b11d-d71d-4b4a-9d47-f5be43746645/raw.json?token=eyJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3ODkwMDczMDF9.tokenB";

  const t1 = buildTranscript(
    report([{
      index: 1,
      calls: [call({ status: 302, headers: [{ name: "Location", value: location1 }], body: "b" })],
    }]),
    bodies({ b: "" }),
  );
  const t2 = buildTranscript(
    report([{
      index: 1,
      calls: [call({ status: 302, headers: [{ name: "Location", value: location2 }], body: "b" })],
    }]),
    bodies({ b: "" }),
  );

  assertEquals(diffTranscripts(t1, t2).identical, true);
});

Deno.test("achado real (Wagner, T-062): timestamp no formato do Postgres (+00:00, não Z) é normalizado", () => {
  // Valores reais observados: o MESMO texto de insight gerado pela IA
  // (prova de que o cache bateu certinho), só o `created_at` do Postgres
  // (formato +00:00, diferente do `.toISOString()` do próprio código —
  // esse já terminava em Z e sempre normalizou certo) mudando entre as
  // duas execuções — hora real em que cada uma rodou, não não-
  // determinismo do sistema.
  const insightBody1 =
    '{"data":{"content":"mesmo texto gerado pela IA","createdAt":"2026-09-10T01:59:02.761367+00:00"}}';
  const insightBody2 =
    '{"data":{"content":"mesmo texto gerado pela IA","createdAt":"2026-09-10T02:00:23.740769+00:00"}}';

  const t1 = buildTranscript(
    report([{ index: 1, calls: [call({ status: 200, headers: [], body: "insight" })] }]),
    bodies({ insight: insightBody1 }),
  );
  const t2 = buildTranscript(
    report([{ index: 1, calls: [call({ status: 200, headers: [], body: "insight" })] }]),
    bodies({ insight: insightBody2 }),
  );

  assertEquals(diffTranscripts(t1, t2).identical, true);
});

Deno.test("achado real (Wagner, 11/09/2026): poll intermediário de export-status-get (pending vs processing) não derruba a comparação", () => {
  // Valores reais observados: mesmo jobId, mesma posição no transcript,
  // só o status divergindo entre as duas execuções — 1ª falha real do job
  // determinism no GitHub Actions após o congelamento da Fase 7.
  const url = "http://127.0.0.1:54321/functions/v1/export-status-get/abc";
  const entries: HurlFileReport["entries"] = [
    {
      index: 1,
      calls: [call(
        { status: 200, headers: [], body: "poll" },
        url,
      )],
    },
  ];

  const t1 = buildTranscript(
    report(entries),
    bodies({
      poll:
        '{"data":{"jobId":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","status":"processing","narrativeStatus":"pending","entryCount":34,"errorCode":null,"narrativeErrorCode":null,"downloadAvailable":false}}',
    }),
  );
  const t2 = buildTranscript(
    report(structuredClone(entries)),
    bodies({
      poll:
        '{"data":{"jobId":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","status":"pending","narrativeStatus":"pending","entryCount":34,"errorCode":null,"narrativeErrorCode":null,"downloadAvailable":false}}',
    }),
  );

  assertEquals(diffTranscripts(t1, t2).identical, true);
  // A entrada some inteira — nem o jobId (que apareceria de novo em outra
  // requisição legítima) deveria consumir um placeholder de UUID aqui.
  assertEquals(t1, "");
});

Deno.test("achado real (Wagner, 11/09/2026): número diferente de tentativas de export-status-get também não derruba a comparação", () => {
  const url = "http://127.0.0.1:54321/functions/v1/export-status-get/abc";
  const pendingCall = call(
    { status: 200, headers: [], body: "poll" },
    url,
  );
  const doneCall = call(
    { status: 200, headers: [], body: "done" },
    url,
  );

  // run1: 1 tentativa pendente, depois done.
  const t1 = buildTranscript(
    [{
      entries: [
        { index: 1, calls: [pendingCall] },
        { index: 2, calls: [doneCall] },
      ],
    }],
    bodies({
      poll: '{"data":{"status":"pending"}}',
      done: '{"data":{"status":"done","downloadAvailable":true}}',
    }),
  );

  // run2: 3 tentativas pendentes/processando, depois done — número
  // diferente de tentativas, mesmo resultado final.
  const t2 = buildTranscript(
    [{
      entries: [
        { index: 1, calls: [pendingCall] },
        { index: 2, calls: [pendingCall] },
        { index: 3, calls: [pendingCall] },
        { index: 4, calls: [doneCall] },
      ],
    }],
    bodies({
      poll: '{"data":{"status":"processing"}}',
      done: '{"data":{"status":"done","downloadAvailable":true}}',
    }),
  );

  assertEquals(diffTranscripts(t1, t2).identical, true);
});

Deno.test("export-status-get em estado terminal (done/error) continua comparado normalmente — divergência real ainda é pega", () => {
  const url = "http://127.0.0.1:54321/functions/v1/export-status-get/abc";
  const entries: HurlFileReport["entries"] = [
    { index: 1, calls: [call({ status: 200, headers: [], body: "b" }, url)] },
  ];

  const t1 = buildTranscript(
    report(entries),
    bodies({ b: '{"data":{"status":"done","downloadAvailable":true}}' }),
  );
  const t2 = buildTranscript(
    report(structuredClone(entries)),
    bodies({ b: '{"data":{"status":"error","downloadAvailable":false}}' }),
  );

  assertEquals(diffTranscripts(t1, t2).identical, false);
});

Deno.test("ordem das entradas por index é respeitada mesmo se o relatório vier fora de ordem", () => {
  const outOfOrder: HurlFileReport["entries"] = [
    { index: 2, calls: [call({ status: 200, headers: [], body: "second" })] },
    { index: 1, calls: [call({ status: 200, headers: [], body: "first" })] },
  ];
  const inOrder: HurlFileReport["entries"] = [
    { index: 1, calls: [call({ status: 200, headers: [], body: "first" })] },
    { index: 2, calls: [call({ status: 200, headers: [], body: "second" })] },
  ];

  const t1 = buildTranscript(report(outOfOrder), bodies({ first: "A", second: "B" }));
  const t2 = buildTranscript(report(inOrder), bodies({ first: "A", second: "B" }));

  assertEquals(t1, t2);
});
