-- T-052 — Bucket privado `exports` + política de acesso (Plano técnico §5:
-- "Um bucket privado: exports. Política: o caminho do objeto começa com o
-- user_id do requisitante. Nenhum bucket de imagens (D17).").
--
-- Convenção de caminho adotada aqui (não detalhada no plano técnico além de
-- "começa com o user_id"): `<user_id>/<job_id>/raw.json` e
-- `<user_id>/<job_id>/summary.pdf` — um "diretório" por job dentro do
-- "diretório" do usuário, para os dois arquivos de um mesmo job nunca
-- colidirem de nome entre jobs diferentes do mesmo usuário.
--
-- `storage.objects`/`storage.buckets` são geridas pelo serviço de Storage
-- do Supabase (schema `storage`, análogo a `auth` — infraestrutura que este
-- projeto não versiona via migração de schema, só usa). Igual ao restante
-- do banco, RLS já vem habilitada por padrão nessas tabelas no Supabase; a
-- política abaixo segue a mesma convenção do resto do projeto: uma política
-- por operação, predicado explícito, nada liberado por omissão.

insert into storage.buckets (id, name, public)
values ('exports', 'exports', false)
on conflict (id) do nothing;

-- Mesma convenção paranoica do resto do projeto (D2, migração 0009: "nenhuma
-- tabela exposta por padrão", `REVOKE ALL ... FROM anon` em toda tabela com
-- dono) — aplicada aqui também, mesmo que o bootstrap do próprio serviço de
-- Storage do Supabase já viesse com grants padrão para `anon`/`authenticated`
-- em `storage.objects`. Sem isto, `anon` seria barrado só pela política (RLS
-- devolveria 0 linhas, não erro) — este projeto prefere negação explícita a
-- depender do comportamento padrão de uma peça de infraestrutura que não é
-- deste repositório.
revoke all on storage.objects from anon;

-- `storage.foldername(name)` devolve os segmentos de diretório do caminho
-- do objeto (tudo antes do nome do arquivo) como `text[]` — função utilitária
-- que o próprio Supabase já expõe. `[1]` é o primeiro segmento, que pela
-- convenção acima é sempre o `user_id` de quem gravou.
create policy "exports_select_own"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'exports' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "exports_insert_own"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'exports' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "exports_delete_own"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'exports' and (storage.foldername(name))[1] = auth.uid()::text);

-- Sem política de UPDATE: nenhum fluxo do projeto sobrescreve um objeto já
-- gravado (o worker da fila, T-054, sempre grava um caminho novo por job) —
-- e o worker em si usa `service_role` (regra nº5, "só em workers de fila"),
-- que ignora política de qualquer forma.
