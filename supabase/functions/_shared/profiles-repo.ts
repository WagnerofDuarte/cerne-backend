// Módulo `profiles-repo` — gap-fill da Fase 3.
//
// `profiles.server_revision` é um contador monotônico *por usuário*
// ("sobe a cada escrita nas entradas do usuário", Seção 5), incrementado
// pelo trigger `bump_server_revision` (T-014) — insumo do selo de
// sincronização RF07 e do header `X-Data-Version` (§3.3).
//
// Lacuna real do documento-fonte, registrada aqui (revisar com o Wagner se
// a leitura não for essa): a Seção 8.2 lista `serverRevision` como campo
// de resposta de `POST /entries` (e, por extensão, de qualquer `Entry`),
// mas a Seção 5 só define a coluna `server_revision` em `profiles` — não
// existe em `entries`. A leitura adotada: cada `Entry` da API reporta o
// valor *atual* de `profiles.server_revision` do dono no momento da
// resposta, não um valor gravado na própria linha. `GET /auth/session`
// (T-034) e todo endpoint de `entries` (T-035–T-040) usam a mesma leitura.

import type { DbClient } from "./db.ts";
import { throwError } from "./errors.ts";

export async function fetchServerRevision(db: DbClient, userId: string): Promise<number> {
  const { data, error } = await db
    .from("profiles")
    .select("server_revision")
    .eq("id", userId)
    .single();
  // Não deveria acontecer para um usuário autenticado de verdade — o
  // trigger `on_auth_user_created` (T-012) garante uma linha em
  // `profiles` para todo `auth.users`. Caminho defensivo.
  if (error || !data) {
    throwError("NOT_FOUND", "perfil do usuário autenticado não encontrado");
  }
  return data.server_revision as number;
}

/**
 * Persona atual do perfil (Fase 4, T-045) — "persona congelada no início
 * da conversa" (Contexto Geral §5): lida uma vez, na criação da sessão de
 * chat, e gravada em `chat_sessions.persona_snapshot`; trocar a persona
 * do perfil depois não afeta conversas já existentes (mantém a impressão
 * digital do cache estável mesmo se o usuário trocar de persona).
 */
export async function fetchPersona(
  db: DbClient,
  userId: string,
): Promise<"analitico" | "empatico" | "socratico"> {
  const { data, error } = await db
    .from("profiles")
    .select("persona")
    .eq("id", userId)
    .single();
  if (error || !data) {
    throwError("NOT_FOUND", "perfil do usuário autenticado não encontrado");
  }
  return data.persona as "analitico" | "empatico" | "socratico";
}
