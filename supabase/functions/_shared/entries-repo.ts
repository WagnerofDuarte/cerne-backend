// Módulo `entries-repo` — gap-fill da Fase 3, mesmo espírito de `db.ts`/
// `deps.ts`: leitura/escrita de `entries` com **tags embutidas** (Seção
// 8.2: "GET /entries com tags embutidas", "evita N+1") compartilhada por
// `entries-create` (T-035), `entries-list` (T-038), `entries-get` (T-039)
// e `entries-search` (T-040) — sem um módulo central, a consulta de join
// com `entry_tags`/`tags` seria escrita de 4 formas divergentes na mesma
// fase.

import type { DbClient } from "./db.ts";

export type EntrySource = "manual" | "audio" | "photo" | "chat";

/** Linha crua do Postgres (mais o embed `entry_tags(tags(...))` do PostgREST) — ainda `snake_case`; a conversão para `camelCase` acontece só na borda da serialização (§3.1), nunca aqui. */
export interface EntryRow {
  readonly id: string;
  readonly user_id: string;
  readonly content: string;
  readonly source: "manual" | "audio" | "photo" | "chat";
  readonly chat_message_id: string | null;
  readonly occurred_at: string;
  readonly embedding_status: "pending" | "ready" | "failed";
  readonly pii_status: "pending" | "clean" | "flagged" | "failed";
  readonly pii_spans: unknown;
  readonly media_duration_seconds: number | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly [key: string]: unknown;
}

interface EntryRowWithEmbeddedTags extends EntryRow {
  readonly entry_tags: ReadonlyArray<{ tags: { id: string; name: string } | null }> | null;
}

const ENTRY_SELECT_WITH_TAGS = "*, entry_tags(tags(id, name))";

/** Linha crua (com o embed do PostgREST) → forma pronta para `buildDataEnvelope` — achata `entry_tags(tags(...))` em `tags: [{id, name}]` (a forma que `tagSchema`, T-026, espera). `serverRevision` não entra aqui — vem de `profiles` (ver `profiles-repo.ts`), não de uma coluna de `entries`. */
export function shapeEntryForApi(row: EntryRowWithEmbeddedTags): Record<string, unknown> {
  const { entry_tags, ...rest } = row;
  return {
    ...rest,
    tags: (entry_tags ?? [])
      .map((et) => et.tags)
      .filter((t): t is { id: string; name: string } => t !== null),
  };
}

export async function findEntryByChatMessageId(
  db: DbClient,
  userId: string,
  chatMessageId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await db
    .from("entries")
    .select(ENTRY_SELECT_WITH_TAGS)
    .eq("user_id", userId)
    .eq("chat_message_id", chatMessageId)
    .maybeSingle();
  if (error) throw error;
  return data ? shapeEntryForApi(data as EntryRowWithEmbeddedTags) : null;
}

export async function findEntryById(
  db: DbClient,
  userId: string,
  entryId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await db
    .from("entries")
    .select(ENTRY_SELECT_WITH_TAGS)
    .eq("user_id", userId)
    .eq("id", entryId)
    .maybeSingle();
  if (error) throw error;
  return data ? shapeEntryForApi(data as EntryRowWithEmbeddedTags) : null;
}

export interface InsertEntryArgs {
  readonly userId: string;
  readonly content: string;
  readonly source: "manual" | "audio" | "photo" | "chat";
  readonly chatMessageId: string | null;
  readonly occurredAt: string | undefined;
  readonly mediaDurationSeconds: number | null;
  readonly piiStatus: "clean" | "flagged";
  readonly piiSpans: ReadonlyArray<{ start: number; end: number; type: string }>;
}

export interface InsertEntryResult {
  readonly entry: Record<string, unknown>;
  readonly idempotentReplay: boolean;
}

/** SQLSTATE de violação de UNIQUE/EXCLUSION — como o PostgREST devolve o `code` de um erro do Postgres. */
const UNIQUE_VIOLATION = "23505";

