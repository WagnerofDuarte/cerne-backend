// T-026 — Registro dos 23 endpoints (Plano técnico §8).
//
// Ponto único que amarra rota + verbo + autenticação + schemas de
// request/response. Dois consumidores diretos:
//   - `gateway` (T-031): valida corpo/query com o schema daqui antes de
//     chamar o handler.
//   - `scripts/gen-openapi.ts` (T-033): itera este array para gerar
//     `contracts/openapi.yaml`. Mudar um contrato sempre passa por aqui —
//     nunca editar o YAML gerado à mão.

import { z } from "zod";
import * as account from "./account.ts";
import * as auth from "./auth.ts";
import * as chat from "./chat.ts";
import { errorResponseSchema } from "./common.ts";
import * as dashboard from "./dashboard.ts";
import * as entries from "./entries.ts";
import * as exportContracts from "./export.ts";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface JsonResponse {
  readonly kind: "json";
  readonly status: number;
  readonly schema: z.ZodTypeAny;
}

/** Streaming SSE (D12) — `POST .../messages` e `.../retry`. Sem corpo JSON único a validar. */
export interface SseResponse {
  readonly kind: "sse";
}

/** 302 para URL assinada do Storage — `GET /export/:jobId/download`. Sem corpo JSON. */
export interface RedirectResponse {
  readonly kind: "redirect";
}

export interface EndpointContract {
  readonly id: string;
  readonly method: HttpMethod;
  /** Caminho com placeholders `:nome`, casando com a notação do plano técnico. */
  readonly path: string;
  readonly summary: string;
  /** false só nos 3 endpoints de auth que ainda não têm sessão (signup/login/refresh). */
  readonly auth: boolean;
  readonly requestBody?: z.ZodTypeAny;
  readonly requestQuery?: z.ZodTypeAny;
  readonly response: JsonResponse | SseResponse | RedirectResponse;
}

function json(status: number, schema: z.ZodTypeAny): JsonResponse {
  return { kind: "json", status, schema };
}

