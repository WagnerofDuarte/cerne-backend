#!/usr/bin/env -S deno run --allow-read --allow-write
// T-064 (Fase 7, Plano técnico §12 passo 10: "Montar docs/handoff/").
//
// Gera os documentos NOVOS do pacote de handoff — nunca editar os arquivos
// de saída à mão, sempre regenerar (mesmo espírito de `gen-openapi.ts`,
// T-033: fonte única, nada duplicado por transcrição manual que possa
// divergir do código real):
//   - taxonomia_erros.md   <- gerado de `errors.ts` (fonte única dos 13
//                             códigos — nunca redigitar a tabela à mão)
//   - mapa_estados_tela.md <- transcrição literal da única tabela
//                             tela<->status que os documentos-fonte
//                             definem (Contexto Geral.md §11.7 / plano
//                             técnico equivalente); não há como gerar
//                             isso de código porque a tela em si não vive
//                             neste repositório (é o app, não o backend)
//   - selo_sincronizacao.md <- semântica da D9, ancorada nos campos reais
//                              expostos pelo contrato (`serverRevision`/
//                              `updatedAt` de `contracts/zod/entries.ts`
//                              e `account.ts`/`auth.ts`)
//   - README.md             <- índice do pacote inteiro, incluindo as
//                              partes que este script NÃO gera (fixtures,
//                              coleção Hurl, credenciais) — essas são
//                              copiadas/preenchidas só na hora do
//                              GATE-11 por `build-handoff-package.sh`,
//                              nunca duplicadas permanentemente aqui
//                              (fixtures/media/ tem ~12MB; duplicar
//                              infla o histórico deste repo à toa)
//
// O que fica de fora deste diretório de propósito, até o GATE-11:
//   - cópias de contracts/openapi.yaml, docs/roteiro_de_validacao.md,
//     fixtures/, tests/hurl/*.hurl, docs/bugs_conhecidos.md — todos já
//     vivem versionados em algum lugar deste repo; duplicá-los aqui cedo
//     demais só cria uma segunda fonte pra ficar desatualizada. O script
//     `build-handoff-package.sh` copia tudo isso (mais o que este arquivo
//     gera) para o repositório de handoff separado, no momento real da
//     publicação.
//   - credenciais de ambiente — nunca tocadas por nenhum script; são
//     inseridas manualmente por quem publica, direto no repositório de
//     handoff, nunca passam pelo cerne-backend.
//
// Uso: deno run -A scripts/gen-handoff-docs.ts

import {
  ERROR_CODES,
  type ErrorCode,
  httpStatusFor,
  isRetryable,
} from "../supabase/functions/_shared/errors.ts";

const OUT_DIR = new URL("../docs/handoff/", import.meta.url);

const GENERATED_BANNER = "<!-- GERADO por scripts/gen-handoff-docs.ts — não editar à mão. -->\n\n";

export function buildTaxonomiaErrosMd(codes: readonly ErrorCode[]): string {
  const linhas = codes.map((code) => {
    const http = httpStatusFor(code);
    const retryable = isRetryable(code);
    return `| \`${code}\` | ${http === null ? "_(sem resposta HTTP — ver nota)_" : http} | ${
      retryable ? "sim" : "não"
    } |`;
  });

  return (
    GENERATED_BANNER +
    "# Taxonomia de erro — 13 códigos\n\n" +
    "Fonte: `supabase/functions/_shared/errors.ts` (fonte única do projeto — todo " +
    "handler lança erro só através de `throwError(code)`, nunca `throw` direto).\n\n" +
    "| Código | HTTP | Retryable |\n|---|---|---|\n" +
    linhas.join("\n") +
    "\n\n" +
    "**Duas armadilhas deliberadas, por desenho (nunca acontecem nesta API):**\n" +
    "- **Nunca `403`** — recurso de outro usuário sempre responde `404 NOT_FOUND` " +
    "(evita vazar a existência do recurso).\n" +
    "- **Nunca `409`** — a idempotência do RF10 (reenvio da mesma mensagem de chat) " +
    'sempre responde `200`; não existe código de "conflito" nesta taxonomia.\n\n' +
    "**`NETWORK_OFFLINE` não tem status HTTP:** é o único código que nunca vira uma " +
    "resposta de verdade — a injeção de falha desse tipo encerra a conexão sem " +
    "responder (usada só em teste, via `X-Test-Fault`).\n" +
    "\n" +
    `Total: **${codes.length} códigos**, lista fechada — nenhum código novo pode ser ` +
    "adicionado depois do congelamento (contradiz o RNF09 do ciclo que já rodou).\n"
  );
}

