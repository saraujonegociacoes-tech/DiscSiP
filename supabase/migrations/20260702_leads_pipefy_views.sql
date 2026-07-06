-- ============================================================================
-- Dashboard de Leads (Pipefy) — S0: views agregadas (métricas do catálogo)
-- ============================================================================
-- As métricas são calculadas UMA vez no banco; o front só lê o resultado pronto
-- (protege egress). Ver catalogo-metricas-dashboard-leads.
--
-- security_invoker = true em TODAS as views: sem isso, a view rodaria com a
-- permissão do dono e BYPASSARIA o RLS -> todo agente veria todos os leads. Com
-- ele, o RLS do usuário logado vale em cada nível, então a MESMA view serve às
-- duas visões: agente vê só o próprio recorte, supervisor/gerente/admin veem tudo.
--
-- Classificação de fase por pipefy_phase_id (LEFT JOIN soft: fase nova/renomeada
-- no Pipefy não quebra nada, só fica sem classificação até ser cadastrada).
-- Views normais (não materializadas) de propósito: materialized view não respeita
-- o RLS do invocador. Idempotente (CREATE OR REPLACE VIEW).
-- ============================================================================

-- ── Base: um lead enriquecido (classificação, progresso no funil, tempos) ─────
-- max_funnel_order = fase produtiva mais avançada alcançada, olhando o histórico
-- de eventos E a fase atual (cobre lead morto que passou pelo funil antes de morrer).
CREATE OR REPLACE VIEW public.v_lead_progress
WITH (security_invoker = true) AS
SELECT
  l.id                     AS lead_id,
  l.responsible_agent_id,
  l.current_phase,
  cp.kind                  AS phase_kind,
  cp.funnel_order          AS current_funnel_order,
  l.created_at,
  l.first_contact_at,
  l.finalized_at,
  l.updated_at,
  l.discard_reason,
  l.channel,
  l.duplicate_responsible,
  (cp.kind = 'morta')      AS is_dead,
  (l.finalized_at IS NULL) AS is_open,
  GREATEST(COALESCE(cp.funnel_order, -1), COALESCE(ev.reached, -1)) AS max_funnel_order,
  (GREATEST(COALESCE(cp.funnel_order, -1), COALESCE(ev.reached, -1)) >= won.ord) AS is_won,
  CASE WHEN l.first_contact_at IS NOT NULL AND l.created_at IS NOT NULL
       THEN EXTRACT(EPOCH FROM (l.first_contact_at - l.created_at)) / 3600.0
  END AS hours_to_first_contact,
  CASE WHEN l.updated_at IS NOT NULL
       THEN EXTRACT(EPOCH FROM (now() - l.updated_at)) / 3600.0
  END AS hours_since_update
FROM public.leads l
LEFT JOIN public.lead_phases cp ON cp.pipefy_phase_id = l.current_phase_id
CROSS JOIN (SELECT funnel_order AS ord FROM public.lead_phases WHERE is_won LIMIT 1) won
LEFT JOIN LATERAL (
  SELECT max(p2.funnel_order) AS reached
  FROM public.lead_events e
  JOIN public.lead_phases p2 ON p2.pipefy_phase_id = e.to_phase_id
  WHERE e.lead_id = l.id
) ev ON true;

-- ── KPIs por agente (base do ranking do supervisor E dos KPIs do agente) ──────
-- Sob RLS: o agente recebe só a própria linha; o supervisor recebe todas.
-- Limite de "parado" provisório em 48h (decisão aberta — ver sprints doc).
CREATE OR REPLACE VIEW public.v_agent_kpis
WITH (security_invoker = true) AS
SELECT
  la.id          AS agent_id,
  la.pipefy_name,
  la.email,
  count(p.lead_id)                                          AS total_leads,
  count(*) FILTER (WHERE p.is_open)                         AS open_leads,
  count(*) FILTER (WHERE p.is_won)                          AS won_leads,
  count(*) FILTER (WHERE p.is_dead)                         AS dead_leads,
  count(*) FILTER (WHERE p.is_open AND p.hours_since_update > 48) AS stuck_leads,
  round(avg(p.hours_to_first_contact)::numeric, 1)         AS avg_hours_to_first_contact,
  round(count(*) FILTER (WHERE p.is_won)::numeric  / NULLIF(count(p.lead_id), 0), 4) AS conversion_rate,
  round(count(*) FILTER (WHERE p.is_dead)::numeric / NULLIF(count(p.lead_id), 0), 4) AS dead_rate
FROM public.lead_agents la
JOIN public.v_lead_progress p ON p.responsible_agent_id = la.id
GROUP BY la.id, la.pipefy_name, la.email;

-- ── Funil de acionamento (quantos leads alcançaram cada etapa) ────────────────
CREATE OR REPLACE VIEW public.v_funnel
WITH (security_invoker = true) AS
SELECT
  ph.funnel_order,
  ph.name          AS phase_name,
  count(p.lead_id) AS leads_reached
FROM public.lead_phases ph
LEFT JOIN public.v_lead_progress p ON p.max_funnel_order >= ph.funnel_order
WHERE ph.kind = 'produtiva'
GROUP BY ph.funnel_order, ph.name
ORDER BY ph.funnel_order;

-- ── Motivos de lead morto (donut) ─────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_dead_reasons
WITH (security_invoker = true) AS
SELECT
  COALESCE(NULLIF(trim(p.discard_reason), ''), 'Não informado') AS reason,
  count(*) AS leads
FROM public.v_lead_progress p
WHERE p.is_dead
GROUP BY COALESCE(NULLIF(trim(p.discard_reason), ''), 'Não informado')
ORDER BY count(*) DESC;

-- ── Distribuição por fase atual ───────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_phase_distribution
WITH (security_invoker = true) AS
SELECT
  p.current_phase        AS phase,
  p.phase_kind           AS kind,
  p.current_funnel_order AS funnel_order,
  count(*)               AS leads
FROM public.v_lead_progress p
GROUP BY p.current_phase, p.phase_kind, p.current_funnel_order
ORDER BY p.current_funnel_order NULLS LAST;

-- ── Alerta: leads com responsabilidade duplicada (não entram no ranking) ──────
CREATE OR REPLACE VIEW public.v_duplicate_responsibility
WITH (security_invoker = true) AS
SELECT
  l.id            AS lead_id,
  l.title,
  l.current_phase,
  la.pipefy_name  AS responsible,
  l.updated_at
FROM public.leads l
LEFT JOIN public.lead_agents la ON la.id = l.responsible_agent_id
WHERE l.duplicate_responsible;
