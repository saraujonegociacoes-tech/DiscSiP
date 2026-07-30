-- ============================================================================
-- 20260723d_monday.sql — Modulo Monday (tarefas/sprints) dentro do Blue Line
-- Porta o app isolado blueline-monday para o schema do Blue Line:
--   • TODAS as tabelas/views/funcoes com prefixo monday_ (nao colidem com o CRM);
--   • REUSA o profiles do Blue Line (nao cria profiles nem trigger de signup);
--   • RLS-first por membership (monday_project_members), helpers SECURITY DEFINER.
-- IDEMPOTENTE: pode ser reaplicada com seguranca (aplicada a mao no Supabase).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ─── Helper: updated_at automatico (namespaced p/ nao mexer em funcao do Blue Line)
create or replace function public.monday_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ─── monday_projects ────────────────────────────────────────────────────────
create table if not exists public.monday_projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 120),
  key         text not null check (key ~ '^[A-Z][A-Z0-9]{1,9}$'),
  description text,
  color       text not null default '#3B82F6',
  owner_id    uuid not null references auth.users (id) on delete cascade,
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_monday_projects_updated_at on public.monday_projects;
create trigger trg_monday_projects_updated_at
  before update on public.monday_projects
  for each row execute function public.monday_set_updated_at();

-- ─── monday_project_members ─────────────────────────────────────────────────
create table if not exists public.monday_project_members (
  project_id uuid not null references public.monday_projects (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null default 'member' check (role in ('owner','admin','member','viewer')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists idx_monday_members_user on public.monday_project_members (user_id);

-- Adiciona o dono como membro 'owner' automaticamente
create or replace function public.handle_new_monday_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.monday_project_members (project_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (project_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_monday_project_created on public.monday_projects;
create trigger on_monday_project_created
  after insert on public.monday_projects
  for each row execute function public.handle_new_monday_project();

-- ─── boards / groups / sprints / tasks / tags ───────────────────────────────
create table if not exists public.monday_boards (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.monday_projects (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  description text,
  position    double precision not null default 1000,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_monday_boards_project on public.monday_boards (project_id);

drop trigger if exists trg_monday_boards_updated_at on public.monday_boards;
create trigger trg_monday_boards_updated_at
  before update on public.monday_boards
  for each row execute function public.monday_set_updated_at();

create table if not exists public.monday_groups (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references public.monday_boards (id) on delete cascade,
  name       text not null default 'Novo grupo',
  color      text not null default '#579BFC',
  position   double precision not null default 1000,
  created_at timestamptz not null default now()
);
create index if not exists idx_monday_groups_board on public.monday_groups (board_id);

create table if not exists public.monday_sprints (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.monday_projects (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 120),
  goal       text,
  status     text not null default 'planned' check (status in ('planned','active','completed')),
  start_date date,
  end_date   date,
  position   double precision not null default 1000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_monday_sprints_project on public.monday_sprints (project_id);

drop trigger if exists trg_monday_sprints_updated_at on public.monday_sprints;
create trigger trg_monday_sprints_updated_at
  before update on public.monday_sprints
  for each row execute function public.monday_set_updated_at();

create table if not exists public.monday_tasks (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.monday_boards (id) on delete cascade,
  group_id    uuid references public.monday_groups (id) on delete set null,
  sprint_id   uuid references public.monday_sprints (id) on delete set null,
  title       text not null check (char_length(title) between 1 and 500),
  description text,
  status      text not null default 'todo'   check (status in ('todo','working','review','done','stuck')),
  priority    text not null default 'medium' check (priority in ('low','medium','high','critical')),
  assignee_id uuid references auth.users (id) on delete set null,
  estimate    numeric(6,2),                 -- story points
  start_date  date,
  due_date    date,
  position    double precision not null default 1000,
  archived    boolean not null default false,
  created_by  uuid references auth.users (id) on delete set null,
  completed_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_monday_tasks_board    on public.monday_tasks (board_id);
create index if not exists idx_monday_tasks_group    on public.monday_tasks (group_id);
create index if not exists idx_monday_tasks_sprint   on public.monday_tasks (sprint_id);
create index if not exists idx_monday_tasks_assignee on public.monday_tasks (assignee_id);
create index if not exists idx_monday_tasks_status   on public.monday_tasks (board_id, status);

drop trigger if exists trg_monday_tasks_updated_at on public.monday_tasks;
create trigger trg_monday_tasks_updated_at
  before update on public.monday_tasks
  for each row execute function public.monday_set_updated_at();

create table if not exists public.monday_tags (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.monday_projects (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 40),
  color      text not null default '#A25DDC',
  created_at timestamptz not null default now(),
  unique (project_id, name)
);
create index if not exists idx_monday_tags_project on public.monday_tags (project_id);

create table if not exists public.monday_task_tags (
  task_id uuid not null references public.monday_tasks (id) on delete cascade,
  tag_id  uuid not null references public.monday_tags (id) on delete cascade,
  primary key (task_id, tag_id)
);

-- ─── Helpers de acesso (SECURITY DEFINER evita recursao de RLS) ──────────────
create or replace function public.is_monday_project_member(p_project uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.monday_project_members pm
    where pm.project_id = p_project and pm.user_id = auth.uid()
  );
$$;

create or replace function public.monday_project_role(p_project uuid)
returns text language sql security definer set search_path = public stable as $$
  select pm.role from public.monday_project_members pm
  where pm.project_id = p_project and pm.user_id = auth.uid();
$$;

create or replace function public.can_manage_monday_project(p_project uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.monday_project_role(p_project) in ('owner','admin');
$$;

create or replace function public.can_access_monday_board(p_board uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.monday_boards b
    join public.monday_project_members pm on pm.project_id = b.project_id
    where b.id = p_board and pm.user_id = auth.uid()
  );
$$;

create or replace function public.can_access_monday_task(p_task uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.monday_tasks t
    join public.monday_boards b on b.id = t.board_id
    join public.monday_project_members pm on pm.project_id = b.project_id
    where t.id = p_task and pm.user_id = auth.uid()
  );
$$;

-- ─── RLS ────────────────────────────────────────────────────────────────────
alter table public.monday_projects        enable row level security;
alter table public.monday_project_members enable row level security;
alter table public.monday_boards          enable row level security;
alter table public.monday_groups          enable row level security;
alter table public.monday_sprints         enable row level security;
alter table public.monday_tasks           enable row level security;
alter table public.monday_tags            enable row level security;
alter table public.monday_task_tags       enable row level security;

-- projects: membros leem; dono cria; admins/owner editam; owner apaga
drop policy if exists monday_projects_select on public.monday_projects;
create policy monday_projects_select on public.monday_projects
  for select to authenticated using (public.is_monday_project_member(id));
drop policy if exists monday_projects_insert on public.monday_projects;
create policy monday_projects_insert on public.monday_projects
  for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists monday_projects_update on public.monday_projects;
create policy monday_projects_update on public.monday_projects
  for update to authenticated using (public.can_manage_monday_project(id)) with check (public.can_manage_monday_project(id));
drop policy if exists monday_projects_delete on public.monday_projects;
create policy monday_projects_delete on public.monday_projects
  for delete to authenticated using (public.monday_project_role(id) = 'owner');

-- project_members
drop policy if exists monday_members_select on public.monday_project_members;
create policy monday_members_select on public.monday_project_members
  for select to authenticated using (public.is_monday_project_member(project_id));
drop policy if exists monday_members_insert on public.monday_project_members;
create policy monday_members_insert on public.monday_project_members
  for insert to authenticated with check (public.can_manage_monday_project(project_id));
drop policy if exists monday_members_update on public.monday_project_members;
create policy monday_members_update on public.monday_project_members
  for update to authenticated using (public.can_manage_monday_project(project_id)) with check (public.can_manage_monday_project(project_id));
drop policy if exists monday_members_delete on public.monday_project_members;
create policy monday_members_delete on public.monday_project_members
  for delete to authenticated using (public.can_manage_monday_project(project_id) or user_id = auth.uid());

-- boards / sprints / tags (via project) e groups / tasks / task_tags (via board/task)
drop policy if exists monday_boards_rw on public.monday_boards;
create policy monday_boards_rw on public.monday_boards
  for all to authenticated using (public.is_monday_project_member(project_id)) with check (public.is_monday_project_member(project_id));

drop policy if exists monday_groups_rw on public.monday_groups;
create policy monday_groups_rw on public.monday_groups
  for all to authenticated using (public.can_access_monday_board(board_id)) with check (public.can_access_monday_board(board_id));

drop policy if exists monday_sprints_rw on public.monday_sprints;
create policy monday_sprints_rw on public.monday_sprints
  for all to authenticated using (public.is_monday_project_member(project_id)) with check (public.is_monday_project_member(project_id));

drop policy if exists monday_tasks_rw on public.monday_tasks;
create policy monday_tasks_rw on public.monday_tasks
  for all to authenticated using (public.can_access_monday_board(board_id)) with check (public.can_access_monday_board(board_id));

drop policy if exists monday_tags_rw on public.monday_tags;
create policy monday_tags_rw on public.monday_tags
  for all to authenticated using (public.is_monday_project_member(project_id)) with check (public.is_monday_project_member(project_id));

drop policy if exists monday_task_tags_rw on public.monday_task_tags;
create policy monday_task_tags_rw on public.monday_task_tags
  for all to authenticated using (public.can_access_monday_task(task_id)) with check (public.can_access_monday_task(task_id));

-- ─── completed_at automatico (habilita burndown historico) ──────────────────
create or replace function public.monday_sync_task_completed_at()
returns trigger language plpgsql as $$
begin
  if new.status = 'done' and (old.status is distinct from 'done') then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_monday_tasks_completed_at on public.monday_tasks;
create trigger trg_monday_tasks_completed_at
  before insert or update of status on public.monday_tasks
  for each row execute function public.monday_sync_task_completed_at();

-- ─── Views agregadas (security_invoker => respeitam a RLS do chamador) ───────
create or replace view public.monday_project_overview
with (security_invoker = true) as
select
  p.id                                                          as project_id,
  count(t.id)                                                   as total_tasks,
  count(t.id) filter (where t.status = 'done')                  as done_tasks,
  count(t.id) filter (where t.status = 'working')               as working_tasks,
  count(t.id) filter (where t.status = 'stuck')                 as stuck_tasks,
  count(distinct b.id)                                          as board_count,
  coalesce(sum(t.estimate), 0)                                  as total_points,
  coalesce(sum(t.estimate) filter (where t.status = 'done'), 0) as done_points
from public.monday_projects p
left join public.monday_boards b on b.project_id = p.id
left join public.monday_tasks  t on t.board_id = b.id and t.archived = false
group by p.id;

create or replace view public.monday_sprint_stats
with (security_invoker = true) as
select
  s.id                                                          as sprint_id,
  s.project_id                                                  as project_id,
  count(t.id)                                                   as total_tasks,
  count(t.id) filter (where t.status = 'done')                  as done_tasks,
  coalesce(sum(t.estimate), 0)                                  as total_points,
  coalesce(sum(t.estimate) filter (where t.status = 'done'), 0) as done_points
from public.monday_sprints s
left join public.monday_tasks t on t.sprint_id = s.id and t.archived = false
group by s.id, s.project_id;

-- ─── RPC: burndown historico de um sprint ───────────────────────────────────
create or replace function public.monday_sprint_burndown(p_sprint uuid)
returns table (day date, ideal numeric, remaining numeric)
language sql stable set search_path = public as $$
  with s as (
    select start_date, end_date from public.monday_sprints where id = p_sprint
  ),
  bounds as (
    select
      coalesce(s.start_date, current_date)             as sd,
      coalesce(s.end_date, s.start_date, current_date) as ed
    from s
  ),
  total as (
    select coalesce(sum(estimate), 0)::numeric as pts
    from public.monday_tasks
    where sprint_id = p_sprint and archived = false
  ),
  days as (
    select gs::date as day, b.sd, b.ed
    from bounds b, generate_series(b.sd, b.ed, interval '1 day') gs
  )
  select
    d.day,
    round(t.pts * (1 - (d.day - d.sd)::numeric / nullif((d.ed - d.sd), 0)), 2) as ideal,
    case when d.day <= current_date then
      t.pts - coalesce((
        select sum(tk.estimate)
        from public.monday_tasks tk
        where tk.sprint_id = p_sprint
          and tk.archived = false
          and tk.completed_at is not null
          and tk.completed_at::date <= d.day
      ), 0)
    else null end as remaining
  from days d cross join total t
  order by d.day;
$$;

grant execute on function public.monday_sprint_burndown(uuid) to authenticated;

-- ─── RPC: popular projeto demo para o usuario atual ─────────────────────────
create or replace function public.monday_seed_demo()
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_project uuid;
  v_board   uuid;
  g_todo    uuid;
  g_prog    uuid;
  g_done    uuid;
  v_sprint  uuid;
begin
  if v_uid is null then
    raise exception 'Nao autenticado';
  end if;

  -- Reaproveita o demo se ja existir
  select id into v_project
  from public.monday_projects
  where owner_id = v_uid and key = 'DEMO'
  limit 1;
  if v_project is not null then
    return v_project;
  end if;

  insert into public.monday_projects (name, key, description, color, owner_id)
  values ('Projeto Demo', 'DEMO', 'Projeto de exemplo gerado automaticamente.', '#3B82F6', v_uid)
  returning id into v_project;

  insert into public.monday_boards (project_id, name, description, position)
  values (v_project, 'Desenvolvimento', 'Board principal de desenvolvimento', 1000)
  returning id into v_board;

  insert into public.monday_groups (board_id, name, color, position) values
    (v_board, 'A fazer',  '#579BFC', 1000) returning id into g_todo;
  insert into public.monday_groups (board_id, name, color, position) values
    (v_board, 'Em progresso', '#FDAB3D', 2000) returning id into g_prog;
  insert into public.monday_groups (board_id, name, color, position) values
    (v_board, 'Concluído', '#00C875', 3000) returning id into g_done;

  insert into public.monday_sprints (project_id, name, goal, status, start_date, end_date, position)
  values (v_project, 'Sprint 1', 'Entregar o MVP do board', 'active',
          current_date - 5, current_date + 9, 1000)
  returning id into v_sprint;

  insert into public.monday_tasks (board_id, group_id, sprint_id, title, status, priority, estimate, due_date, position, created_by) values
    (v_board, g_todo, v_sprint, 'Configurar autenticação Supabase', 'todo',    'high',   5, current_date + 3, 1000, v_uid),
    (v_board, g_todo, v_sprint, 'Modelar tabela de tarefas',         'todo',    'medium', 3, current_date + 4, 2000, v_uid),
    (v_board, g_prog, v_sprint, 'Implementar drag-and-drop do board','working', 'high',   8, current_date + 2, 1000, v_uid),
    (v_board, g_prog, v_sprint, 'Tela de filtros e tags',            'working', 'medium', 5, current_date + 5, 2000, v_uid),
    (v_board, g_done, v_sprint, 'Scaffold do projeto Next.js',       'done',    'low',    2, current_date - 4, 1000, v_uid),
    (v_board, g_done, v_sprint, 'Design system (tokens OKLCH)',      'done',    'medium', 3, current_date - 2, 2000, v_uid);

  return v_project;
end;
$$;

grant execute on function public.monday_seed_demo() to authenticated;
