-- 20260729_monday_project_delete_gerencia.sql — Excluir projeto pela gerencia
--
-- Ate aqui, DELETE de monday_projects era EXCLUSIVO do dono:
--   monday_projects_delete  ->  using (monday_project_role(id) = 'owner')
--
-- Pedido do dono: qualquer gerente/admin (RBAC role em profiles) pode excluir
-- QUALQUER projeto — coerente com o UPDATE, que ja usa can_manage_monday_project()
-- (gerencia OU owner/admin do projeto). Reusamos o helper monday_is_gerencia()
-- (manager/admin) e mantemos o dono, para nao remover permissao de quem ja tinha.
--
-- Delete cascateia (ON DELETE CASCADE) para members/boards/groups/sprints/tasks/
-- tags/task_tags — apagar um projeto derruba tudo dele.

drop policy if exists monday_projects_delete on public.monday_projects;
create policy monday_projects_delete on public.monday_projects
  for delete to authenticated
  using (
    public.monday_is_gerencia()
    or public.monday_project_role(id) = 'owner'
  );
