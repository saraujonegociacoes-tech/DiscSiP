-- ============================================================================
-- 20260727b_monday_task_comments.sql — Comentarios por tarefa (modulo Monday)
-- ----------------------------------------------------------------------------
-- Cada tarefa passa a ter uma thread de comentarios. Alimenta:
--   • o dialogo de VISUALIZACAO da tarefa (lista + adicionar comentario);
--   • o preview do ULTIMO comentario no card do board (quem/quando).
-- RLS reusa can_access_monday_task (definido em 20260723d + 20260727), entao a
-- gerencia enxerga tudo e membros veem so os projetos onde estao.
-- Depende de: 20260723d_monday.sql e (recomendado) 20260727_monday_gerencia_access.sql.
-- IDEMPOTENTE: pode ser reaplicada com seguranca.
-- ============================================================================

create table if not exists public.monday_task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.monday_tasks (id) on delete cascade,
  author_id  uuid references auth.users (id) on delete set null,
  body       text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists idx_monday_task_comments_task
  on public.monday_task_comments (task_id, created_at desc);

alter table public.monday_task_comments enable row level security;

-- Le quem acessa a tarefa (membros do projeto ou gerencia).
drop policy if exists monday_task_comments_select on public.monday_task_comments;
create policy monday_task_comments_select on public.monday_task_comments
  for select to authenticated
  using (public.can_access_monday_task(task_id));

-- So comenta como si mesmo, e so em tarefa que acessa.
drop policy if exists monday_task_comments_insert on public.monday_task_comments;
create policy monday_task_comments_insert on public.monday_task_comments
  for insert to authenticated
  with check (author_id = auth.uid() and public.can_access_monday_task(task_id));

-- Apaga so o proprio comentario.
drop policy if exists monday_task_comments_delete on public.monday_task_comments;
create policy monday_task_comments_delete on public.monday_task_comments
  for delete to authenticated
  using (author_id = auth.uid());

-- ─── View: ultimo comentario por tarefa (p/ o preview no card) ───────────────
-- security_invoker => respeita a RLS de monday_task_comments do chamador.
create or replace view public.monday_task_last_comment
with (security_invoker = true) as
select distinct on (c.task_id)
  c.task_id,
  c.id         as comment_id,
  c.body,
  c.author_id,
  c.created_at
from public.monday_task_comments c
order by c.task_id, c.created_at desc;
