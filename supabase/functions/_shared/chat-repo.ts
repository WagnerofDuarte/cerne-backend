// Módulo `chat-repo` — gap-fill da Fase 4, mesmo espírito de
// `entries-repo.ts` (Fase 3): leitura/escrita de `chat_sessions` e
// `chat_messages` compartilhada por `chat-sessions-create`/`.list`
// (T-045), `chat-messages-list`/`.send`/`.retry` (T-045/046/048) e
// `chat-insight-create` (T-050) — sem um módulo central, cada endpoint
// reescreveria a mesma consulta de forma divergente.
//
// Nota sobre `updated_at`/`title` de `chat_sessions`: a migração 0003
// (T-013) só tem trigger para `user_message_count`/`last_user_message_at`
// — o próprio comentário da migração deixa explícito que título e
// `updated_at` são "responsabilidade do endpoint (Fase 4)". Este módulo
// expõe `touchSession`/`setSessionTitleIfEmpty` para isso.

import type { DbClient } from "./db.ts";

export type Persona = "analitico" | "empatico" | "socratico";
export type MessageRole = "user" | "assistant";
export type MessageStatus = "streaming" | "complete" | "failed";

export interface ChatSessionRow {
  readonly id: string;
  readonly user_id: string;
  readonly title: string;
  readonly persona_snapshot: Persona;
  readonly user_message_count: number;
  readonly last_user_message_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ChatMessageRow {
  readonly id: string;
  readonly session_id: string;
  readonly user_id: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly seq: number;
  readonly status: MessageStatus;
  readonly retry_count: number;
  readonly created_at: string;
}

const SESSION_COLUMNS =
  "id, user_id, title, persona_snapshot, user_message_count, last_user_message_at, created_at, updated_at";
const MESSAGE_COLUMNS =
  "id, session_id, user_id, role, content, seq, status, retry_count, created_at";

// --- Sessões (T-045) ------------------------------------------------------

export async function createChatSession(
  db: DbClient,
  args: { userId: string; personaSnapshot: Persona; title?: string },
): Promise<ChatSessionRow> {
  const { data, error } = await db
    .from("chat_sessions")
    .insert({
      user_id: args.userId,
      persona_snapshot: args.personaSnapshot,
      title: args.title ?? "",
    })
    .select(SESSION_COLUMNS)
    .single();
  if (error) throw error;
  return data as ChatSessionRow;
}

/** `null` se a sessão não existe ou pertence a outro usuário (RLS já filtra; a checagem explícita por `user_id` só torna a intenção óbvia para quem lê). */
export async function findChatSessionById(
  db: DbClient,
  args: { userId: string; sessionId: string },
): Promise<ChatSessionRow | null> {
  const { data, error } = await db
    .from("chat_sessions")
    .select(SESSION_COLUMNS)
    .eq("user_id", args.userId)
    .eq("id", args.sessionId)
    .maybeSingle();
  if (error) throw error;
  return data as ChatSessionRow | null;
}

export interface ChatSessionsCursor {
  readonly updatedAt: string;
  readonly id: string;
}

export interface ListChatSessionsArgs {
  readonly userId: string;
  /** Busca `limit + 1` de propósito (mesmo padrão de `listEntries`) — este é o limite pedido pelo cliente, já sem o "+1". */
  readonly limit: number;
  readonly cursor: ChatSessionsCursor | null;
}

/** Paginação por keyset — mesma ordenação da consulta (`updated_at DESC, id ASC`, §8.3) usada para decidir "depois do cursor". */
export async function listChatSessions(
  db: DbClient,
  args: ListChatSessionsArgs,
): Promise<ChatSessionRow[]> {
  let query = db.from("chat_sessions").select(SESSION_COLUMNS).eq("user_id", args.userId);

  if (args.cursor) {
    const { updatedAt, id } = args.cursor;
    query = query.or(`updated_at.lt.${updatedAt},and(updated_at.eq.${updatedAt},id.gt.${id})`);
  }

  const { data, error } = await query
    .order("updated_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(args.limit + 1);
  if (error) throw error;
  return (data ?? []) as ChatSessionRow[];
}

/** Só grava se o título ainda estiver vazio — nunca sobrescreve um título já definido (proteção contra uma 2ª chamada tardia, ex.: retry). */
export async function setSessionTitleIfEmpty(
  db: DbClient,
  args: { sessionId: string; title: string },
): Promise<void> {
  const { error } = await db
    .from("chat_sessions")
    .update({ title: args.title })
    .eq("id", args.sessionId)
    .eq("title", "");
  if (error) throw error;
}

/** `updated_at` não tem trigger (nota da migração 0003) — o endpoint que grava atividade na sessão (T-046) é quem atualiza isso, sempre com o `now()` da requisição (respeita `X-Test-Now`, nunca `new Date()` direto). */
export async function touchSessionUpdatedAt(
  db: DbClient,
  args: { sessionId: string; updatedAt: string },
): Promise<void> {
  const { error } = await db
    .from("chat_sessions")
    .update({ updated_at: args.updatedAt })
    .eq("id", args.sessionId);
  if (error) throw error;
}

// --- Mensagens (T-045/046/048) ---------------------------------------------

/** Ordenação `seq ASC` (§8.3) — RLS já garante que só vêm mensagens do dono; o filtro por `session_id` é quem restringe a uma conversa. */
export async function listChatMessages(
  db: DbClient,
  args: { sessionId: string },
): Promise<ChatMessageRow[]> {
  const { data, error } = await db
    .from("chat_messages")
    .select(MESSAGE_COLUMNS)
    .eq("session_id", args.sessionId)
    .order("seq", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ChatMessageRow[];
}

/**
 * Próximo `seq` livre da sessão. Duas viagens ao banco (buscar o máximo,
 * depois inserir) em vez de uma função SQL atômica — simplificação aceita
 * de propósito: sem idempotência de mensagens de chat (diferente de
 * `entries`, RF10/D4), o cenário de concorrência real seria duas
 * requisições simultâneas na mesma sessão, algo que o app cliente (um
 * único campo de texto, sem múltiplas abas) não produz na prática. Se
 * isso um dia importar, o índice `chat_messages_session_seq_uniq`
 * (migração 0003) ainda protege contra duplicar um `seq` — a pior
 * consequência de uma corrida real é um erro de inserção, não uma
 * mensagem corrompida.
 */
export async function nextSeq(db: DbClient, sessionId: string): Promise<number> {
  const { data, error } = await db
    .from("chat_messages")
    .select("seq")
    .eq("session_id", sessionId)
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return ((data as { seq: number } | null)?.seq ?? 0) + 1;
}

export async function insertMessage(
  db: DbClient,
  args: {
    sessionId: string;
    userId: string;
    role: MessageRole;
    content: string;
    seq: number;
    status: MessageStatus;
  },
): Promise<ChatMessageRow> {
  const { data, error } = await db
    .from("chat_messages")
    .insert({
      session_id: args.sessionId,
      user_id: args.userId,
      role: args.role,
      content: args.content,
      seq: args.seq,
      status: args.status,
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error) throw error;
  return data as ChatMessageRow;
}

export async function updateMessage(
  db: DbClient,
  args: { messageId: string; content?: string; status?: MessageStatus; retryCount?: number },
): Promise<ChatMessageRow> {
  const patch: Record<string, unknown> = {};
  if (args.content !== undefined) patch.content = args.content;
  if (args.status !== undefined) patch.status = args.status;
  if (args.retryCount !== undefined) patch.retry_count = args.retryCount;

  const { data, error } = await db
    .from("chat_messages")
    .update(patch)
    .eq("id", args.messageId)
    .select(MESSAGE_COLUMNS)
    .single();
  if (error) throw error;
  return data as ChatMessageRow;
}

/** Usado pelo retry (T-048): a mensagem do assistente que responde a um `userMessageId` está sempre no `seq` imediatamente seguinte, dentro da mesma sessão — um par (`user`, `assistant`) por turno, por construção do handler de envio (T-046). */
export async function findMessageBySeq(
  db: DbClient,
  args: { sessionId: string; seq: number },
): Promise<ChatMessageRow | null> {
  const { data, error } = await db
    .from("chat_messages")
    .select(MESSAGE_COLUMNS)
    .eq("session_id", args.sessionId)
    .eq("seq", args.seq)
    .maybeSingle();
  if (error) throw error;
  return data as ChatMessageRow | null;
}

export async function findMessageById(
  db: DbClient,
  args: { sessionId: string; messageId: string },
): Promise<ChatMessageRow | null> {
  const { data, error } = await db
    .from("chat_messages")
    .select(MESSAGE_COLUMNS)
    .eq("session_id", args.sessionId)
    .eq("id", args.messageId)
    .maybeSingle();
  if (error) throw error;
  return data as ChatMessageRow | null;
}

// --- Insights (T-050, RF08) -------------------------------------------

export type InsightTriggerType = "message_count" | "inactivity";
export type InsightStatus = "generating" | "ready" | "failed" | "dismissed";

export interface InsightRow {
  readonly id: string;
  readonly session_id: string;
  readonly user_id: string;
  readonly trigger_type: InsightTriggerType;
  readonly trigger_key: string;
  readonly status: InsightStatus;
  readonly content: string | null;
  readonly error_code: string | null;
  readonly dismissed_at: string | null;
  readonly created_at: string;
}

const INSIGHT_COLUMNS =
  "id, session_id, user_id, trigger_type, trigger_key, status, content, error_code, dismissed_at, created_at";

/** Mesmo SQLSTATE de violação de UNIQUE usado em `entries-repo.ts` (idempotência do RF10). */
const UNIQUE_VIOLATION = "23505";

export interface InsertInsightResult {
  readonly insight: InsightRow;
  readonly alreadyExisted: boolean;
}

/**
 * "Tentar inserir; conflito na UNIQUE → retornar o insight existente"
 * (§8.3) — a UNIQUE `(session_id, trigger_type, trigger_key)` (migração
 * 0006) é quem garante o disparo único do RF08, pelo banco, não pelo
 * código (mesmo espírito de D4/RF10). `alreadyExisted=true` significa
 * "não gerar de novo" — o handler devolve a linha como está, seja qual
 * for o status atual (`generating`/`ready`/`failed`/`dismissed`).
 */
export async function insertInsightIfNotExists(
  db: DbClient,
  args: { sessionId: string; userId: string; triggerType: InsightTriggerType; triggerKey: string },
): Promise<InsertInsightResult> {
  const { data, error } = await db
    .from("insights")
    .insert({
      session_id: args.sessionId,
      user_id: args.userId,
      trigger_type: args.triggerType,
      trigger_key: args.triggerKey,
      status: "generating",
    })
    .select(INSIGHT_COLUMNS)
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      const { data: existing, error: findError } = await db
        .from("insights")
        .select(INSIGHT_COLUMNS)
        .eq("session_id", args.sessionId)
        .eq("trigger_type", args.triggerType)
        .eq("trigger_key", args.triggerKey)
        .single();
      if (findError) throw findError;
      return { insight: existing as InsightRow, alreadyExisted: true };
    }
    throw error;
  }

  return { insight: data as InsightRow, alreadyExisted: false };
}

export async function updateInsightResult(
  db: DbClient,
  args: { insightId: string; status: InsightStatus; content?: string; errorCode?: string },
): Promise<InsightRow> {
  const patch: Record<string, unknown> = { status: args.status };
  if (args.content !== undefined) patch.content = args.content;
  if (args.errorCode !== undefined) patch.error_code = args.errorCode;

  const { data, error } = await db
    .from("insights")
    .update(patch)
    .eq("id", args.insightId)
    .select(INSIGHT_COLUMNS)
    .single();
  if (error) throw error;
  return data as InsightRow;
}
