-- ============================================================================
-- Dashboard de Leads (Pipefy) — drill-down por responsável + link do card
-- ============================================================================
-- Adições da Sprint 1 (interatividade). Idempotente (CREATE OR REPLACE), NÃO toca dados.
-- Rodar DEPOIS de 20260708_leads_dashboard_fixes.sql (esta versão do get_leads_dashboard
-- inclui tudo daquela + 2 seções novas; se já rodou a 20260708, rodar esta de novo é seguro).
--
-- (1) DRILL-DOWN por responsável ao clicar numa barra de fase (agregado no Postgres — regra
--     do 1102; arrays pequenos ~fases×agentes):
--     • phaseByResponsible: { "<fase atual>": [ {agentId,name,count} ] } — quem está PARADO
--       ali agora (fase atual = a barra da Distribuição por fase; soma bate com a barra).
--     • funnelByResponsible: { "<ordem>": [ {agentId,name,count} ] } — responsáveis dos que
--       ALCANÇARAM aquela ordem (cumulativo; ordem 0 = todos, igual ao funil; soma = a barra).
--
-- (2) v_duplicate_responsibility ganha pipefy_card_id → o front monta o link open-cards
--     (https://app.pipefy.com/open-cards/{card_id}) para abrir o card duplicado no Pipefy.
-- ============================================================================

BEGIN;

-- ── Alerta de responsabilidade duplicada + id do card (para o link do Pipefy) ────
-- pipefy_card_id vai no FINAL de propósito: CREATE OR REPLACE VIEW só permite ADICIONAR
-- coluna nova ao fim (mudar a posição renomearia colunas existentes → erro 42P16). A app
-- seleciona por nome, então a ordem não importa para o front.
CREATE OR REPLACE VIEW public.v_duplicate_responsibility
WITH (security_invoker = true) AS
SELECT
  l.id            AS lead_id,
  l.title,
  l.current_phase,
  la.pipefy_name  AS responsible,
  l.updated_at,
  l.pipefy_card_id
FROM public.leads l
LEFT JOIN public.lead_agents la ON la.id = l.responsible_agent_id
WHERE l.duplicate_responsible;

-- ── RPC agregado do dashboard (versão completa: fixes de 20260708 + drill-downs) ──
CREATE OR REPLACE FUNCTION public.get_leads_dashboard(p_start timestamptz, p_end timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
WITH period AS MATERIALIZED (
  SELECT
    p.responsible_agent_id,
    p.duplicate_responsible,
    p.channel,
    p.current_phase,
    p.phase_kind,
    p.current_funnel_order,
    p.is_dead,
    p.is_open,
    p.is_won,
    p.max_funnel_order,
    p.hours_to_first_contact
  FROM public.v_lead_progress p
  WHERE p.created_at >= p_start AND p.created_at < p_end
)
SELECT jsonb_build_object(
  -- KPIs do período. avgHoursToFirstContact ignora os retroativos (contato < criação).
  'kpis', (
    SELECT jsonb_build_object(
      'total', count(*),
      'open',  count(*) FILTER (WHERE is_open),
      'won',   count(*) FILTER (WHERE is_won),
      'dead',  count(*) FILTER (WHERE is_dead),
      'avgHoursToFirstContact',
        round(avg(hours_to_first_contact) FILTER (WHERE hours_to_first_contact >= 0)::numeric, 1)
    )
    FROM period
  ),

  -- Funil (cumulativo): ordem 0 = TODOS os recebidos; ordens ≥ 1 = alcançaram aquela ordem.
  'funnelByOrder', (
    SELECT COALESCE(jsonb_object_agg(ph.funnel_order::text, x.cnt), '{}'::jsonb)
    FROM public.lead_phases ph
    CROSS JOIN LATERAL (
      SELECT count(*) AS cnt
      FROM period pr
      WHERE ph.funnel_order = 0
         OR COALESCE(pr.max_funnel_order, -1) >= ph.funnel_order
    ) x
    WHERE ph.kind = 'produtiva' AND ph.funnel_order IS NOT NULL
  ),

  -- Drill-down do funil: por ordem, responsáveis dos que ALCANÇARAM aquela ordem (soma = barra).
  'funnelByResponsible', (
    SELECT COALESCE(jsonb_object_agg(ord::text, agents), '{}'::jsonb)
    FROM (
      SELECT ph.funnel_order AS ord,
             jsonb_agg(jsonb_build_object('agentId', g.agent_id, 'name', g.name, 'count', g.c)
                       ORDER BY g.c DESC, g.name) AS agents
      FROM public.lead_phases ph
      JOIN LATERAL (
        SELECT pr.responsible_agent_id AS agent_id,
               CASE WHEN pr.responsible_agent_id IS NULL THEN 'Sem responsável'
                    ELSE COALESCE(la.pipefy_name, 'Sem nome') END AS name,
               count(*) AS c
        FROM period pr
        LEFT JOIN public.lead_agents la ON la.id = pr.responsible_agent_id
        WHERE ph.funnel_order = 0
           OR COALESCE(pr.max_funnel_order, -1) >= ph.funnel_order
        GROUP BY pr.responsible_agent_id, la.pipefy_name
      ) g ON true
      WHERE ph.kind = 'produtiva' AND ph.funnel_order IS NOT NULL
      GROUP BY ph.funnel_order
    ) y
  ),

  -- Distribuição por fase ATUAL do período (soma = total). Volume atual, não fluxo.
  'phaseDistribution', (
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object(
        'phase', phase, 'kind', kind, 'order', ord, 'leads', leads)
        ORDER BY ord NULLS LAST, leads DESC), '[]'::jsonb)
    FROM (
      SELECT COALESCE(NULLIF(btrim(current_phase), ''), '—') AS phase,
             phase_kind                                      AS kind,
             current_funnel_order                            AS ord,
             count(*)                                        AS leads
      FROM period
      GROUP BY 1, 2, 3
    ) pd
  ),

  -- Drill-down da distribuição: por fase atual, quem está PARADO ali por responsável (soma = barra).
  'phaseByResponsible', (
    SELECT COALESCE(jsonb_object_agg(phase, agents), '{}'::jsonb)
    FROM (
      SELECT phase,
             jsonb_agg(jsonb_build_object('agentId', g.agent_id, 'name', g.name, 'count', g.c)
                       ORDER BY g.c DESC, g.name) AS agents
      FROM (
        SELECT COALESCE(NULLIF(btrim(pr.current_phase), ''), '—') AS phase,
               pr.responsible_agent_id                            AS agent_id,
               CASE WHEN pr.responsible_agent_id IS NULL THEN 'Sem responsável'
                    ELSE COALESCE(la.pipefy_name, 'Sem nome') END AS name,
               count(*)                                           AS c
        FROM period pr
        LEFT JOIN public.lead_agents la ON la.id = pr.responsible_agent_id
        GROUP BY 1, 2, 3
      ) g
      GROUP BY phase
    ) x
  ),

  -- Motivos de descarte = FASE MORTA (não discard_reason), ordenados por volume.
  'deadReasons', (
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('reason', reason, 'leads', leads)
                ORDER BY leads DESC, reason), '[]'::jsonb)
    FROM (
      SELECT COALESCE(NULLIF(btrim(current_phase), ''), 'Não informado') AS reason,
             count(*) AS leads
      FROM period
      WHERE is_dead
      GROUP BY 1
    ) d
  ),

  -- "Em qual tentativa o lead mais morre": mortos por última ordem produtiva (-1 → 0).
  'deathByOrder', (
    SELECT COALESCE(jsonb_object_agg(ord::text, deaths), '{}'::jsonb)
    FROM (
      SELECT GREATEST(COALESCE(max_funnel_order, -1), 0) AS ord, count(*) AS deaths
      FROM period
      WHERE is_dead
      GROUP BY 1
    ) e
  ),

  -- Desempenho por canal. Front aplica top-12 + Outros.
  'channels', (
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object(
        'channel', channel, 'total', total, 'won', won, 'dead', dead)
        ORDER BY total DESC, channel), '[]'::jsonb)
    FROM (
      SELECT COALESCE(NULLIF(btrim(channel), ''), 'Não informado') AS channel,
             count(*)                        AS total,
             count(*) FILTER (WHERE is_won)  AS won,
             count(*) FILTER (WHERE is_dead) AS dead
      FROM period
      GROUP BY 1
    ) c
  ),
  'channelFilled', (SELECT count(*) FROM period WHERE NULLIF(btrim(channel), '') IS NOT NULL),

  -- Ranking por agente. Exclui sem-responsável e duplicados. avg_ftc ignora retroativos.
  'ranking', (
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object(
        'agentId', agent_id,
        'name',    COALESCE(la.pipefy_name, 'Sem nome'),
        'total',   total, 'won', won, 'dead', dead,
        'avgHoursToFirstContact', avg_ftc)), '[]'::jsonb)
    FROM (
      SELECT responsible_agent_id                          AS agent_id,
             count(*)                                      AS total,
             count(*) FILTER (WHERE is_won)                AS won,
             count(*) FILTER (WHERE is_dead)               AS dead,
             round(avg(hours_to_first_contact) FILTER (WHERE hours_to_first_contact >= 0)::numeric, 1) AS avg_ftc
      FROM period
      WHERE responsible_agent_id IS NOT NULL AND NOT duplicate_responsible
      GROUP BY responsible_agent_id
    ) r
    LEFT JOIN public.lead_agents la ON la.id = r.agent_id
  )
);
$$;

GRANT EXECUTE ON FUNCTION public.get_leads_dashboard(timestamptz, timestamptz) TO authenticated;

COMMIT;

-- ============================================================================
-- Verificação (ajuste o ciclo):
--   SELECT jsonb_pretty(public.get_leads_dashboard('2026-06-11T03:00:00Z','2026-07-11T03:00:00Z'));
-- Esperado:
--   • soma de funnelByResponsible['0'][].count == funnelByOrder['0'] (== kpis.total)
--   • para cada fase F: soma de phaseByResponsible[F][].count == leads de F em phaseDistribution
--   • v_duplicate_responsibility agora traz pipefy_card_id
-- ============================================================================
