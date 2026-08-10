-- ============================================================================
-- 20260807_tester_rls_effective_role.sql — o papel 'tester' passa a valer nas RLS
-- ============================================================================
-- SINTOMA: logado como `tester`, qualquer escrita é recusada pelo banco. Ex.: subir
-- um mailing devolve `new row violates row-level security policy for table "lists"`.
--
-- CAUSA: `tester` nasceu em 20260803_tester_role.sql, que só liberou o valor no
-- `profiles_role_check`. As policies da RLS (20260614_rls_policies.sql) foram escritas
-- ANTES e listam apenas 'manager'/'admin'/'supervisor'. O gate de página no cliente
-- libera o tester, o banco não — o app deixa entrar e recusa na hora de gravar.
-- É a MESMA falha que 20260803b_proc_can_access_tester.sql corrigiu para /minutas;
-- lá era uma função de gate só, aqui são ~30 policies em todas as tabelas.
--
-- CORREÇÃO: `current_profile_role()` passa a devolver o papel EFETIVO — 'tester' vira
-- 'admin'. Uma linha conserta todas as policies de uma vez (campaigns, lists,
-- campaign_contacts, call_logs, ...), em vez de editar cada uma e esquecer alguma —
-- que é justamente como este bug reapareceu.
--
-- Isso NÃO mexe no "ver como" do tester: aquilo é estado do cliente
-- (softphoneStore.viewAsRole) e lê `profiles.role` direto, não esta função.
--
-- Intenção documentada: "Tester = acesso total (equivale a admin)"
-- (docs/rbac-docs/updates/acessos-e-papel-tester.md).
-- ⚠️ Consequência a aceitar conscientemente: no BANCO o tester passa a ter o mesmo
-- alcance de um admin (inclusive ver todos os perfis). É o que a matriz de acesso já
-- promete; se algum dia isso deixar de ser desejado, o caminho é trocar as policies
-- para usar `current_profile_role_raw()` onde a distinção importar.
--
-- Idempotente. Aplicar no SQL Editor do Supabase.
-- ============================================================================

-- Papel CRU, como está gravado em profiles.role. Fica disponível para quando uma
-- policy precisar distinguir tester de admin de verdade.
CREATE OR REPLACE FUNCTION public.current_profile_role_raw()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

COMMENT ON FUNCTION public.current_profile_role_raw() IS
  'Papel do usuário logado exatamente como está em profiles.role (sem mapear tester).';

-- Papel EFETIVO, usado por todas as policies: tester se comporta como admin.
CREATE OR REPLACE FUNCTION public.current_profile_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN role = 'tester' THEN 'admin' ELSE role END
  FROM public.profiles WHERE id = auth.uid();
$$;

COMMENT ON FUNCTION public.current_profile_role() IS
  'Papel EFETIVO do usuário logado para fins de RLS: tester conta como admin (acesso total, conforme a matriz de acesso). Papel cru em current_profile_role_raw().';

-- ── Conferência (rodar logado como o tester) ────────────────────────────────
--   SELECT public.current_profile_role_raw();  -- 'tester'
--   SELECT public.current_profile_role();      -- 'admin'
--   -- e então subir um mailing pela tela de campanha: deve inserir normalmente.
