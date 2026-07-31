-- ============================================================================
-- Leads — acionamento contado por ENTRADA REAL de fase (não por updated_at nem
-- por max_funnel_order cumulativo)
-- ============================================================================
-- Sintoma relatado pelo dono (aba Funil):
--   1) Card movido de "1° Acionamento" direto para "Fechamento" era contado como
--      se tivesse passado por 2°/3°/4°/5°/6° também. Causa: o funil conta com a
--      regra `max_funnel_order >= ordem` (cumulativa) — se o lead ALCANÇOU a ordem
--      8, ele "preenche" todas as ordens intermediárias, mesmo sem nunca entrar
--      nelas.
--   2) Qualquer atualização do card (editar um campo) virava "lead acionado" e
--      entrava na métrica. Causa: o cohort "acionado no período" era `updated_at`
--      dentro do período — qualquer movimentação, não só mudança de fase.
--
-- Regra nova (decisão do dono, vale para TODOS os painéis de contabilização de
-- acionamento): um acionamento só acontece quando o card ENTRA numa fase. Contamos
-- ENTRADAS REAIS de fase, derivadas de `lead_events` (o log que o Make grava a cada
-- poll: `to_phase_id` + `occurred_at`). Uma "entrada" é uma TRANSIÇÃO — a fase mudou
-- de fato — detectada com LAG sobre o histórico do lead: um evento conta como
-- entrada só quando o `to_phase_id` difere do evento anterior daquele lead. Isso
-- descarta os "pings" de mesma fase (updates de campo sem trocar de fase) e nunca
-- preenche fases puladas (só conta a etapa em que houve evento de entrada).
--
-- Trade-offs conhecidos (documentados no fix; o dono aceitou):
--   • O poll roda a cada 30 min. Fase atravessada MAIS RÁPIDO que a janela do poll
--     pode não gerar evento próprio → não é contada (antes, com o `max`, era contada
--     por tabela). É o comportamento correto sob "só conta quando entra na fase".
--   • A carga histórica (import) gravou UM evento por card = a fase no momento do
--     import. Fases que o lead atravessou ANTES do import não têm evento → não são
--     contadas para leads antigos. Vale sobretudo para o lado retroativo.
--
-- Todas as funções são SECURITY INVOKER (default) e escopam por papel via
-- `EXISTS (v_lead_progress)` — mesmo padrão de `get_leads_dwell_time` (20260723b),
-- já que `lead_events` não tem policy própria de RLS. `lead_phases.funnel_order` é
-- NULL nas fases mortas; filtramos `IS NOT NULL` para contar só etapas produtivas.
-- ============================================================================

-- ── 1. Funil "geral" (acionado no período) — reescrito por entrada de fase ────
-- SUBSTITUI get_leads_activity (20260718). Mesma FORMA de retorno (funnelByOrder +
-- phaseDistribution, cada linha com total/cycle/retro), mas:
--   • cohort "acionado" = leads que tiveram alguma ENTRADA de fase no período
--     (antes: qualquer updated_at no período).
--   • funnelByOrder[N] = leads que ENTRARAM numa fase de ordem N DENTRO do período
--     (antes: max_funnel_order >= N, cumulativo). Ordem 0 = entradas em "Recebidos"
--     no período (novos que apareceram em Recebidos) — não mais "todo o cohort".
--   • cycle/retro: classificação por created_at do lead (dentro do período = ciclo).
CREATE OR REPLACE FUNCTION public.get_leads_activity(p_start timestamptz, p_end timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH ev AS (
    -- todos os eventos do lead, com a fase do evento anterior (para detectar transição).
    -- LAG sobre o histórico COMPLETO (inclui fases mortas e pings de mesma fase), senão
    -- a detecção de "a fase mudou" fica errada.
    SELECT e.lead_id, e.to_phase_id, e.occurred_at,
      LAG(e.to_phase_id) OVER (PARTITION BY e.lead_id ORDER BY e.occurred_at) AS prev_phase_id
    FROM public.lead_events e
    WHERE EXISTS (SELECT 1 FROM public.v_lead_progress p WHERE p.lead_id = e.lead_id)
  ),
  entries AS (
    -- entradas REAIS (fase mudou) em etapa produtiva, ocorridas no período.
    SELECT ev.lead_id, ph.funnel_order, ev.occurred_at AS entered_at
    FROM ev
    JOIN public.lead_phases ph ON ph.pipefy_phase_id = ev.to_phase_id
    WHERE ev.prev_phase_id IS DISTINCT FROM ev.to_phase_id
      AND ph.funnel_order IS NOT NULL
      AND ev.occurred_at >= p_start AND ev.occurred_at < p_end
  ),
  acted AS (SELECT DISTINCT lead_id FROM entries),           -- cohort "acionado no período"
  reach AS (SELECT DISTINCT lead_id, funnel_order FROM entries), -- (lead, ordem) entrada no período
  lead_meta AS (
    SELECT p.lead_id, p.current_phase, p.phase_kind, p.current_funnel_order,
      (p.created_at >= p_start AND p.created_at < p_end) AS in_cycle
    FROM public.v_lead_progress p
  ),
  -- 0..9 = mesmo range de PRODUCTIVE_PHASES/WON_ORDER (src/features/leads/content/phases.ts).
  orders(funnel_order) AS (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)),
  funnel AS (
    SELECT o.funnel_order,
      COUNT(lm.lead_id) AS total,
      COUNT(lm.lead_id) FILTER (WHERE lm.in_cycle) AS cycle,
      COUNT(lm.lead_id) FILTER (WHERE NOT lm.in_cycle) AS retro
    FROM orders o
    LEFT JOIN reach r ON r.funnel_order = o.funnel_order
    LEFT JOIN lead_meta lm ON lm.lead_id = r.lead_id
    GROUP BY o.funnel_order
  ),
  phase AS (
    SELECT
      COALESCE(NULLIF(TRIM(lm.current_phase), ''), '—') AS phase,
      MAX(lm.phase_kind) AS kind,
      MAX(lm.current_funnel_order) AS funnel_order,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE lm.in_cycle) AS cycle,
      COUNT(*) FILTER (WHERE NOT lm.in_cycle) AS retro
    FROM acted a
    JOIN lead_meta lm ON lm.lead_id = a.lead_id
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

