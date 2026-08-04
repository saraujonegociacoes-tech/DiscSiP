-- ============================================================================
-- Funil "geral" (acionado no período, por updated_at) + split ciclo × retroativo
-- ============================================================================
-- Extensão do fix de "Ganhos por data de venda" (20260717_leads_won_by_sale_date.sql).
-- Os dois gráficos do funil (get_leads_dashboard.funnelByOrder e .phaseDistribution)
-- só enxergam o cohort "recebidos no período" (created_at dentro do período). Isso
-- responde "quem entrou e até onde foi", mas não "o que foi trabalhado agora,
-- independente de quando entrou" — um lead criado num ciclo anterior mas
-- movimentado hoje não aparece em nenhum dos dois.
--
-- Cohort NOVO: leads com updated_at dentro do período (qualquer movimentação —
-- mudança de fase, contato etc.), sem olhar created_at pra decidir se entra. Cada
-- linha é então classificada por created_at: 'cycle' (criado dentro do período
-- selecionado) × 'retro' (criado antes) — mesmo split 2-vias de TeamStuck/
-- LeadOrigin/get_leads_won_by_sale_date. Devolve os DOIS formatos que o funil já
-- tem hoje, recalculados sobre este cohort:
--   • funnelByOrder: fluxo cumulativo (mesma regra de get_leads_dashboard —
--     max_funnel_order >= ordem; ordem 0 = todo o cohort).
--   • phaseDistribution: onde cada lead do cohort está AGORA (current_phase).
--
-- Função NOVA e aditiva (get_leads_dashboard não é tocada — mesma cautela do fix
-- anterior, função grande não versionada no repo). SECURITY INVOKER (default): RLS
-- de v_lead_progress vale igual às outras RPCs. Só usa colunas já existentes na
-- view (updated_at, created_at, max_funnel_order, current_phase, phase_kind,
-- current_funnel_order) — sem lead_events/lead_phases.
CREATE OR REPLACE FUNCTION public.get_leads_activity(p_start timestamptz, p_end timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH activity AS MATERIALIZED (
    SELECT current_phase, phase_kind, current_funnel_order, max_funnel_order,
      (created_at >= p_start AND created_at < p_end) AS in_cycle
    FROM public.v_lead_progress
    WHERE updated_at >= p_start AND updated_at < p_end
  ),
  -- 0..9 = mesmo range de PRODUCTIVE_PHASES/WON_ORDER (src/features/leads/content/phases.ts).
  -- Se o funil ganhar/perder etapas lá, atualizar aqui junto.
  orders(funnel_order) AS (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)),
  funnel AS (
    SELECT
      o.funnel_order,
      (SELECT COUNT(*) FROM activity a
        WHERE o.funnel_order = 0 OR COALESCE(a.max_funnel_order, -1) >= o.funnel_order) AS total,
      (SELECT COUNT(*) FROM activity a
        WHERE (o.funnel_order = 0 OR COALESCE(a.max_funnel_order, -1) >= o.funnel_order) AND a.in_cycle) AS cycle,
      (SELECT COUNT(*) FROM activity a
        WHERE (o.funnel_order = 0 OR COALESCE(a.max_funnel_order, -1) >= o.funnel_order) AND NOT a.in_cycle) AS retro
    FROM orders o
  ),
  phase AS (
    SELECT
      COALESCE(NULLIF(TRIM(current_phase), ''), '—') AS phase,
      MAX(phase_kind) AS kind,
      MAX(current_funnel_order) AS funnel_order,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE in_cycle) AS cycle,
      COUNT(*) FILTER (WHERE NOT in_cycle) AS retro
    FROM activity
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'funnelByOrder', (
      SELECT jsonb_object_agg(funnel_order::text, jsonb_build_object('total', total, 'cycle', cycle, 'retro', retro))
      FROM funnel
    ),
    'phaseDistribution', (
      SELECT COALESCE(
        jsonb_agg(jsonb_build_object(
          'phase', phase, 'kind', kind, 'order', funnel_order, 'total', total, 'cycle', cycle, 'retro', retro
        )),
        '[]'::jsonb
      )
      FROM phase
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_leads_activity(timestamptz, timestamptz) TO authenticated;

-- Verificação (rodar depois de aplicar, direto no SQL editor):
--
-- 1) Sanidade: total da ordem 0 == nº de leads com updated_at no período (todo
--    lead do cohort passa por Recebidos, igual ao funil normal):
--   SELECT (public.get_leads_activity('2026-07-17T03:00:00Z','2026-07-18T03:00:00Z') -> 'funnelByOrder' -> '0' ->> 'total')::int;
--   SELECT COUNT(*) FROM public.v_lead_progress
--     WHERE updated_at >= '2026-07-17T03:00:00Z' AND updated_at < '2026-07-18T03:00:00Z';
--   -- Os dois números devem bater.
--
-- 2) cycle + retro == total em toda linha (funil e fase) — checagem visual do jsonb:
--   SELECT public.get_leads_activity('2026-07-17T03:00:00Z','2026-07-18T03:00:00Z');
--
-- 3) Um lead ANTIGO (created_at bem antes de hoje) que você sabe que teve alguma
--    movimentação hoje deve aparecer só no lado 'retro' das barras que ele tocou.
