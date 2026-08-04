-- ============================================================================
-- Leads — drill em 2 passos (supersede get_leads_drill da 20260723b)
-- ============================================================================
-- A get_leads_drill de passo único devolvia TODOS os cards de TODOS os
-- responsáveis do recorte — pesado (ordem 1 = ~900 cards só de um responsável).
-- Aqui vira 2 funções (lazy): primeiro os responsáveis+contagem (leve), e os
-- cards só de UM responsável quando o usuário clica nele. Mesmo cohort/lógica do
-- get_leads_dashboard/get_leads_activity. Forward-only: dropa a antiga.
--
-- p_dimension: 'funnel' | 'phase' | 'funnel_activity' | 'phase_activity'
--   funnel/phase          → cohort por created_at (recebidos)   [get_leads_dashboard]
--   funnel_activity/phase_activity → cohort por updated_at (acionados) [get_leads_activity]
-- p_key: funnel* = ordem do funil (texto, "alcançou ≥ ordem", 0=todos); phase* = nome da fase atual.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_leads_drill(text, text, timestamptz, timestamptz);

-- ── Nível 1: responsáveis + contagem (payload leve) ──────────────────────────
CREATE OR REPLACE FUNCTION public.get_leads_drill_agents(
  p_dimension text, p_key text, p_start timestamptz, p_end timestamptz
)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH scoped AS (
    SELECT p.responsible_agent_id AS agent_id, p.current_phase, p.max_funnel_order,
           p.created_at, p.updated_at
    FROM public.v_lead_progress p
  ),
  cohort AS (
    SELECT * FROM scoped s
    WHERE CASE
      WHEN p_dimension IN ('funnel', 'phase') THEN s.created_at >= p_start AND s.created_at < p_end
      ELSE s.updated_at >= p_start AND s.updated_at < p_end
    END
  ),
  filtered AS (
    SELECT * FROM cohort c
    WHERE CASE
      WHEN p_dimension IN ('funnel', 'funnel_activity')
        THEN (p_key = '0' OR COALESCE(c.max_funnel_order, -1) >= p_key::int)
      ELSE COALESCE(NULLIF(btrim(c.current_phase), ''), '—') = p_key
    END
  ),
  by_agent AS (
    SELECT f.agent_id,
           CASE WHEN f.agent_id IS NULL THEN 'Sem responsável'
                ELSE COALESCE(la.pipefy_name, 'Sem nome') END AS name,
           count(*) AS c
    FROM filtered f
    LEFT JOIN public.lead_agents la ON la.id = f.agent_id
    GROUP BY f.agent_id, la.pipefy_name
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('agentId', agent_id, 'name', name, 'count', c)
                            ORDER BY c DESC, name), '[]'::jsonb)
  FROM by_agent;
$$;

GRANT EXECUTE ON FUNCTION public.get_leads_drill_agents(text, text, timestamptz, timestamptz) TO authenticated;

-- ── Nível 2: cards de UM responsável (p_agent NULL = sem responsável) ────────
CREATE OR REPLACE FUNCTION public.get_leads_drill_cards(
  p_dimension text, p_key text, p_agent uuid, p_start timestamptz, p_end timestamptz
)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH scoped AS (
    SELECT p.responsible_agent_id AS agent_id,
           COALESCE(l.pipefy_card_id, p.lead_id::text) AS pipefy_card_id,
           p.title, p.current_phase, p.max_funnel_order, p.created_at, p.updated_at
    FROM public.v_lead_progress p
    LEFT JOIN public.leads l ON l.id = p.lead_id
  ),
  cohort AS (
    SELECT * FROM scoped s
    WHERE CASE
      WHEN p_dimension IN ('funnel', 'phase') THEN s.created_at >= p_start AND s.created_at < p_end
      ELSE s.updated_at >= p_start AND s.updated_at < p_end
    END
  ),
  filtered AS (
    SELECT * FROM cohort c
    WHERE c.agent_id IS NOT DISTINCT FROM p_agent
      AND CASE
        WHEN p_dimension IN ('funnel', 'funnel_activity')
          THEN (p_key = '0' OR COALESCE(c.max_funnel_order, -1) >= p_key::int)
        ELSE COALESCE(NULLIF(btrim(c.current_phase), ''), '—') = p_key
      END
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('pipefyCardId', pipefy_card_id, 'title', title)
                            ORDER BY title NULLS LAST), '[]'::jsonb)
  FROM filtered;
$$;

GRANT EXECUTE ON FUNCTION public.get_leads_drill_cards(text, text, uuid, timestamptz, timestamptz) TO authenticated;

-- ── Conferir ────────────────────────────────────────────────────────────────
-- SELECT public.get_leads_drill_agents('funnel', '1', now() - interval '400 days', now());
-- SELECT public.get_leads_drill_cards('phase', '—', NULL, now() - interval '400 days', now());