export function buildMapaEstadosTelaMd(): string {
  return (
    GENERATED_BANNER +
    "# Mapa de estados de tela — exportação (RF05)\n\n" +
    "Fonte: `context/Contexto Geral.md` §11.7 (e equivalente no plano técnico) — " +
    "tabela literal dos documentos-fonte, transcrita aqui, não gerada de código: a " +
    "tela que ela descreve é do aplicativo, que não vive neste repositório.\n\n" +
    "`export_jobs` tem dois status **independentes** — o do job em si e o da " +
    "narrativa gerada por IA (D11) — porque os dados brutos da exportação podem " +
    "ficar prontos antes, depois ou independentemente da narrativa, e a UI nunca " +
    "deve bloquear o download por causa de uma narrativa que falhou.\n\n" +
    "| O que a tela mostra | Status do job | Status da narrativa | Download disponível |\n" +
    "|---|---|---|---|\n" +
    "| Preparando exportação | pendente | pendente | não |\n" +
    "| Gerando resumo com IA | processando | processando | não |\n" +
    "| Dados prontos, resumo ainda gerando | dados_prontos | processando | sim (sem PDF) |\n" +
    "| Concluído, com resumo | concluído | concluída | sim (com PDF) |\n" +
    "| Concluído, resumo falhou/pulado | concluído | falhou ou pulada | sim (sem PDF) |\n" +
    "| Erro na exportação | erro | — | não |\n\n" +
    "Este é o **único** mapeamento tela↔status que os documentos-fonte definem em " +
    "detalhe suficiente para reproduzir sem ambiguidade — cobre só a tela de " +
    "exportação (RF05). Um mapa completo de todas as telas do protótipo (RF01–RF10) " +
    "depende de `Requisitos_e_Fluxo_de_Telas_TCC.md`, que não está neste " +
    "repositório (ver `docs/bugs_conhecidos.md`/registro de pendências no " +
    '`big-plan.md`, seção "Itens em aberto").\n'
  );
}

export function buildSeloSincronizacaoMd(): string {
  return (
    GENERATED_BANNER +
    "# Semântica do selo de sincronização (D9)\n\n" +
    "**Decisão de arquitetura D9:** não existe coluna `sync_status` no banco — a " +
    'arquitetura é cloud-only, então "está no servidor" já significa ' +
    '"sincronizado", por definição. O servidor não guarda nem calcula um estado ' +
    "de sincronização; ele só expõe dois campos, e o **selo é derivado inteiramente " +
    "no aplicativo** a partir deles:\n\n" +
    "| Campo | Onde aparece no contrato | O que significa |\n" +
    "|---|---|---|\n" +
    "| `updatedAt` | `Entry.updatedAt` (`contracts/zod/entries.ts`) | Timestamp da " +
    "última escrita no servidor para aquela entrada. |\n" +
    "| `serverRevision` | `Entry.serverRevision`, e também no perfil " +
    "(`contracts/zod/account.ts`/`auth.ts`) | Contador que sobe a cada escrita nas " +
    "entradas do usuário — nunca reseta, nunca decresce. |\n\n" +
    "**Os 3 estados do selo, todos inferidos no cliente — nenhum vem pronto do " +
    "servidor:**\n" +
    "1. **Sincronizando** — o app tem uma escrita local ainda não confirmada pelo " +
    "servidor (ainda não recebeu a resposta com o `updatedAt`/`serverRevision` " +
    "novos).\n" +
    "2. **Erro de sincronização** — a escrita foi tentada e falhou (rede, ou um dos " +
    "13 códigos de erro da taxonomia) e o app ainda não conseguiu reconciliar.\n" +
    "3. **Sincronizado** — a última escrita confirmada bateu; não há nada pendente " +
    "do lado do cliente para aquela entrada.\n\n" +
    "**Por que isso importa para os dois ciclos comparativos:** nenhuma decisão de " +
    "*quando* mostrar cada estado é do servidor — os dois ciclos implementam essa " +
    "lógica de reconciliação de forma independente no cliente, usando exatamente " +
    "os mesmos dois campos. Divergência de comportamento aqui é uma diferença " +
    "legítima de metodologia, não um defeito do backend.\n"
  );
}

