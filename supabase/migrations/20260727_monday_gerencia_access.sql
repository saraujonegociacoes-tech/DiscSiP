-- ============================================================================
-- 20260727_monday_gerencia_access.sql — Acesso da gerencia a TODOS os projetos
-- ----------------------------------------------------------------------------
-- Objetivo (pedido do dono): admins e gerentes (RBAC role em profiles) enxergam
-- e trabalham em TODOS os projetos Monday, sem precisar ser adicionados como
-- membros — "adms e gerentes tendo acesso aos mesmos projetos". A gestao fina
-- (adicionar/remover pessoas especificas, ex. agentes/supervisores) continua
-- via monday_project_members e alimenta os responsaveis de tarefa.
--
--   • Novo helper monday_is_gerencia() le profiles.role do auth.uid();
--   • Os 4 helpers de acesso (member/manage/board/task) passam a retornar true
--     tambem para a gerencia — as policies existentes nao mudam, so o helper;
--   • Nova RPC monday_assignable_users() alimenta o seletor de "Adicionar membro"
--     (SECURITY DEFINER, so responde para a gerencia).
--   • DELETE de projeto continua EXCLUSIVO do dono (monday_projects_delete intacto).
--
-- IDEMPOTENTE: pode ser reaplicada com seguranca (tudo em create or replace).
-- ============================================================================

-- ─── Helper: o usuario atual e "gerencia" (manager/admin no RBAC do Blue Desk)?
create or replace function public.monday_is_gerencia()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('manager', 'admin')
  );
$$;

-- ─── Helpers de acesso: membership do projeto OU gerencia ───────────────────
-- (Redefinicoes de 20260723d_monday.sql — mesma assinatura, so acrescentam a
--  clausula "public.monday_is_gerencia() or ...".)
create or replace function public.is_monday_project_member(p_project uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.monday_is_gerencia() or exists (
    select 1 from public.monday_project_members pm
    where pm.project_id = p_project and pm.user_id = auth.uid()
  );
$$;

create or replace function public.can_manage_monday_project(p_project uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.monday_is_gerencia()
      or public.monday_project_role(p_project) in ('owner', 'admin');
$$;

create or replace function public.can_access_monday_board(p_board uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.monday_is_gerencia() or exists (
    select 1 from public.monday_boards b
    join public.monday_project_members pm on pm.project_id = b.project_id
    where b.id = p_board and pm.user_id = auth.uid()
  );
$$;

create or replace function public.can_access_monday_task(p_task uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.monday_is_gerencia() or exists (
    select 1 from public.monday_tasks t
    join public.monday_boards b on b.id = t.board_id
    join public.monday_project_members pm on pm.project_id = b.project_id
    where t.id = p_task and pm.user_id = auth.uid()
  );
$$;

-- ─── RPC: usuarios que podem ser adicionados a um projeto ───────────────────
-- Alimenta o seletor de "Adicionar membro". SECURITY DEFINER p/ ler o diretorio
-- de profiles independente do RLS de profiles; so retorna linhas para a gerencia
-- (as telas de /projects ja sao restritas a manager/admin, isto e defesa extra).
create or replace function public.monday_assignable_users()
returns table (id uuid, name text, email text, role text)
language sql security definer set search_path = public stable as $$
  select p.id, p.name, p.email, p.role::text
  from public.profiles p
  where public.monday_is_gerencia()
    and p.role <> 'pending'
  order by p.name nulls last, p.email;
$$;

grant execute on function public.monday_is_gerencia() to authenticated;
grant execute on function public.monday_assignable_users() to authenticated;
