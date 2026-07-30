-- ============================================================================
-- Leads — 2 RPCs faltando/novas (Funil aprofundado): dwell time + drill de card
-- ============================================================================
-- Mesmo lugar das RPCs de leads que já vivem em migrations (20260717/20260718).
-- O schema BASE do leads (v_lead_progress, leads, lead_events, lead_phases,
-- lead_agents) é aplicado ao vivo e não versionado — estas funções só leem dele.
--
-- 1) get_leads_dwell_time — o gráfico "Tempo médio por etapa" estava EM BRANCO
--    porque esta função NUNCA foi criada (a action get_leads_funnel_depth chamava,
--    recebia 42883 e degradava pra vazio). Aqui está ela.
-- 2) get_leads_drill — devolve, para um recorte (dimensão × chave × período), os
--    responsáveis com seus CARDS (pipefy_card_id + título) — base do drill "clica
--    no total do responsável → cards + link Pipefy". Replica EXATAMENTE o cohort e
--    a lógica de get_leads_dashboard/get_leads_activity, senão a lista não bate com
--    a barra.
--
-- Ambas SECURITY INVOKER (default): o RLS de v_lead_progress escopa por papel
-- (agente = os próprios, supervisor = depto, manager/admin = tudo).
-- ============================================================================

-- ── 1. Tempo médio por etapa (dwell time) ────────────────────────────────────
-- Para cada lead, o par de eventos consecutivos dá o tempo na fase de origem:
-- entrou na fase (to_phase do evento i) e saiu quando ocorreu o evento i+1. O
-- dwell da fase = (occurred_at do próximo) − (occurred_at deste). Só conta a
-- transição CONCLUÍDA no período (a saída cai em [start,end)). Escopo via EXISTS
-- em v_lead_progress (herda o RLS do dashboard, mesmo que lead_events não tenha
-- policy própria).
CREATE OR REPLACE FUNCTION public.get_leads_dwell_time(p_start timestamptz, p_end timestamptz)
RETURNS TABLE(funnel_order integer, avg_hours numeric, sample_size bigint)
LANGUAGE sql STABLE AS $$
  WITH ev AS (
    SELECT e.lead_id, e.to_phase_id, e.occurred_at
    FROM public.lead_events e
    WHERE EXISTS (SELECT 1 FROM public.v_lead_progress p WHERE p.lead_id = e.lead_id)
  ),
  ordered AS (
    SELECT
      lead_id, to_phase_id,
      occurred_at AS entered_at,
      LEAD(occurred_at) OVER (PARTITION BY lead_id ORDER BY occurred_at) AS left_at
    FROM ev
  ),
  dwell AS (
    SELECT ph.funnel_order AS fo,
           EXTRACT(EPOCH FROM (o.left_at - o.entered_at)) / 3600.0 AS hours
    FROM ordered o
    JOIN public.lead_phases ph ON ph.pipefy_phase_id = o.to_phase_id
    WHERE o.left_at IS NOT NULL
      AND o.left_at >= p_start AND o.left_at < p_end
      AND o.left_at > o.entered_at
      AND ph.kind = 'produtiva'
      AND ph.funnel_order IS NOT NULL
  )
  SELECT d.fo::integer AS funnel_order,
         round(avg(d.hours)::numeric, 2) AS avg_hours,
         count(*)::bigint AS sample_size
  FROM dwell d
  GROUP BY d.fo
  ORDER BY d.fo;
$$;

GRANT EXECUTE ON FUNCTION public.get_leads_dwell_time(timestamptz, timestamptz) TO authenticated;

-- ── 2. Drill de card por responsável ─────────────────────────────────────────
-- p_dimension: 'funnel' | 'phase' | 'funnel_activity' | 'phase_activity'
--   funnel/phase          → cohort por created_at no período (recebidos)  [get_leads_dashboard]
--   funnel_activity/phase_activity → cohort por updated_at no período (acionados) [get_leads_activity]
-- p_key:
--   funnel*  → a ordem do funil (texto). Regra "alcançou ≥ ordem" (0 = todos).
--   phase*   → o nome da fase ATUAL (já normalizado como no dashboard).
-- Retorno: [ { agentId, name, count, cards:[ {pipefyCardId, title} ] } ] ordenado por count desc.
CREATE OR REPLACE FUNCTION public.get_leads_drill(
  p_dimension text, p_key text, p_start timestamptz, p_end timestamptz
)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH scoped AS (
    SELECT
      p.lead_id,
      p.responsible_agent_id AS agent_id,
      COALESCE(l.pipefy_card_id, p.lead_id::text) AS pipefy_card_id,
      p.title,
      p.current_phase,
      p.max_funnel_order,
      p.created_at,
      p.updated_at
    FROM public.v_lead_progress p
    LEFT JOIN public.leads l ON l.id = p.lead_id
  ),
  cohort AS (
    SELECT * FROM scoped s
    WHERE CASE
      WHEN p_dimension IN ('funnel', 'phase')
        THEN s.created_at >= p_start AND s.created_at < p_end
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
    SELECT
      f.agent_id,
      CASE WHEN f.agent_id IS NULL THEN 'Sem responsável'
           ELSE COALESCE(la.pipefy_name, 'Sem nome') END AS name,
      count(*) AS c,
      jsonb_agg(jsonb_build_object('pipefyCardId', f.pipefy_card_id, 'title', f.title)
                ORDER BY f.title NULLS LAST) AS cards
    FROM filtered f
    LEFT JOIN public.lead_agents la ON la.id = f.agent_id
    GROUP BY f.agent_id, la.pipefy_name
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'agentId', agent_id, 'name', name, 'count', c, 'cards', cards
  ) ORDER BY c DESC, name), '[]'::jsonb)
  FROM by_agent;
$$;

GRANT EXECUTE ON FUNCTION public.get_leads_drill(text, text, timestamptz, timestamptz) TO authenticated;

-- ── Conferir depois de aplicar ──────────────────────────────────────────────
-- SELECT * FROM public.get_leads_dwell_time(now() - interval '400 days', now());
-- SELECT public.get_leads_drill('phase', '—', now() - interval '400 days', now());
-- SELECT jsonb_array_length(public.get_leads_drill('funnel', '1', now() - interval '400 days', now()));
