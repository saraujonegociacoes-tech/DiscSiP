-- ============================================================================
-- Sprint 3 (novo-visual-dashleads) — Funil aprofundado: tempo médio por etapa
-- ============================================================================
-- Nova métrica a partir de lead_events (até agora não lido por nenhuma action do
-- app): tempo médio que um lead passa em cada etapa ANTES de sair dela (dwell
-- time), por etapa produtiva do funil. A "conversão entre etapas adjacentes" NÃO
-- precisa de dado novo — já dá pra derivar de get_leads_dashboard.funnelByOrder
-- no client (reachedByOrder[i+1] / reachedByOrder[i]), então não entra aqui.
--
-- Idempotente (CREATE OR REPLACE), não toca em dado. SECURITY INVOKER (default):
-- o RLS do chamador vale em `leads`/`lead_events` (mesmas policies
-- leads_select/lead_events_select — agente só o próprio, supervisor o depto,
-- manager/admin tudo). Mesmo padrão de get_leads_dashboard/get_agent_stuck.
--
-- Lógica: para cada lead criado no período, ordena os eventos de transição por
-- occurred_at. O dwell de uma etapa é o tempo entre ENTRAR nela e a transição
-- seguinte (LAG). A primeira transição de um lead fecha o dwell da etapa 0
-- (Recebidos), ancorada em leads.created_at — mesma âncora usada no funil e no
-- tempo até 1º contato. Só conta dwell de transições COMPLETADAS: um lead ainda
-- parado na fase atual não entra (o dwell dele está em aberto/censurado; contar
-- "até agora" viesaria a média para cima nas fases com backlog). Descarta pares
-- fora de ordem (occurred_at <= anterior) — mesma cautela do retroativo do 1º
-- contato (v. correções de contabilização 08/jul).
CREATE OR REPLACE FUNCTION public.get_leads_dwell_time(p_start timestamptz, p_end timestamptz)
RETURNS TABLE (funnel_order int, avg_hours numeric, sample_size int)
LANGUAGE sql
STABLE
AS $$
  WITH period_leads AS MATERIALIZED (
    SELECT id, created_at
    FROM public.leads
    WHERE created_at >= p_start AND created_at < p_end
  ),
  ordered_events AS (
    SELECT
      e.lead_id,
      e.occurred_at,
      LAG(e.occurred_at) OVER (PARTITION BY e.lead_id ORDER BY e.occurred_at) AS prev_occurred_at,
      LAG(e.to_phase_id) OVER (PARTITION BY e.lead_id ORDER BY e.occurred_at) AS prev_to_phase_id
    FROM public.lead_events e
    JOIN period_leads pl ON pl.id = e.lead_id
  ),
  dwell AS (
    SELECT
      CASE WHEN oe.prev_occurred_at IS NULL THEN 0 ELSE lp.funnel_order END AS funnel_order,
      EXTRACT(EPOCH FROM (oe.occurred_at - COALESCE(oe.prev_occurred_at, pl.created_at))) / 3600.0 AS hours
    FROM ordered_events oe
    JOIN period_leads pl ON pl.id = oe.lead_id
    LEFT JOIN public.lead_phases lp ON lp.pipefy_phase_id = oe.prev_to_phase_id
    WHERE oe.occurred_at > COALESCE(oe.prev_occurred_at, pl.created_at)
      -- fase anterior desconhecida (id não mapeado em lead_phases) → descarta a
      -- linha em vez de bucketar errado; a 1ª transição (sem anterior) é sempre 0.
      AND (oe.prev_occurred_at IS NULL OR lp.funnel_order IS NOT NULL)
  )
  SELECT d.funnel_order, ROUND(AVG(d.hours), 1) AS avg_hours, COUNT(*)::int AS sample_size
  FROM dwell d
  GROUP BY d.funnel_order;
$$;

GRANT EXECUTE ON FUNCTION public.get_leads_dwell_time(timestamptz, timestamptz) TO authenticated;

-- Verificação (rodar depois de aplicar, direto no SQL editor):
--   SELECT * FROM public.get_leads_dwell_time('2000-01-01T00:00:00Z','2100-01-01T00:00:00Z')
--   ORDER BY funnel_order;
--   -- Esperado: linhas com funnel_order 0..8, avg_hours >= 0, sample_size > 0 nas
--   -- etapas com volume real (0/1/2 devem ter os maiores sample_size).
