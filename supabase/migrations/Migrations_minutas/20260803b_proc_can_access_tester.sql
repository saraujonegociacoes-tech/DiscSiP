-- 20260803b_proc_can_access_tester.sql — inclui o papel 'tester' no proc_can_access()
--
-- Contexto: o papel `tester` nasceu em 20260803_tester_role.sql ("acesso total",
-- equivale a admin — ver docs/rbac-docs/updates/acessos-e-papel-tester.md). A área
-- de Minutas Processuais é ANTERIOR (20260731b_minutas_processuais.sql), então
-- `proc_can_access()` ficou com a lista antiga ('manager','admin') e nunca foi
-- atualizada.
--
-- Sintoma: o gate de página de /minutas JÁ libera `tester`
-- (src/app/minutas/page.tsx), mas a RLS não. O tester abria o painel e recebia
-- ZERO linhas — painel vazio, sem erro nenhum na tela.
--
-- Idempotente: só um `create or replace` da função. As policies não mudam (elas
-- chamam proc_can_access(), então herdam a correção).
create or replace function public.proc_can_access() returns boolean
language sql stable set search_path = public as $$
  select public.proc_current_role() in ('manager', 'admin', 'tester')
      or (
        public.proc_current_department_id() is not null
        and public.proc_current_department_id() = public.proc_juridico_department_id()
      )
$$;

comment on function public.proc_can_access() is
  'Quem pode ver/editar as minutas processuais: manager/admin/tester ou quem é do departamento jurídico. Ver docs/minutas-docs/updates/painel-minutas-processuais.md';

-- ── Verificação ──────────────────────────────────────────────────────────────
-- Logado como o tester:
--   SELECT public.proc_current_role();   -- 'tester'
--   SELECT public.proc_can_access();     -- true
--   SELECT count(*) FROM public.proc_parcelas;  -- 87 (e não 0)
