-- ============================================================================
-- Sprint 7c — Row Level Security por papel/departamento (todas as tabelas)
-- ============================================================================
-- As Server Actions rodam com a sessão do usuário (@supabase/ssr), então
-- auth.uid() é o usuário logado e o Postgres aplica estas políticas conforme o
-- papel dele. Helpers SECURITY DEFINER furam o RLS para evitar recursão entre
-- tabelas. Idempotente (drop policy if exists antes de recriar).
--
-- Papéis: pending (nada), agent (o seu), supervisor (seu depto),
--         manager (todo o negócio, sem contas), admin (tudo + contas).
-- ============================================================================

-- ── Seed dos departamentos reais ────────────────────────────────────────────
INSERT INTO public.departments (name)
VALUES ('Comercial'), ('Negociação'), ('Sucesso do Cliente')
ON CONFLICT (name) DO NOTHING;

-- ── Helpers SECURITY DEFINER (bypassam RLS; evitam recursão de política) ─────
CREATE OR REPLACE FUNCTION public.is_campaign_participant(cid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.campaign_agents
    WHERE campaign_id = cid AND agent_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.campaign_dept(cid uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT department_id FROM public.campaigns WHERE id = cid;
$$;

CREATE OR REPLACE FUNCTION public.profile_dept(pid uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT department_id FROM public.profiles WHERE id = pid;
$$;

-- ── profiles ────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles FOR SELECT USING (
  id = auth.uid()
  OR current_profile_role() IN ('manager', 'admin')
  OR (current_profile_role() = 'supervisor' AND department_id = current_profile_dept())
);

-- Só admin edita/remove perfis (evita escalonamento de papel pelo próprio usuário)
DROP POLICY IF EXISTS profiles_update ON public.profiles;
CREATE POLICY profiles_update ON public.profiles FOR UPDATE
  USING (current_profile_role() = 'admin')
  WITH CHECK (current_profile_role() = 'admin');

DROP POLICY IF EXISTS profiles_delete ON public.profiles;
CREATE POLICY profiles_delete ON public.profiles FOR DELETE
  USING (current_profile_role() = 'admin');
-- INSERT: nenhuma política — o trigger handle_new_user (SECURITY DEFINER) cuida do cadastro

-- ── departments ─────────────────────────────────────────────────────────────
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS departments_select ON public.departments;
CREATE POLICY departments_select ON public.departments FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS departments_write ON public.departments;
CREATE POLICY departments_write ON public.departments FOR ALL
  USING (current_profile_role() = 'admin')
  WITH CHECK (current_profile_role() = 'admin');

-- ── campaigns ───────────────────────────────────────────────────────────────
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaigns_select ON public.campaigns;
CREATE POLICY campaigns_select ON public.campaigns FOR SELECT USING (
  current_profile_role() IN ('manager', 'admin')
  OR (current_profile_role() = 'supervisor' AND department_id = current_profile_dept())
  OR is_campaign_participant(id)
);

DROP POLICY IF EXISTS campaigns_insert ON public.campaigns;
CREATE POLICY campaigns_insert ON public.campaigns FOR INSERT WITH CHECK (
  current_profile_role() IN ('manager', 'admin')
  OR (current_profile_role() = 'supervisor' AND department_id = current_profile_dept())
);

DROP POLICY IF EXISTS campaigns_update ON public.campaigns;
CREATE POLICY campaigns_update ON public.campaigns FOR UPDATE
  USING (
    current_profile_role() IN ('manager', 'admin')
    OR (current_profile_role() = 'supervisor' AND department_id = current_profile_dept())
  )
  WITH CHECK (
    current_profile_role() IN ('manager', 'admin')
    OR (current_profile_role() = 'supervisor' AND department_id = current_profile_dept())
  );

DROP POLICY IF EXISTS campaigns_delete ON public.campaigns;
CREATE POLICY campaigns_delete ON public.campaigns FOR DELETE USING (
  current_profile_role() IN ('manager', 'admin')
  OR (current_profile_role() = 'supervisor' AND department_id = current_profile_dept())
);

-- ── campaign_agents ─────────────────────────────────────────────────────────
ALTER TABLE public.campaign_agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaign_agents_select ON public.campaign_agents;
CREATE POLICY campaign_agents_select ON public.campaign_agents FOR SELECT USING (
  agent_id = auth.uid()
  OR current_profile_role() IN ('manager', 'admin')
  OR (current_profile_role() = 'supervisor' AND campaign_dept(campaign_id) = current_profile_dept())
);

DROP POLICY IF EXISTS campaign_agents_write ON public.campaign_agents;
CREATE POLICY campaign_agents_write ON public.campaign_agents FOR ALL
  USING (
    current_profile_role() IN ('manager', 'admin')
    OR (current_profile_role() = 'supervisor' AND campaign_dept(campaign_id) = current_profile_dept())
  )
  WITH CHECK (
    current_profile_role() IN ('manager', 'admin')
    OR (current_profile_role() = 'supervisor' AND campaign_dept(campaign_id) = current_profile_dept())
  );

-- ── lists ───────────────────────────────────────────────────────────────────
ALTER TABLE public.lists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lists_select ON public.lists;
CREATE POLICY lists_select ON public.lists FOR SELECT USING (
  current_profile_role() IN ('manager', 'admin')
  OR (current_profile_role() = 'supervisor' AND campaign_dept(campaign_id) = current_profile_dept())
  OR is_campaign_participant(campaign_id)
);

DROP POLICY IF EXISTS lists_write ON public.lists;
CREATE POLICY lists_write ON public.lists FOR ALL
  USING (
    current_profile_role() IN ('manager', 'admin')
    OR (current_profile_role() = 'supervisor' AND campaign_dept(campaign_id) = current_profile_dept())
  )
  WITH CHECK (
    current_profile_role() IN ('manager', 'admin')
    OR (current_profile_role() = 'supervisor' AND campaign_dept(campaign_id) = current_profile_dept())
  );

-- ── campaign_contacts ───────────────────────────────────────────────────────
ALTER TABLE public.campaign_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaign_contacts_select ON public.campaign_contacts;
CREATE POLICY campaign_contacts_select ON public.campaign_contacts FOR SELECT USING (
  current_profile_role() IN ('manager', 'admin')
  OR (current_profile_role() = 'supervisor' AND campaign_dept(campaign_id) = current_profile_dept())
  OR is_campaign_participant(campaign_id)
);

-- INSERT: upload de listas (supervisor do depto / manager / admin)
DROP POLICY IF EXISTS campaign_contacts_insert ON public.campaign_contacts;
CREATE POLICY campaign_contacts_insert ON public.campaign_contacts FOR INSERT WITH CHECK (
  current_profile_role() IN ('manager', 'admin')
  OR (current_profile_role() = 'supervisor' AND campaign_dept(campaign_id) = current_profile_dept())
);

-- UPDATE: o agente participante (claim + disposição + reciclagem) e a gestão do depto
DROP POLICY IF EXISTS campaign_contacts_update ON public.campaign_contacts;
CREATE POLICY campaign_contacts_update ON public.campaign_contacts FOR UPDATE
  USING (
    is_campaign_participant(campaign_id)
    OR current_profile_role() IN ('manager', 'admin')
    OR (current_profile_role() = 'supervisor' AND campaign_dept(campaign_id) = current_profile_dept())
  )
  WITH CHECK (
    is_campaign_participant(campaign_id)
    OR current_profile_role() IN ('manager', 'admin')
    OR (current_profile_role() = 'supervisor' AND campaign_dept(campaign_id) = current_profile_dept())
  );

-- DELETE: deleteList (supervisor do depto / manager / admin)
DROP POLICY IF EXISTS campaign_contacts_delete ON public.campaign_contacts;
CREATE POLICY campaign_contacts_delete ON public.campaign_contacts FOR DELETE USING (
  current_profile_role() IN ('manager', 'admin')
  OR (current_profile_role() = 'supervisor' AND campaign_dept(campaign_id) = current_profile_dept())
);

-- ── call_logs ───────────────────────────────────────────────────────────────
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS call_logs_select ON public.call_logs;
CREATE POLICY call_logs_select ON public.call_logs FOR SELECT USING (
  agent_id = auth.uid()
  OR current_profile_role() IN ('manager', 'admin')
  OR (current_profile_role() = 'supervisor' AND profile_dept(agent_id) = current_profile_dept())
);

-- INSERT: cada um só grava o próprio log
DROP POLICY IF EXISTS call_logs_insert ON public.call_logs;
CREATE POLICY call_logs_insert ON public.call_logs FOR INSERT
  WITH CHECK (agent_id = auth.uid());

-- Histórico é imutável: update/delete só admin
DROP POLICY IF EXISTS call_logs_update ON public.call_logs;
CREATE POLICY call_logs_update ON public.call_logs FOR UPDATE
  USING (current_profile_role() = 'admin')
  WITH CHECK (current_profile_role() = 'admin');

DROP POLICY IF EXISTS call_logs_delete ON public.call_logs;
CREATE POLICY call_logs_delete ON public.call_logs FOR DELETE
  USING (current_profile_role() = 'admin');
