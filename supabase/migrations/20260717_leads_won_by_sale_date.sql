-- ============================================================================
-- Ganhos/mortos por DATA DE VENDA (finalized_at), não por criação (created_at)
-- ============================================================================
-- Bug: get_leads_dashboard (e o fallback dashboardFromScan em leads.ts) contam
-- won/dead filtrando por created_at dentro do período. Um lead criado num
-- ciclo anterior mas vendido (finalized_at) dentro do período selecionado não
-- aparece como ganho — o painel de um dia com vendas reais pode mostrar zero.
--
-- Função NOVA e aditiva (não mexe em get_leads_dashboard, que é grande e não
-- está versionada neste repo — reescrevê-la às cegas arriscaria quebrar
-- funil/ranking/canal). O app soma este resultado por cima do kpis que já
-- vem de get_leads_dashboard. Mesmo padrão de get_leads_dwell_time/
-- get_leads_timeseries: idempotente (CREATE OR REPLACE), não toca em dado,
-- SECURITY INVOKER (default) — o RLS de v_lead_progress vale igual às outras
-- RPCs (agente só o próprio, supervisor+ o resto).
--
-- in_cycle classifica cada ganho/morte: created_at também dentro do período
-- ("ciclo") vs created_at antes do período ("retroativo" — lead arrastado de
-- um ciclo anterior, vendido/descartado neste). Mesmo conceito já usado em
-- getAgentLeads (origin: 'ciclo' | 'retroativo') e TeamStuck (cycle/retro).
CREATE OR REPLACE FUNCTION public.get_leads_won_by_sale_date(p_start timestamptz, p_end timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH finalized AS (
    SELECT is_won, is_dead,
      (created_at >= p_start AND created_at < p_end) AS in_cycle
    FROM public.v_lead_progress
    WHERE finalized_at >= p_start AND finalized_at < p_end
      AND (is_won OR is_dead)
  )
  SELECT jsonb_build_object(
    'won', COUNT(*) FILTER (WHERE is_won),
    'dead', COUNT(*) FILTER (WHERE is_dead),
    'wonCycle', COUNT(*) FILTER (WHERE is_won AND in_cycle),
    'wonRetro', COUNT(*) FILTER (WHERE is_won AND NOT in_cycle)
  )
  FROM finalized;
$$;

GRANT EXECUTE ON FUNCTION public.get_leads_won_by_sale_date(timestamptz, timestamptz) TO authenticated;

-- Verificação (rodar depois de aplicar, direto no SQL editor):
--
-- 1) Sanidade ampla — 'won' deve bater aproximadamente com o kpis.won
--    all-time que get_leads_dashboard já retorna hoje:
--   SELECT public.get_leads_won_by_sale_date('2000-01-01T00:00:00Z','2100-01-01T00:00:00Z');
--   SELECT public.get_leads_dashboard('2000-01-01T00:00:00Z','2100-01-01T00:00:00Z') -> 'kpis';
--
-- 2) Checar gap de qualidade de dado (leads ganhos sem finalized_at, que
--    ficam de fora desta função por não terem data de venda registrada):
--   SELECT COUNT(*) FROM public.v_lead_progress WHERE is_won AND finalized_at IS NULL;
--   -- Esperado 0. Se vier > 0, esses leads não vão aparecer no novo card
--   -- "Ganhos" até o finalized_at deles ser corrigido na fonte (Pipefy).
--
-- 3) Um dia recente COM venda conhecida (ex.: ontem), pra confirmar won > 0
--    onde o painel hoje mostra zero:
--   SELECT public.get_leads_won_by_sale_date('2026-07-16T03:00:00Z','2026-07-17T03:00:00Z');
