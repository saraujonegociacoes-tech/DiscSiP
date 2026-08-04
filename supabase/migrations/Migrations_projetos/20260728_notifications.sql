-- ============================================================================
-- 20260728_notifications.sql — Feed de notificacoes in-app (menções em comentários)
-- ----------------------------------------------------------------------------
-- Primeira infra de notificacao in-app do Blue Desk. Nasce generica (coluna
-- `type`) mas hoje so alimenta o tipo 'mention': quando alguem escreve @fulano
-- num comentario de tarefa, fulano recebe uma notificacao.
--
--   • Tabela public.notifications, uma linha por destinatario (user_id).
--   • Campos de exibicao denormalizados (actor_name/project_name/task_title/
--     preview): o payload do Realtime ja chega completo p/ o card + notificacao
--     do SO, sem precisar de join no cliente. Sao um snapshot no momento da menção.
--   • RLS: cada um so LE/ATUALIZA/APAGA as proprias (user_id = auth.uid()). Nao ha
--     policy de INSERT p/ usuarios — quem cria e a RPC SECURITY DEFINER abaixo.
--   • RPC monday_notify_mentions(comment_id, mentioned[]): so o autor do comentario
--     dispara; insere 1 linha por mencionado que TAMBEM pode acessar a tarefa
--     (membro do projeto ou gerencia) e != autor. Reusa o mesmo criterio de acesso
--     de can_access_monday_task (20260727_monday_gerencia_access.sql), porém checado
--     por-mencionado (o helper padrão checa o auth.uid(), aqui checamos cada alvo).
--   • Realtime: a tabela entra na publicacao supabase_realtime no fim (idempotente),
--     entao APLICAR ESTA MIGRATION JA LIGA o tempo real (sem passo manual extra).
--
-- Depende de: 20260723d_monday.sql, 20260727_monday_gerencia_access.sql e
--             20260727b_monday_task_comments.sql.
-- IDEMPOTENTE: pode ser reaplicada com seguranca.
-- ============================================================================

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  type         text not null default 'mention',
  actor_id     uuid references auth.users (id) on delete set null,
  actor_name   text,
  project_id   uuid references public.monday_projects (id) on delete cascade,
  project_name text,
  task_id      uuid references public.monday_tasks (id) on delete cascade,
  task_title   text,
  comment_id   uuid references public.monday_task_comments (id) on delete cascade,
  preview      text,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists idx_notifications_user
  on public.notifications (user_id, created_at desc);
create index if not exists idx_notifications_user_unread
  on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;

-- Cada usuario so ve as proprias (vale tambem para o Realtime).
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

-- Marcar como lida (read_at) — so as proprias.
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Descartar as proprias.
drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete to authenticated
  using (user_id = auth.uid());

-- Sem policy de INSERT: usuarios nao inserem direto; a RPC SECURITY DEFINER cria.

-- ─── RPC: cria notificacoes de mencao para um comentario ────────────────────
-- Chamada pela server action addTaskComment depois de inserir o comentario.
-- Retorna quantas notificacoes foram criadas.
create or replace function public.monday_notify_mentions(
  p_comment_id uuid,
  p_mentioned  uuid[]
)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_task_id    uuid;
  v_author     uuid;
  v_body       text;
  v_project_id uuid;
  v_project    text;
  v_task_title text;
  v_actor_name text;
  v_count      integer;
begin
  if p_mentioned is null or array_length(p_mentioned, 1) is null then
    return 0;
  end if;

  -- Dados do comentario + tarefa/projeto numa unica leitura.
  select c.task_id, c.author_id, c.body, b.project_id, pr.name, t.title
    into v_task_id, v_author, v_body, v_project_id, v_project, v_task_title
  from public.monday_task_comments c
  join public.monday_tasks t     on t.id = c.task_id
  join public.monday_boards b    on b.id = t.board_id
  join public.monday_projects pr on pr.id = b.project_id
  where c.id = p_comment_id;

  if v_task_id is null then
    return 0;  -- comentario inexistente
  end if;

  -- Defesa: so o autor do proprio comentario dispara as notificacoes dele.
  if v_author is null or v_author <> auth.uid() then
    return 0;
  end if;

  select p.name into v_actor_name from public.profiles p where p.id = v_author;

  -- Insere 1 por mencionado (distinto) que pode acessar a tarefa e != autor.
  insert into public.notifications
    (user_id, type, actor_id, actor_name, project_id, project_name,
     task_id, task_title, comment_id, preview)
  select
    m.uid, 'mention', v_author, v_actor_name, v_project_id, v_project,
    v_task_id, v_task_title, p_comment_id, left(v_body, 280)
  from (select distinct unnest(p_mentioned) as uid) m
  where m.uid <> v_author
    and (
      -- gerencia enxerga todos os projetos
      exists (
        select 1 from public.profiles p
        where p.id = m.uid and p.role in ('manager', 'admin')
      )
      -- ou e membro do projeto dono da tarefa
      or exists (
        select 1 from public.monday_project_members pm
        where pm.project_id = v_project_id and pm.user_id = m.uid
      )
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.monday_notify_mentions(uuid, uuid[]) to authenticated;

-- ─── Realtime: entra na publicacao (idempotente) ────────────────────────────
-- Aplicar esta migration ja habilita o tempo real da tabela.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