export const ENDPOINTS: readonly EndpointContract[] = [
  // --- Autenticação (5) — §8.1 --------------------------------------------
  {
    id: "auth.signup",
    method: "POST",
    path: "/auth/signup",
    summary: "Cadastro — proxy fino do GoTrue",
    auth: false,
    requestBody: auth.signupRequestSchema,
    response: json(200, auth.signupResponseSchema),
  },
  {
    id: "auth.login",
    method: "POST",
    path: "/auth/login",
    summary: "Login — proxy fino do GoTrue",
    auth: false,
    requestBody: auth.loginRequestSchema,
    response: json(200, auth.loginResponseSchema),
  },
  {
    id: "auth.refresh",
    method: "POST",
    path: "/auth/refresh",
    summary: "Refresh de token — proxy fino do GoTrue",
    auth: false,
    requestBody: auth.refreshRequestSchema,
    response: json(200, auth.refreshResponseSchema),
  },
  {
    id: "auth.session",
    method: "GET",
    path: "/auth/session",
    summary: "Sessão atual — único endpoint de auth com lógica própria",
    auth: true,
    response: json(200, auth.getSessionResponseSchema),
  },
  {
    id: "auth.logout",
    method: "POST",
    path: "/auth/logout",
    summary: "Logout — proxy fino do GoTrue",
    auth: true,
    response: json(200, auth.logoutResponseSchema),
  },

  // --- Entradas (5) — §8.2 -------------------------------------------------
  {
    id: "entries.create",
    method: "POST",
    path: "/entries",
    summary: "Criar entrada (PII → gravação → embedding, com idempotência RF10)",
    auth: true,
    requestBody: entries.createEntryRequestSchema,
    response: json(200, entries.createEntryResponseSchema),
  },
  {
    id: "entries.list",
    method: "GET",
    path: "/entries",
    summary: "Listar entradas, paginado, com tags embutidas",
    auth: true,
    requestQuery: entries.listEntriesQuerySchema,
    response: json(200, entries.listEntriesResponseSchema),
  },
  {
    id: "entries.get",
    method: "GET",
    path: "/entries/:id",
    summary: "Buscar uma entrada por id",
    auth: true,
    response: json(200, entries.getEntryResponseSchema),
  },
  {
    id: "entries.search",
    method: "GET",
    path: "/entries/search",
    summary: "Busca semântica + filtros (AND), sem throttle no servidor",
    auth: true,
    requestQuery: entries.searchEntriesQuerySchema,
    response: json(200, entries.searchEntriesResponseSchema),
  },
  {
    id: "media.ocr",
    method: "POST",
    path: "/media/ocr",
    summary: "OCR de imagem — imagem nunca é persistida",
    auth: true,
    requestBody: entries.ocrRequestSchema,
    response: json(200, entries.ocrResponseSchema),
  },

  // --- Chat (6) — §8.3 -------------------------------------------------
  {
    id: "chat.sessions.create",
    method: "POST",
    path: "/chat/sessions",
    summary: "Criar sessão de chat (persona congelada do perfil)",
    auth: true,
    requestBody: chat.createChatSessionRequestSchema,
    response: json(200, chat.createChatSessionResponseSchema),
  },
  {
    id: "chat.sessions.list",
    method: "GET",
    path: "/chat/sessions",
    summary: "Listar sessões de chat",
    auth: true,
    requestQuery: chat.listChatSessionsQuerySchema,
    response: json(200, chat.listChatSessionsResponseSchema),
  },
  {
    id: "chat.messages.list",
    method: "GET",
    path: "/chat/sessions/:id/messages",
    summary: "Listar mensagens de uma sessão, ordenadas por seq",
    auth: true,
    response: json(200, chat.listChatMessagesResponseSchema),
  },
  {
    id: "chat.messages.send",
    method: "POST",
    path: "/chat/sessions/:id/messages",
    summary: "Enviar mensagem — resposta em streaming SSE (D12)",
    auth: true,
    requestBody: chat.sendChatMessageRequestSchema,
    response: { kind: "sse" },
  },
  {
    id: "chat.messages.retry",
    method: "POST",
    path: "/chat/sessions/:id/messages/:userMessageId/retry",
    summary: "Regenerar a última resposta — mesma impressão digital de cache (D15)",
    auth: true,
    requestBody: chat.retryChatMessageRequestSchema,
    response: { kind: "sse" },
  },
  {
    id: "chat.insight.create",
    method: "POST",
    path: "/chat/sessions/:id/insight",
    summary: "Gerar insight — nunca erro HTTP, falha vira status='failed' (RF08)",
    auth: true,
    requestBody: chat.createInsightRequestSchema,
    response: json(200, chat.createInsightResponseSchema),
  },

  // --- Exportação (3) — §8.4 -------------------------------------------
  {
    id: "export.summary.create",
    method: "POST",
    path: "/export/summary",
    summary: "Solicitar exportação — contagem síncrona, enfileira job",
    auth: true,
    requestBody: exportContracts.createExportRequestSchema,
    response: json(202, exportContracts.createExportResponseSchema),
  },
  {
    id: "export.status.get",
    method: "GET",
    path: "/export/:jobId/status",
    summary: "Status do job de exportação (dados e narrativa independentes)",
    auth: true,
    response: json(200, exportContracts.exportJobStatusResponseSchema),
  },
  {
    id: "export.download.get",
    method: "GET",
    path: "/export/:jobId/download",
    summary: "Download — 302 para URL assinada, PDF com fallback para bruto",
    auth: true,
    requestQuery: exportContracts.downloadExportQuerySchema,
    response: { kind: "redirect" },
  },

  // --- Dashboard (2) — §8.5 -------------------------------------------
  {
    id: "dashboard.aggregate.get",
    method: "GET",
    path: "/dashboard/aggregate",
    summary: "Agregado do período — sempre 200, inclusive com zero entradas",
    auth: true,
    requestQuery: dashboard.dashboardAggregateQuerySchema,
    response: json(200, dashboard.dashboardAggregateResponseSchema),
  },
  {
    id: "dashboard.narrative.get",
    method: "GET",
    path: "/dashboard/narrative",
    summary: "Narrativa do período — independente do agregado",
    auth: true,
    requestQuery: dashboard.dashboardNarrativeQuerySchema,
    response: json(200, dashboard.dashboardNarrativeResponseSchema),
  },

  // --- Conta (2) — §8.6 -------------------------------------------------
  {
    id: "account.settings.update",
    method: "PATCH",
    path: "/account/settings",
    summary: "Atualizar nome/persona/biometria — email é rejeitado",
    auth: true,
    requestBody: account.updateAccountSettingsRequestSchema,
    response: json(200, account.updateAccountSettingsResponseSchema),
  },
  {
    id: "account.delete",
    method: "DELETE",
    path: "/account",
    summary: "Apagamento hard, em cascata, com purga do bucket exports",
    auth: true,
    requestBody: account.deleteAccountRequestSchema,
    response: json(200, account.deleteAccountResponseSchema),
  },
] as const;

// Resposta de erro — mesmo schema para qualquer um dos 23 endpoints (§3.2).
export { errorResponseSchema };