export function buildReadmeMd(): string {
  return (
    GENERATED_BANNER +
    "# Pacote de handoff — backend Cerne\n\n" +
    "Entregue **igual** aos dois ciclos comparativos (Spec Kit e BMAD-METHOD), " +
    "**sem o código-fonte do backend** — evita assimetria de informação entre os " +
    "dois ciclos, que veriam a implementação de referência se o código vazasse.\n\n" +
    "## Conteúdo\n\n" +
    "Gerado por `scripts/gen-handoff-docs.ts` (este diretório, versionado em " +
    "`cerne-backend`):\n" +
    "- `taxonomia_erros.md` — os 13 códigos de erro\n" +
    "- `mapa_estados_tela.md` — mapeamento tela↔status da exportação (RF05)\n" +
    "- `selo_sincronizacao.md` — semântica do selo de sincronização (D9)\n" +
    "- `politica_defeito_D16.md` — política de defeito pós-congelamento\n\n" +
    "Copiado/preenchido só na hora da publicação (`scripts/build-handoff-" +
    "package.sh`, GATE-11) — não duplicado aqui de propósito, para não haver " +
    "duas fontes do mesmo arquivo:\n" +
    "- `api/openapi.yaml` (cópia de `contracts/openapi.yaml`)\n" +
    "- `roteiro_de_validacao.md` (cópia de `docs/roteiro_de_validacao.md`)\n" +
    "- `fixtures/` (cópia de `fixtures/` — textos, pares semânticos, mídia)\n" +
    "- `testes_contrato/` (cópia de `tests/hurl/*.hurl` + README)\n" +
    "- `bugs_conhecidos.md` (cópia de `docs/bugs_conhecidos.md`)\n" +
    "- `credenciais/` — **preenchido manualmente**, uma credencial por ciclo " +
    "(`ciclo-a`/`ciclo-b`); nenhum script deste repositório gera, lê ou copia " +
    "segredo nenhum.\n"
  );
}

export function buildPoliticaDefeitoMd(): string {
  return (
    GENERATED_BANNER +
    "# Política de defeito pós-congelamento (D16)\n\n" +
    "Fonte: `context/Contexto Geral.md` §10. Nenhuma linha do backend muda " +
    "enquanto os dois ciclos rodam, **exceto** por esta política.\n\n" +
    "| Gravidade | Definição | Ação |\n|---|---|---|\n" +
    "| **Não bloqueante** | Existe contorno razoável; nenhum critério de aceite " +
    "fica impossível | **Não corrigir.** Registrar em `bugs_conhecidos.md`, " +
    "entregue igual aos dois ciclos. |\n" +
    "| **Bloqueante** | Algum critério de aceite se torna impossível | Corrigir " +
    "nos 3 ambientes, reexecutar o roteiro, repopular o cache, registrar em " +
    '"Ameaças à Validade". Se o ciclo A já terminou, registrar que ele não teve ' +
    "a correção. |\n" +
    "| **Bloqueante descoberto no ciclo B** | Pior caso | Corrigir, terminar o " +
    "ciclo, e **declarar aquela métrica como não comparável**. Não maquiar. |\n\n" +
    '**Por que "corrigir uma vez" não resolve nos dois ciclos:** os ciclos são ' +
    "sequenciais (rodam contra versões diferentes do backend, antes/depois da " +
    "correção); são três ambientes que exigem reconferência de estrutura; uma " +
    "correção que toque montagem de prompt ou ordenação muda as impressões " +
    "digitais do cache de replay; e as horas já gastas contornando o bug no ciclo " +
    "A contam como métrica de processo e não são devolvidas.\n"
  );
}

async function writeFile(name: string, content: string): Promise<void> {
  const url = new URL(name, OUT_DIR);
  await Deno.writeTextFile(url, content);
  console.log(`  docs/handoff/${name}`);
}

async function main() {
  await Deno.mkdir(OUT_DIR, { recursive: true });

  console.log("Gerando docs/handoff/...");
  await writeFile("taxonomia_erros.md", buildTaxonomiaErrosMd(ERROR_CODES));
  await writeFile("mapa_estados_tela.md", buildMapaEstadosTelaMd());
  await writeFile("selo_sincronizacao.md", buildSeloSincronizacaoMd());
  await writeFile("politica_defeito_D16.md", buildPoliticaDefeitoMd());
  await writeFile("README.md", buildReadmeMd());
  console.log("\nPronto. Ver README.md gerado para o restante do pacote (copiado só no GATE-11).");
}

if (import.meta.main) {
  await main();
}