/**
 * Insere a entrada. Se colidir com `entries_chat_message_uniq` (corrida
 * entre duas requisições idênticas — D4: "garantido pelo banco, não pelo
 * código"), busca e devolve a linha vencedora em vez de propagar o erro.
 * Esta é a garantia final e à prova de corrida; a checagem otimista feita
 * antes desta chamada (passo 2/3 do handler, `findEntryByChatMessageId`)
 * é só uma economia para não gastar uma chamada de PII com Haiku no caso
 * comum de retry — não é ela quem garante D4.
 */
export async function insertEntry(db: DbClient, args: InsertEntryArgs): Promise<InsertEntryResult> {
  const { data, error } = await db
    .from("entries")
    .insert({
      user_id: args.userId,
      content: args.content,
      source: args.source,
      chat_message_id: args.chatMessageId,
      ...(args.occurredAt ? { occurred_at: args.occurredAt } : {}),
      media_duration_seconds: args.mediaDurationSeconds,
      pii_status: args.piiStatus,
      pii_spans: args.piiSpans,
      embedding_status: "pending",
    })
    .select(ENTRY_SELECT_WITH_TAGS)
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION && args.chatMessageId) {
      const existing = await findEntryByChatMessageId(db, args.userId, args.chatMessageId);
      if (existing) return { entry: existing, idempotentReplay: true };
    }
    throw error;
  }

  return { entry: shapeEntryForApi(data as EntryRowWithEmbeddedTags), idempotentReplay: false };
}

export interface MarkEmbeddingReadyArgs {
  readonly embedding: readonly number[];
  readonly model: string;
  readonly dimension: number;
  readonly inputType: string;
}

export async function markEmbeddingReady(
  db: DbClient,
  entryId: string,
  args: MarkEmbeddingReadyArgs,
): Promise<Record<string, unknown>> {
  const { data, error } = await db
    .from("entries")
    .update({
      embedding: args.embedding,
      embedding_model: args.model,
      embedding_dim: args.dimension,
      embedding_input_type: args.inputType,
      embedding_status: "ready",
    })
    .eq("id", entryId)
    .select(ENTRY_SELECT_WITH_TAGS)
    .single();
  if (error) throw error;
  return shapeEntryForApi(data as EntryRowWithEmbeddedTags);
}

// --- GET /entries (T-038) --------------------------------------------------

export interface EntriesCursor {
  readonly occurredAt: string;
  readonly id: string;
}

export interface ListEntriesArgs {
  readonly userId: string;
  /** Busca `limit + 1` de propósito (ver `listEntries`) — este é o limite pedido pelo cliente, já sem o "+1". */
  readonly limit: number;
  readonly cursor: EntriesCursor | null;
  readonly source?: "manual" | "audio" | "photo" | "chat";
  readonly dateFrom?: string;
  readonly dateTo?: string;
}

export interface ListEntriesResult {
  /** Até `limit + 1` linhas — o chamador (handler) decide o corte e o `nextCursor` a partir do tamanho. */
  readonly rows: ReadonlyArray<Record<string, unknown>>;
  /** Total de linhas que batem com os filtros (sem paginação) — Seção 8.2: `meta.total`. */
  readonly total: number;
}

/**
 * Paginação por keyset (não por OFFSET — Seção 3.5, determinismo): a
 * ordenação é sempre `occurred_at DESC, id ASC` (Seção 8.2), então "depois
 * do cursor" significa `occurred_at < cursor.occurredAt` OU (empate exato
 * de `occurred_at` E `id > cursor.id`) — a mesma combinação que o
 * `ORDER BY` usa para desempate. Busca `limit + 1` de propósito: se vier a
 * mais, há próxima página (o handler decide `nextCursor` a partir disso,
 * sem uma 2ª consulta).
 */