-- ── 2. Funil de acionamento PRINCIPAL (recebidos no período) por entrada ──────
-- Override do `funnelByOrder`/`funnelByResponsible` que `get_leads_dashboard` devolve
-- pelo funil principal (Funnel.tsx / StepConversion.tsx). Mesma decisão de escopo do
-- fix anterior: `get_leads_dashboard` é grande e não versionada no repo — em vez de
-- reescrevê-la, o app mescla este resultado por cima (degrada ao antigo se ausente).
--   • cohort = recebidos no período (created_at).
--   • funnelByOrder[N] (N>=1) = quantos DESSE cohort ENTRARAM numa fase de ordem N
--     em qualquer momento (não `max >= N`, então pulos não preenchem etapas).
--   • funnelByOrder[0] = todo o cohort (todo recebido entrou em "Recebidos", mesmo
--     que o evento de entrada não tenha sido capturado no import) — âncora robusta.
CREATE OR REPLACE FUNCTION public.get_leads_reach_funnel(p_start timestamptz, p_end timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH cohort AS (
    SELECT p.lead_id, p.responsible_agent_id
    FROM public.v_lead_progress p
    WHERE p.created_at >= p_start AND p.created_at < p_end
  ),
  ev AS (
    SELECT e.lead_id, e.to_phase_id, e.occurred_at,
      LAG(e.to_phase_id) OVER (PARTITION BY e.lead_id ORDER BY e.occurred_at) AS prev_phase_id
    FROM public.lead_events e
    WHERE EXISTS (SELECT 1 FROM cohort c WHERE c.lead_id = e.lead_id)
  ),
  reach AS (
    -- (lead, ordem) em que o lead REALMENTE entrou, qualquer momento (cohort é recente).
    SELECT DISTINCT ev.lead_id, ph.funnel_order
    FROM ev
    JOIN public.lead_phases ph ON ph.pipefy_phase_id = ev.to_phase_id
    WHERE ev.prev_phase_id IS DISTINCT FROM ev.to_phase_id
      AND ph.funnel_order IS NOT NULL
  ),
  -- cada lead entra na ordem 0 (Recebidos) + em cada ordem que realmente alcançou.
  lead_orders AS (
    SELECT c.lead_id, c.responsible_agent_id, x.funnel_order
    FROM cohort c
    CROSS JOIN LATERAL (
      SELECT 0 AS funnel_order
      UNION
      SELECT r.funnel_order FROM reach r WHERE r.lead_id = c.lead_id
    ) x
  ),
  counts AS (
    SELECT funnel_order, COUNT(*) AS total FROM lead_orders GROUP BY funnel_order
  ),
  by_resp AS (
    SELECT lo.funnel_order, lo.responsible_agent_id AS agent_id,
      CASE WHEN lo.responsible_agent_id IS NULL THEN 'Sem responsável'
           ELSE COALESCE(la.pipefy_name, 'Sem nome') END AS name,
      COUNT(*) AS cnt
    FROM lead_orders lo
    LEFT JOIN public.lead_agents la ON la.id = lo.responsible_agent_id
    GROUP BY lo.funnel_order, lo.responsible_agent_id, la.pipefy_name
  )
  SELECT jsonb_build_object(
    'funnelByOrder', (SELECT COALESCE(jsonb_object_agg(funnel_order::text, total), '{}'::jsonb) FROM counts),
    'funnelByResponsible', (
      SELECT COALESCE(jsonb_object_agg(fo, arr), '{}'::jsonb)
      FROM (
        SELECT funnel_order::text AS fo,
          jsonb_agg(jsonb_build_object('agentId', agent_id, 'name', name, 'count', cnt) ORDER BY cnt DESC, name) AS arr
        FROM by_resp
        GROUP BY funnel_order
      ) s
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_leads_reach_funnel(timestamptz, timestamptz) TO authenticated;

-- ── 3. Drill por responsável (2 passos) — reescrito por entrada de fase ───────
-- SUBSTITUI get_leads_drill_agents/get_leads_drill_cards (20260723c) para casar com a
-- nova contagem, senão o drill não bate com a barra clicada.
--   p_dimension:
--     'funnel'          → cohort recebidos no período; ENTROU na ordem p_key (0 = todos)
--     'phase'           → cohort recebidos no período; fase ATUAL = p_key
--     'funnel_activity' → ENTROU na ordem p_key DENTRO do período
--     'phase_activity'  → teve alguma ENTRADA no período; fase ATUAL = p_key
--   p_key: funnel* = ordem (texto); phase* = nome da fase atual normalizado.

CREATE OR REPLACE FUNCTION public.get_leads_drill_agents(
  p_dimension text, p_key text, p_start timestamptz, p_end timestamptz
)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH ev AS (
    SELECT e.lead_id, e.to_phase_id, e.occurred_at,
      LAG(e.to_phase_id) OVER (PARTITION BY e.lead_id ORDER BY e.occurred_at) AS prev_phase_id
    FROM public.lead_events e
    WHERE EXISTS (SELECT 1 FROM public.v_lead_progress p WHERE p.lead_id = e.lead_id)
  ),
  entries AS (
    SELECT ev.lead_id, ph.funnel_order, ev.occurred_at AS entered_at
    FROM ev
    JOIN public.lead_phases ph ON ph.pipefy_phase_id = ev.to_phase_id
    WHERE ev.prev_phase_id IS DISTINCT FROM ev.to_phase_id
      AND ph.funnel_order IS NOT NULL
  ),
  lead_meta AS (
    SELECT p.lead_id, p.responsible_agent_id AS agent_id, p.created_at,
      COALESCE(NULLIF(btrim(p.current_phase), ''), '—') AS phase_norm
    FROM public.v_lead_progress p
  ),
  picked AS (
    SELECT lm.lead_id, lm.agent_id
    FROM lead_meta lm
    WHERE CASE p_dimension
      WHEN 'funnel' THEN (lm.created_at >= p_start AND lm.created_at < p_end)
        AND (p_key = '0' OR EXISTS (SELECT 1 FROM entries en WHERE en.lead_id = lm.lead_id AND en.funnel_order = p_key::int))
      WHEN 'phase' THEN (lm.created_at >= p_start AND lm.created_at < p_end)
        AND lm.phase_norm = p_key
      WHEN 'funnel_activity' THEN EXISTS (
        SELECT 1 FROM entries en WHERE en.lead_id = lm.lead_id
          AND en.funnel_order = p_key::int AND en.entered_at >= p_start AND en.entered_at < p_end)
      WHEN 'phase_activity' THEN lm.phase_norm = p_key
        AND EXISTS (SELECT 1 FROM entries en WHERE en.lead_id = lm.lead_id
          AND en.entered_at >= p_start AND en.entered_at < p_end)
      ELSE false END
  ),
  by_agent AS (
    SELECT pk.agent_id,
      CASE WHEN pk.agent_id IS NULL THEN 'Sem responsável'
           ELSE COALESCE(la.pipefy_name, 'Sem nome') END AS name,
      count(*) AS c
    FROM picked pk
    LEFT JOIN public.lead_agents la ON la.id = pk.agent_id
    GROUP BY pk.agent_id, la.pipefy_name
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('agentId', agent_id, 'name', name, 'count', c)
                            ORDER BY c DESC, name), '[]'::jsonb)
  FROM by_agent;
$$;

GRANT EXECUTE ON FUNCTION public.get_leads_drill_agents(text, text, timestamptz, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_leads_drill_cards(
  p_dimension text, p_key text, p_agent uuid, p_start timestamptz, p_end timestamptz
)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH ev AS (
    SELECT e.lead_id, e.to_phase_id, e.occurred_at,
      LAG(e.to_phase_id) OVER (PARTITION BY e.lead_id ORDER BY e.occurred_at) AS prev_phase_id
    FROM public.lead_events e
    WHERE EXISTS (SELECT 1 FROM public.v_lead_progress p WHERE p.lead_id = e.lead_id)
  ),
  entries AS (
    SELECT ev.lead_id, ph.funnel_order, ev.occurred_at AS entered_at
    FROM ev
    JOIN public.lead_phases ph ON ph.pipefy_phase_id = ev.to_phase_id
    WHERE ev.prev_phase_id IS DISTINCT FROM ev.to_phase_id
      AND ph.funnel_order IS NOT NULL
  ),
  lead_meta AS (
    SELECT p.lead_id, p.responsible_agent_id AS agent_id, p.title, p.created_at,
      COALESCE(l.pipefy_card_id, p.lead_id::text) AS pipefy_card_id,
      COALESCE(NULLIF(btrim(p.current_phase), ''), '—') AS phase_norm
    FROM public.v_lead_progress p
    LEFT JOIN public.leads l ON l.id = p.lead_id
  ),
  picked AS (
    SELECT lm.pipefy_card_id, lm.title
    FROM lead_meta lm
    WHERE lm.agent_id IS NOT DISTINCT FROM p_agent
      AND CASE p_dimension
        WHEN 'funnel' THEN (lm.created_at >= p_start AND lm.created_at < p_end)
          AND (p_key = '0' OR EXISTS (SELECT 1 FROM entries en WHERE en.lead_id = lm.lead_id AND en.funnel_order = p_key::int))
        WHEN 'phase' THEN (lm.created_at >= p_start AND lm.created_at < p_end)
          AND lm.phase_norm = p_key
        WHEN 'funnel_activity' THEN EXISTS (
          SELECT 1 FROM entries en WHERE en.lead_id = lm.lead_id
            AND en.funnel_order = p_key::int AND en.entered_at >= p_start AND en.entered_at < p_end)
        WHEN 'phase_activity' THEN lm.phase_norm = p_key
          AND EXISTS (SELECT 1 FROM entries en WHERE en.lead_id = lm.lead_id
            AND en.entered_at >= p_start AND en.entered_at < p_end)
        ELSE false END
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('pipefyCardId', pipefy_card_id, 'title', title)
                            ORDER BY title NULLS LAST), '[]'::jsonb)
  FROM picked;
$$;

GRANT EXECUTE ON FUNCTION public.get_leads_drill_cards(text, text, uuid, timestamptz, timestamptz) TO authenticated;

-- ── Conferir depois de aplicar (SQL Editor) ─────────────────────────────────
-- Janela de exemplo: últimos 400 dias.
--   \set ini '''2025-06-27T03:00:00Z'''   -- ajuste
--   \set fim '''2026-07-31T03:00:00Z'''
--
-- 1) Um card conhecido que pulou de 1° Acionamento para Fechamento NÃO deve
--    aparecer nas ordens 2..7 do funil geral:
--   SELECT public.get_leads_activity('2025-06-27T03:00:00Z','2026-07-31T03:00:00Z') -> 'funnelByOrder';
--   -- some as ordens intermediárias esperadas e confira que o card sumiu delas.
--
-- 2) cycle + retro == total em toda ordem/fase (checagem visual do jsonb):
--   SELECT public.get_leads_activity('2025-06-27T03:00:00Z','2026-07-31T03:00:00Z');
--
-- 3) Funil principal (recebidos): ordem 0 == nº de recebidos no período.
--   SELECT (public.get_leads_reach_funnel('2025-06-27T03:00:00Z','2026-07-31T03:00:00Z') -> 'funnelByOrder' ->> '0')::int;
--   SELECT COUNT(*) FROM public.v_lead_progress
--     WHERE created_at >= '2025-06-27T03:00:00Z' AND created_at < '2026-07-31T03:00:00Z';
--   -- Devem bater.
--
-- 4) Drill bate com a barra: a soma dos counts do drill de uma ordem == total da barra.
--   SELECT sum((x->>'count')::int)
--   FROM jsonb_array_elements(public.get_leads_drill_agents('funnel_activity','2','2025-06-27T03:00:00Z','2026-07-31T03:00:00Z')) x;
--   -- == funnelByOrder->'2'->>'total' do get_leads_activity.
