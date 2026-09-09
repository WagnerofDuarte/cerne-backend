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
      calls: [{
        response: {
          status: 200,
          headers: [{ name: "content-type", value: "application/json" }],
          body: "r1",
        },
      }],
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
    { index: 1, calls: [{ response: { status: 200, headers: [], body: "created" } }] },
    { index: 2, calls: [{ response: { status: 200, headers: [], body: "fetched" } }] },
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
    { index: 1, calls: [{ response: { status: 200, headers: [], body: "created" } }] },
    { index: 2, calls: [{ response: { status: 200, headers: [], body: "fetched" } }] },
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
    { index: 1, calls: [{ response: { status: 200, headers: [], body: "b" } }] },
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
    report([{ index: 1, calls: [{ response: { status: 200, headers: [], body: "b" } }] }]),
    bodies({ b: "{}" }),
  );
  const t2 = buildTranscript(
    report([{ index: 1, calls: [{ response: { status: 500, headers: [], body: "b" } }] }]),
    bodies({ b: "{}" }),
  );

  assertEquals(diffTranscripts(t1, t2).identical, false);
});

Deno.test("headers voláteis (date, content-length) são ignorados — não são não-determinismo real", () => {
  const t1 = buildTranscript(
    report([{
      index: 1,
      calls: [{
        response: {
          status: 200,
          headers: [
            { name: "date", value: "Wed, 09 Sep 2026 21:25:21 GMT" },
            { name: "content-length", value: "10" },
          ],
          body: "b",
        },
      }],
    }]),
    bodies({ b: "{}" }),
  );
  const t2 = buildTranscript(
    report([{
      index: 1,
      calls: [{
        response: {
          status: 200,
          headers: [
            { name: "date", value: "Wed, 09 Sep 2026 22:00:00 GMT" },
            { name: "content-length", value: "999" },
          ],
          body: "b",
        },
      }],
    }]),
    bodies({ b: "{}" }),
  );

  assertEquals(diffTranscripts(t1, t2).identical, true);
});

Deno.test("ordem das entradas por index é respeitada mesmo se o relatório vier fora de ordem", () => {
  const outOfOrder: HurlFileReport["entries"] = [
    { index: 2, calls: [{ response: { status: 200, headers: [], body: "second" } }] },
    { index: 1, calls: [{ response: { status: 200, headers: [], body: "first" } }] },
  ];
  const inOrder: HurlFileReport["entries"] = [
    { index: 1, calls: [{ response: { status: 200, headers: [], body: "first" } }] },
    { index: 2, calls: [{ response: { status: 200, headers: [], body: "second" } }] },
  ];

  const t1 = buildTranscript(report(outOfOrder), bodies({ first: "A", second: "B" }));
  const t2 = buildTranscript(report(inOrder), bodies({ first: "A", second: "B" }));

  assertEquals(t1, t2);
});
