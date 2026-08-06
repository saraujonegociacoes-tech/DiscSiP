-- ============================================================================
-- Dashboard de Leads (Pipefy) — correções de CONTABILIZAÇÃO dos painéis
-- ============================================================================
-- Três bugs encontrados ao revisar os painéis (08/jul), corrigidos JUNTOS numa
-- migration incremental. NÃO toca em tabelas/dados: só recria a função e a view
-- (CREATE OR REPLACE, idempotente). O app tem fallback em memória (dashboardFromScan)
-- com a MESMA lógica, então enquanto isto não roda a tela segue correta (só mais lenta).
--
-- (1) FUNIL — "Recebidos" subcontava. max_funnel_order = -1 para lead morto sem evento
--     produtivo (entrou e foi direto pra fase morta, sem registro de acionamento) →
--     sumia do funil inteiro. Ex.: ciclo com 1110 recebidos mostrava "Recebidos" = 969
--     (os 141 fantasmas). Todo lead recebido passou por "Recebidos" por definição, então
--     a ordem 0 agora conta TODOS os leads do período (ancorada em 100%). As ordens ≥ 1
--     seguem max_funnel_order >= ordem.
--
-- (2) MOTIVOS DE LEAD MORTO — vinham de leads.discard_reason, que é TEXTO LIVRE do agente
--     (430 vazios + centenas de variações: "Tarado.", "não tem financiamento" em 15
--     grafias, parágrafos…). Trocado pela FASE MORTA (current_phase de quem is_dead):
--     Sem Finalidade / Empréstimo / Quitação-Negociação — dado estruturado e confiável.
--
-- (3) TEMPO ATÉ 1º CONTATO — dava média NEGATIVA. Causa legítima: lead retroativo — a
--     vendedora pega um lead antigo (anterior ao card no pipe) e preenche o 1º contato com
--     a data real (ex.: janeiro), que fica ANTES do created_at. Isso não é tempo de
--     resposta. A média (KPI e ranking) passa a considerar só first_contact_at >= created_at
--     (via FILTER hours_to_first_contact >= 0); os retroativos saem da conta.
--
-- (+) DISTRIBUIÇÃO POR FASE ATUAL — nova seção phaseDistribution: quantos leads do período
--     estão AGORA em cada fase (soma = total recebido). É o "volume atual" que o funil
--     cumulativo não mostra (Storytelling with Data: distribuição ≠ fluxo).
--
-- (+) "Em qual etapa morreu" (deathByOrder) — os mortos com max_funnel_order = -1 (mesmos
--     141 do funil) agora contam na ordem 0 (Recebidos), em vez de sumir.
-- ============================================================================

BEGIN;

-- ── View de motivos de lead morto: agora pela FASE MORTA (não pelo texto livre) ──
CREATE OR REPLACE VIEW public.v_dead_reasons
WITH (security_invoker = true) AS
SELECT
  COALESCE(NULLIF(btrim(p.current_phase), ''), 'Não informado') AS reason,
  count(*) AS leads
FROM public.v_lead_progress p
WHERE p.is_dead
GROUP BY COALESCE(NULLIF(btrim(p.current_phase), ''), 'Não informado')
ORDER BY count(*) DESC;

-- ── RPC agregado do dashboard (nova versão com as 3 correções + distribuição) ────
CREATE OR REPLACE FUNCTION public.get_leads_dashboard(p_start timestamptz, p_end timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
WITH period AS MATERIALIZED (
  -- Só as colunas que as agregações usam. MATERIALIZED garante que v_lead_progress
  -- (view com LATERAL sobre lead_events) seja avaliada UMA vez, não uma por subquery.
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

  -- Funil (cumulativo): ordem 0 = TODOS os recebidos (ancorada em 100%); ordens ≥ 1
  -- contam quem alcançou aquela ordem ou além. O front casa cada ordem com o rótulo limpo.
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

  -- Motivos de descarte = FASE MORTA (não mais discard_reason), já ordenados por volume.
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

  -- "Em qual tentativa o lead mais morre": mortos por última ordem produtiva alcançada.
  -- max_funnel_order = -1 (morto sem evento produtivo) cai na ordem 0 (Recebidos).
  'deathByOrder', (
    SELECT COALESCE(jsonb_object_agg(ord::text, deaths), '{}'::jsonb)
    FROM (
      SELECT GREATEST(COALESCE(max_funnel_order, -1), 0) AS ord, count(*) AS deaths
      FROM period
      WHERE is_dead
      GROUP BY 1
    ) e
  ),

  -- Desempenho por canal (valor cru; vazio → "Não informado"). Front aplica top-12 + Outros.
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

  -- Ranking por agente. Exclui sem-responsável e responsabilidade duplicada. avg_ftc
  -- ignora retroativos (contato < criação), igual ao KPI.
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
-- Verificação (rode com o ciclo corrente; ajuste as datas):
--   SELECT jsonb_pretty(public.get_leads_dashboard('2026-06-11T03:00:00Z','2026-07-11T03:00:00Z'));
-- Esperado agora:
--   • kpis.total == funnelByOrder->>'0' (Recebidos ancorado em 100%)
--   • soma de phaseDistribution[].leads == kpis.total
--   • soma de deadReasons[].leads == kpis.dead, com 3 fases (Sem Finalidade / Empréstimo /
--     Quitação-Negociação), sem texto livre
--   • kpis.avgHoursToFirstContact >= 0 (retroativos fora)
-- ============================================================================
