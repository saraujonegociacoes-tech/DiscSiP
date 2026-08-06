-- ============================================================================
-- Dashboard de Leads (Pipefy) — S2: SLA por fase + "lead parado"
-- ============================================================================
-- Introduz o conceito de "lead parado" por SLA de FASE (a cadência de acionamento
-- definida pela operação), substituindo o stuck_leads de 48h fixo da v_agent_kpis
-- (que satura na base histórica).
--
-- Modelo do SLA (decisão do dono): sla_hours é o prazo, contado a partir do
-- RECEBIMENTO do lead (leads.created_at), para o lead SAIR da fase atual — ou seja,
-- fazer a PRÓXIMA tentativa de contato. Contar de created_at (e não de updated_at) é
-- estável: updated_at reseta em qualquer edição do card; a cadência é fixa desde o D+0.
--
-- Cadência informada (D+N = N dias após o recebimento):
--   Recebidos          → 1ª tentativa: D+0, 3 min (WhatsApp)          → 0.05 h
--   1° Acionamento     → 2ª tentativa: D+0 (Ligação, mesmo dia)       → 8    h
--   2° Acionamento     → 3ª tentativa: D+1 (Ligação manhã)            → 24   h
--   3° Acionamento     → 4ª tentativa: D+2 (WhatsApp+áudio tarde)     → 48   h
--   4° Acionamento     → 5ª tentativa: D+4 (Ligação fora do horário)  → 96   h
--   5° Acionamento     → 6ª tentativa: D+7 (WhatsApp)                 → 168  h
--   6° Acionamento     → sem próxima tentativa (aguarda desfecho)     → NULL
--   Procedimento/Fechamento/Venda/mortas                             → NULL
--
-- Fases com sla_hours NULL nunca ficam "paradas".
--
-- COMO USAR: cole no SQL Editor do Supabase e rode uma vez. Idempotente.
-- Depende do schema de leads já aplicado (supabase/manual/leads_dashboard_setup.sql).
-- ============================================================================

BEGIN;

-- ── 1. Coluna de SLA na dimensão de fase (chave = id do Pipefy) ──────────────
ALTER TABLE public.lead_phases ADD COLUMN IF NOT EXISTS sla_hours numeric;

-- ── 2. Seed do SLA por fase (por pipefy_phase_id — nomes têm lixo, ver S0) ────
UPDATE public.lead_phases SET sla_hours = 0.05 WHERE pipefy_phase_id = '342851010'; -- Recebidos → 1ª (D+0, 3 min)
UPDATE public.lead_phases SET sla_hours = 8    WHERE pipefy_phase_id = '342851011'; -- 1° Acionamento → 2ª (D+0)
UPDATE public.lead_phases SET sla_hours = 24   WHERE pipefy_phase_id = '343269928'; -- 2° Acionamento → 3ª (D+1)
UPDATE public.lead_phases SET sla_hours = 48   WHERE pipefy_phase_id = '343269944'; -- 3° Acionamento → 4ª (D+2)
UPDATE public.lead_phases SET sla_hours = 96   WHERE pipefy_phase_id = '343269967'; -- 4° Acionamento → 5ª (D+4)
UPDATE public.lead_phases SET sla_hours = 168  WHERE pipefy_phase_id = '343269973'; -- 5° Acionamento → 6ª (D+7)
-- 6° Acionamento (343269982), Procedimento, Fechamento, Venda e fases mortas ficam NULL.

-- ── 3. v_lead_progress: expõe title + sla_hours + is_stuck ────────────────────
-- CREATE OR REPLACE (não DROP): preserva as 18 colunas atuais na MESMA ordem e só
-- anexa novas ao final, então as views dependentes (v_agent_kpis, v_funnel,
-- v_dead_reasons, v_phase_distribution) continuam válidas sem recriação.
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
  END AS hours_since_update,
  -- ── novas colunas (S2) ──
  l.title                  AS title,
  cp.sla_hours,
  (
        l.finalized_at IS NULL                                                  -- aberto
    AND cp.kind IS DISTINCT FROM 'morta'                                        -- não morto
    AND GREATEST(COALESCE(cp.funnel_order, -1), COALESCE(ev.reached, -1)) < won.ord  -- não ganho
    AND cp.sla_hours IS NOT NULL                                                -- fase com SLA
    AND l.created_at IS NOT NULL
    AND EXTRACT(EPOCH FROM (now() - l.created_at)) / 3600.0 > cp.sla_hours      -- estourou a cadência
  ) AS is_stuck
FROM public.leads l
LEFT JOIN public.lead_phases cp ON cp.pipefy_phase_id = l.current_phase_id
CROSS JOIN (SELECT funnel_order AS ord FROM public.lead_phases WHERE is_won LIMIT 1) won
LEFT JOIN LATERAL (
  SELECT max(p2.funnel_order) AS reached
  FROM public.lead_events e
  JOIN public.lead_phases p2 ON p2.pipefy_phase_id = e.to_phase_id
  WHERE e.lead_id = l.id
) ev ON true;

COMMIT;

-- ============================================================================
-- Verificação rápida (rode depois, separado):
--   SELECT name, funnel_order, sla_hours FROM public.lead_phases ORDER BY funnel_order NULLS LAST;
--   SELECT count(*) FILTER (WHERE is_stuck) AS parados, count(*) FILTER (WHERE is_open) AS abertos
--   FROM public.v_lead_progress;
--
-- Resultado da 1ª execução (06/jul, visão-deus do dono, sem RLS): 3321 parados / 3564
-- abertos (93%). NÃO é bug — o backlog é genuinamente vencido (agora−created_at estoura
-- qualquer SLA). O acionável é o split ciclo × retroativo por agente (ver S2 nos sprints).
-- ============================================================================

-- ── AJUSTE POSTERIOR DO SLA (opcional) ───────────────────────────────────────
-- is_stuck é calculado NA LEITURA da view (now() − created_at > sla_hours), então trocar
-- sla_hours vale IMEDIATAMENTE no próximo carregamento — sem reingestão nem recriar a view.
-- Rode só as linhas que quiser mudar:
--   UPDATE public.lead_phases SET sla_hours = 0.05 WHERE pipefy_phase_id = '342851010'; -- Recebidos
--   UPDATE public.lead_phases SET sla_hours = 8    WHERE pipefy_phase_id = '342851011'; -- 1° Acionamento
-- ============================================================================
