-- ============================================================================
-- CS — Página 2 (Equipe) v2: reorganização das métricas (feedback do dono 2026-07-23)
-- ============================================================================
-- Só troca o CORPO de get_cs_team (a assinatura é a mesma). Forward-only: não edita
-- a 20260722 já aplicada.
--
-- Mudanças pedidas:
--   · Movimento: sai "Ativos" e a barra de distribuição (viravam ruído). Ordem de
--     colunas = Recebidos · Movido c/ atualização · Movido s/ atualização · Só
--     atualização · Sem mover/atualizar.
--   · Completude "de todos os cards ativos" (foto, sem período) REMOVIDA — não
--     filtrava por período.
--   · Negociações feitas = negociações FEITAS NO PERÍODO por responsável, com
--     Total/Completas/Parcial/Incompletas + drill-down (cards + campos faltando +
--     pipefy_card_id pra montar a URL). Sai a quebra pelos 5 campos (tiers).
--
-- "Negociação feita no período" = card com snapshot em [start,end] e changed_fields
-- não vazio (mudança real nos 5 campos — decisão do dono). A completude é a do estado
-- ATUAL do card (metadata), pra o "campos faltando" do drill-down ser acionável (o
-- que falta AGORA pra ir preencher). Completa=5 · Parcial=3–4 com Q.D · Incompleta=resto.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_cs_team(p_start timestamptz, p_end timestamptz)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH
  excl AS (
    SELECT id, name FROM public.cs_phases WHERE is_negotiation OR exclude_from_movement
  ),
  -- ── Movimento (coorte = cards ativos) ──────────────────────────────────────
  active_cards AS (
    SELECT c.id, c.responsible_agent_id
    FROM public.cs_cards c
    LEFT JOIN public.cs_phases ph ON ph.id = c.current_phase_id
    WHERE COALESCE(ph.is_terminal, false) = false
  ),
  moved AS (
    SELECT DISTINCT e.cs_card_id
    FROM public.cs_card_events e
    WHERE e.occurred_at >= p_start AND e.occurred_at < p_end
      AND e.to_phase_id NOT IN (SELECT id FROM excl)
      AND COALESCE(e.from_phase_id, '') NOT IN (SELECT id FROM excl)
      AND COALESCE(e.from_phase, '')    NOT IN (SELECT name FROM excl)
  ),
  commented AS (
    SELECT DISTINCT k.cs_card_id
    FROM public.cs_card_comments k
    WHERE k.created_at >= p_start AND k.created_at < p_end
  ),
  received AS (
    SELECT a.to_agent_id AS agent_id, count(*) AS n
    FROM public.cs_card_assignee_events a
    WHERE a.occurred_at >= p_start AND a.occurred_at < p_end
    GROUP BY a.to_agent_id
  ),
  move_flags AS (
    SELECT
      ac.responsible_agent_id AS agent_id,
      (ac.id IN (SELECT cs_card_id FROM moved))     AS is_moved,
      (ac.id IN (SELECT cs_card_id FROM commented)) AS is_commented
    FROM active_cards ac
  ),
  move_agent AS (
    SELECT
      mf.agent_id,
      count(*) FILTER (WHERE mf.is_moved AND mf.is_commented)         AS moved_with_update,
      count(*) FILTER (WHERE mf.is_moved AND NOT mf.is_commented)     AS moved_no_update,
      count(*) FILTER (WHERE NOT mf.is_moved AND mf.is_commented)     AS only_update,
      count(*) FILTER (WHERE NOT mf.is_moved AND NOT mf.is_commented) AS idle
    FROM move_flags mf
    GROUP BY mf.agent_id
  ),
  movement AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'agentId', ma.agent_id,
        'agentName', COALESCE(ag.pipefy_name, 'Sem responsável'),
        'received', COALESCE(rc.n, 0),
        'movedWithUpdate', ma.moved_with_update,
        'movedNoUpdate', ma.moved_no_update,
        'onlyUpdate', ma.only_update,
        'idle', ma.idle
      )
      ORDER BY (ma.moved_with_update + ma.moved_no_update + ma.only_update) DESC,
               ag.pipefy_name ASC NULLS LAST
    ), '[]'::jsonb) AS arr
    FROM move_agent ma
    LEFT JOIN public.cs_agents ag ON ag.id = ma.agent_id
    LEFT JOIN received rc ON rc.agent_id = ma.agent_id
  ),
  move_totals AS (
    SELECT jsonb_build_object(
      'received', (SELECT COALESCE(sum(n), 0) FROM received),
      'movedWithUpdate', COALESCE(sum(moved_with_update), 0),
      'movedNoUpdate', COALESCE(sum(moved_no_update), 0),
      'onlyUpdate', COALESCE(sum(only_update), 0),
      'idle', COALESCE(sum(idle), 0)
    ) AS obj
    FROM move_agent
  ),
  -- ── Negociações feitas NO PERÍODO (mudança real nos 5 campos) ───────────────
  neg_cards AS (
    SELECT
      c.pipefy_card_id, c.title, c.responsible_agent_id,
      public.cs_field_filled(c.metadata, 'q_d_valor_da_quita_o_com_desconto')           AS f_qd,
      public.cs_field_filled(c.metadata, 'q_a_valor_da_quita_o_atualizada_sem_desconto') AS f_qa,
      public.cs_field_filled(c.metadata, 'p_a_parcelas_em_atraso')                       AS f_pa,
      public.cs_field_filled(c.metadata, 'p_p_parcelas_a_pagar')                         AS f_pp,
      public.cs_field_filled(c.metadata, 'p_v_parcelas_vencer')                          AS f_pv
    FROM public.cs_cards c
    WHERE c.id IN (
      SELECT DISTINCT s.cs_card_id
      FROM public.cs_negotiation_snapshots s
      WHERE s.captured_at >= p_start AND s.captured_at < p_end
        AND COALESCE(array_length(s.changed_fields, 1), 0) > 0
    )
  ),
  neg_final AS (
    SELECT
      pipefy_card_id, title, responsible_agent_id,
      (f_qd + f_qa + f_pa + f_pp + f_pv) AS filled,
      array_remove(ARRAY[
        CASE WHEN f_qd = 0 THEN 'Q.D' END,
        CASE WHEN f_qa = 0 THEN 'Q.A' END,
        CASE WHEN f_pa = 0 THEN 'P.A' END,
        CASE WHEN f_pp = 0 THEN 'P.P' END,
        CASE WHEN f_pv = 0 THEN 'P.V' END
      ]::text[], NULL) AS missing,
      CASE
        WHEN (f_qd + f_qa + f_pa + f_pp + f_pv) = 5 THEN 'completa'
        WHEN (f_qd + f_qa + f_pa + f_pp + f_pv) BETWEEN 3 AND 4 AND f_qd = 1 THEN 'parcial'
        ELSE 'incompleta'
      END AS cls
    FROM neg_cards
  ),
  neg_agent AS (
    SELECT
      nf.responsible_agent_id AS agent_id,
      count(*) AS total,
      count(*) FILTER (WHERE cls = 'completa')   AS completa,
      count(*) FILTER (WHERE cls = 'parcial')    AS parcial,
      count(*) FILTER (WHERE cls = 'incompleta') AS incompleta,
      jsonb_agg(jsonb_build_object(
        'pipefyCardId', nf.pipefy_card_id,
        'title', nf.title,
        'cls', nf.cls,
        'missing', to_jsonb(nf.missing)
      ) ORDER BY nf.cls, nf.title) AS cards
    FROM neg_final nf
    GROUP BY nf.responsible_agent_id
  ),
  negotiations AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'agentId', na.agent_id,
        'agentName', COALESCE(ag.pipefy_name, 'Sem responsável'),
        'total', na.total,
        'completa', na.completa,
        'parcial', na.parcial,
        'incompleta', na.incompleta,
        'cards', na.cards
      )
      ORDER BY na.total DESC, ag.pipefy_name ASC NULLS LAST
    ), '[]'::jsonb) AS arr
    FROM neg_agent na
    LEFT JOIN public.cs_agents ag ON ag.id = na.agent_id
  ),
  neg_totals AS (
    SELECT jsonb_build_object(
      'total', COALESCE(sum(total), 0),
      'completa', COALESCE(sum(completa), 0),
      'parcial', COALESCE(sum(parcial), 0),
      'incompleta', COALESCE(sum(incompleta), 0)
    ) AS obj
    FROM neg_agent
  )
  SELECT jsonb_build_object(
    'periodStart', p_start,
    'periodEnd', p_end,
    'movement', (SELECT arr FROM movement),
    'movementTotals', (SELECT obj FROM move_totals),
    'negotiations', (SELECT arr FROM negotiations),
    'negotiationTotals', (SELECT obj FROM neg_totals)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_cs_team(timestamptz, timestamptz) TO authenticated;

-- ── Conferir depois de aplicar ──────────────────────────────────────────────
-- SELECT get_cs_team(now() - interval '400 days', now()) -> 'negotiationTotals';
-- SELECT jsonb_array_length(get_cs_team(now() - interval '400 days', now()) -> 'movement') as agentes;
