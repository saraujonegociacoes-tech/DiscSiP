-- ============================================================================
-- Dashboard de Leads — RLS: supervisor recortado por DEPARTAMENTO (+ órfãos)
-- ============================================================================
-- ANTES: o supervisor caía no mesmo balde que manager/admin
--   (current_profile_role() IN ('supervisor','manager','admin')) → via TODOS os leads de
--   TODAS as equipes. Divergia do modelo do discador (20260614_rls_policies.sql).
-- DEPOIS: alinha ao modelo padrão —
--   agente = o seu · supervisor = do SEU departamento + órfãos · manager/admin = tudo.
--
-- É um APERTO (o supervisor passa a ver MENOS), nunca uma abertura → não cria brecha de
-- segurança; fecha uma (supervisor via demais). A ponte de equipe é
-- lead_agents.profile_id → profiles.department_id (já 100% mapeado). Órfãos (lead sem
-- responsável) ficam visíveis a QUALQUER supervisor, para triagem (decisão do dono).
--
-- ⚠ Um supervisor SEM department_id setado passa a ver só os órfãos (dept nulo não casa com
--   nada). Garanta profiles.department_id nos supervisores.
--
-- Depende de: current_profile_role(), current_profile_dept() (discador), profiles,
--   current_lead_agent_id() (setup de leads). Idempotente. NÃO mexe em dados.
-- ============================================================================

BEGIN;

-- Departamento do responsável de um lead (via profile_id). SECURITY DEFINER: fura a RLS de
-- lead_agents/profiles para a política não recursar. NULL se órfão ou agente sem depto.
CREATE OR REPLACE FUNCTION public.lead_agent_dept(la_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.department_id
  FROM public.lead_agents la
  JOIN public.profiles p ON p.id = la.profile_id
  WHERE la.id = la_id;
$$;

-- O lead está no escopo de um supervisor do depto `dept`? (órfão OU do depto dele.) Usado
-- pela policy de lead_events: a visibilidade do evento SEGUE o lead (não o agente do evento)
-- — assim não subconta max_funnel_order de lead reatribuído entre departamentos.
CREATE OR REPLACE FUNCTION public.lead_in_supervisor_scope(l_id uuid, dept uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = l_id
      AND (l.responsible_agent_id IS NULL
           OR public.lead_agent_dept(l.responsible_agent_id) = dept)
  );
$$;

-- leads: agente (o seu) · supervisor (depto + órfãos) · manager/admin (tudo)
DROP POLICY IF EXISTS leads_select ON public.leads;
CREATE POLICY leads_select ON public.leads FOR SELECT USING (
  current_profile_role() IN ('manager', 'admin')
  OR responsible_agent_id = current_lead_agent_id()
  OR (
    current_profile_role() = 'supervisor'
    AND (
      responsible_agent_id IS NULL
      OR lead_agent_dept(responsible_agent_id) = current_profile_dept()
    )
  )
);

-- lead_events: visibilidade SEGUE o lead (consistente com leads_select)
DROP POLICY IF EXISTS lead_events_select ON public.lead_events;
CREATE POLICY lead_events_select ON public.lead_events FOR SELECT USING (
  current_profile_role() IN ('manager', 'admin')
  OR agent_id = current_lead_agent_id()
  OR (
    current_profile_role() = 'supervisor'
    AND lead_in_supervisor_scope(lead_id, current_profile_dept())
  )
);

COMMIT;

-- ============================================================================
-- Verificação: com um supervisor de department_id setado, confira que ele só vê os leads do
-- próprio depto + os órfãos (responsible_agent_id IS NULL). Manager/admin seguem vendo tudo;
-- agente segue vendo só o seu.
-- ============================================================================
