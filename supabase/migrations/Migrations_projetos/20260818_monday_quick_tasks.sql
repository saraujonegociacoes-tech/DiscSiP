-- ============================================================================
-- 20260818_monday_quick_tasks.sql — Tarefas rapidas (dinamicas)
-- ----------------------------------------------------------------------------
-- Objetivo (pedido do dono): registrar trabalho curto e avulso sem precisar
-- criar projeto -> board -> group. Tabela FLAT, sem hierarquia nenhuma.
--
--   • monday_quick_tasks reusa os MESMOS dominios de status/prioridade das
--     tarefas de projeto (checks identicos aos de monday_tasks) — assim o
--     STATUS_META/PRIORITY_META e os badges do front servem sem adaptacao;
--   • reusa as funcoes de trigger que ja existem (monday_set_updated_at e
--     monday_sync_task_completed_at) — completed_at sai de graca, e e ele que
--     alimenta a Daily e o Historico;
--   • indices parciais cobrem exatamente as 3 leituras cruzadas (calendario por
--     due_date, daily por status, historico por completed_at), para o custo da
--     integracao ficar em 1 index scan por tela;
--   • RLS: dono OU responsavel OU gerencia (monday_is_gerencia, de
--     20260727_monday_gerencia_access.sql).
--
-- IDEMPOTENTE: pode ser reaplicada com seguranca.
-- ============================================================================

create table if not exists public.monday_quick_tasks (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 500),
  description  text,
  category     text check (category is null or char_length(category) between 1 and 60),
  status       text not null default 'todo'   check (status in ('todo','working','review','done','stuck')),
  priority     text not null default 'medium' check (priority in ('low','medium','high','critical')),
  assignee_id  uuid references auth.users (id) on delete set null,
  due_date     date,
  completed_at timestamptz,
  archived     boolean not null default false,
  position     double precision not null default 1000,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Conserto p/ quem aplicou a primeira versao desta migration: position nasceu
-- `integer` e o app grava Date.now() ali (mesma convencao de monday_tasks), que
-- estoura o int4. O resto do modulo usa double precision.
alter table public.monday_quick_tasks
  alter column position type double precision,
  alter column position set default 1000;

-- ─── Indices ────────────────────────────────────────────────────────────────
-- Listagem da aba (RLS filtra por owner/assignee, entao os dois tem indice).
create index if not exists monday_quick_tasks_owner_idx
  on public.monday_quick_tasks (owner_id) where archived = false;
create index if not exists monday_quick_tasks_assignee_idx
  on public.monday_quick_tasks (assignee_id) where archived = false;
-- Calendario de entregas.
create index if not exists monday_quick_tasks_due_idx
  on public.monday_quick_tasks (due_date) where due_date is not null and archived = false;
-- Daily ("feito hoje/ontem") e Historico.
create index if not exists monday_quick_tasks_completed_idx
  on public.monday_quick_tasks (completed_at desc) where status = 'done';

-- ─── Triggers (funcoes ja existentes em 20260723d_monday.sql) ───────────────
drop trigger if exists trg_monday_quick_tasks_updated_at on public.monday_quick_tasks;
create trigger trg_monday_quick_tasks_updated_at
  before update on public.monday_quick_tasks
  for each row execute function public.monday_set_updated_at();

drop trigger if exists trg_monday_quick_tasks_completed_at on public.monday_quick_tasks;
create trigger trg_monday_quick_tasks_completed_at
  before insert or update of status on public.monday_quick_tasks
  for each row execute function public.monday_sync_task_completed_at();

-- ─── RLS ────────────────────────────────────────────────────────────────────
alter table public.monday_quick_tasks enable row level security;

drop policy if exists monday_quick_tasks_rw on public.monday_quick_tasks;
create policy monday_quick_tasks_rw on public.monday_quick_tasks
  for all to authenticated
  using (
    owner_id = auth.uid()
    or assignee_id = auth.uid()
    or public.monday_is_gerencia()
  )
  with check (
    owner_id = auth.uid()
    or assignee_id = auth.uid()
    or public.monday_is_gerencia()
  );