export async function listEntries(db: DbClient, args: ListEntriesArgs): Promise<ListEntriesResult> {
  let query = db
    .from("entries")
    .select(ENTRY_SELECT_WITH_TAGS, { count: "exact" })
    .eq("user_id", args.userId);

  if (args.source) query = query.eq("source", args.source);
  if (args.dateFrom) query = query.gte("occurred_at", args.dateFrom);
  if (args.dateTo) query = query.lte("occurred_at", args.dateTo);
  if (args.cursor) {
    // Nem `occurred_at` (ISO 8601) nem `id` (uuid) podem conter `,`/`(`/`)`
    // — seguro para interpolar direto na sintaxe de filtro do PostgREST.
    const { occurredAt, id } = args.cursor;
    query = query.or(`occurred_at.lt.${occurredAt},and(occurred_at.eq.${occurredAt},id.gt.${id})`);
  }

  const { data, error, count } = await query
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(args.limit + 1);

  if (error) throw error;
  const rows = (data ?? []) as EntryRowWithEmbeddedTags[];
  return { rows: rows.map(shapeEntryForApi), total: count ?? 0 };
}

export async function markEmbeddingFailed(
  db: DbClient,
  entryId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await db
    .from("entries")
    .update({ embedding_status: "failed" })
    .eq("id", entryId)
    .select(ENTRY_SELECT_WITH_TAGS)
    .single();
  if (error) throw error;
  return shapeEntryForApi(data as EntryRowWithEmbeddedTags);
}

// --- GET /entries/search (T-040) -------------------------------------------

export interface FilterEntriesArgs {
  readonly userId: string;
  readonly limit: number;
  readonly source?: EntrySource;
  readonly dateFrom?: string;
  readonly dateTo?: string;
}

/** Modo `filter_only` (§8.2: "q ausente ou vazio -> apenas filtros, sem chamar Voyage") — mesma ordenação de `GET /entries`, sem paginação (a busca não pagina, só limita). */
export async function findEntriesByFilters(
  db: DbClient,
  args: FilterEntriesArgs,
): Promise<Record<string, unknown>[]> {
  let query = db.from("entries").select(ENTRY_SELECT_WITH_TAGS).eq("user_id", args.userId);
  if (args.source) query = query.eq("source", args.source);
  if (args.dateFrom) query = query.gte("occurred_at", args.dateFrom);
  if (args.dateTo) query = query.lte("occurred_at", args.dateTo);

  const { data, error } = await query
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(args.limit);
  if (error) throw error;
  return ((data ?? []) as EntryRowWithEmbeddedTags[]).map(shapeEntryForApi);
}

export interface SemanticSearchArgs {
  readonly queryEmbedding: readonly number[];
  readonly limit: number;
  readonly source?: EntrySource;
  readonly dateFrom?: string;
  readonly dateTo?: string;
}

/** Linha da RPC `entries_search_by_embedding` (migração 0011) — já vem com `tags` pronto (jsonb_agg no próprio SQL) e `distance` (cosseno, pgvector `<=>`); `shapeEntryForApi` não se aplica aqui (não há `entry_tags` para achatar). */
export interface SemanticSearchRow extends EntryRow {
  readonly tags: ReadonlyArray<{ id: string; name: string }>;
  readonly distance: number;
}

/**
 * Modo `semantic` (§8.2): varredura exata por distância de cosseno via a
 * RPC `entries_search_by_embedding` (migração 0011) — o construtor de
 * query fluente do PostgREST não ordena por expressão arbitrária, só por
 * coluna, daí a função dedicada. `SECURITY INVOKER`: RLS de `entries`
 * continua valendo, a função nem recebe `user_id`.
 */
export async function searchEntriesByEmbedding(
  db: DbClient,
  args: SemanticSearchArgs,
): Promise<SemanticSearchRow[]> {
  const { data, error } = await db.rpc("entries_search_by_embedding", {
    p_query_embedding: args.queryEmbedding,
    p_source: args.source ?? null,
    p_date_from: args.dateFrom ?? null,
    p_date_to: args.dateTo ?? null,
    p_limit: args.limit,
  });
  if (error) throw error;
  return (data ?? []) as SemanticSearchRow[];
}
