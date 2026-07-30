-- ============================================================================
-- Painel de CS — Página 3 (Minutas): resguardo da carteira por situação
-- ============================================================================
-- Adendo à 20260727b_cs_minutas_resguardo.sql. Só faz CREATE OR REPLACE de
-- get_cs_minutas() — migration é forward-only. É auto-contida: redefine a função
-- inteira (não depende de a 20260727b ter rodado). Parsers cs_parse_money/
-- cs_parse_date continuam os da 20260727.
--
-- Mudança (dono 2026-07-27): o KPI "Resguardado na carteira" passa a acompanhar o
-- filtro Ativos/Inativos/Todos da tela. Por isso o resguardo agora volta QUEBRADO por
-- situação: `active` (cards não-terminais) e `inactive` (terminais). O cliente soma os
-- dois pra "Todos". A régra POR CARD não muda: um valor por card = o maior N de
-- `valor_de_resguardo_N` com valor > 0.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_cs_minutas()
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT
      c.pipefy_card_id,
      c.title,
      c.responsible_agent_id,
      ag.pipefy_name AS agent_name,
      c.current_phase_id,
      COALESCE(c.current_phase, 'Sem fase') AS phase_name,
      COALESCE(ph.is_terminal, false) AS is_terminal,
      public.cs_parse_money(c.metadata->'valor_resguardados_dos_clientes'->>'value') AS valor,
      public.cs_parse_money(c.metadata->'d_vida_atual_do_cliente'->>'value') AS divida,
      public.cs_parse_date(COALESCE(
        NULLIF(c.metadata->'data_da_quita_o'->>'value', ''),
        NULLIF(c.metadata->'data_da_quita_o'->>'datetime_value', '')
      )) AS due_date,
      COALESCE(
        NULLIF(c.metadata->'sele_o_de_etiqueta'->>'value', ''),
        NULLIF(c.metadata->'sele_o_de_etiqueta'->'array_value'->>0, '')
      ) AS etiqueta,
      rg.resguardo,
      rg.resguardo_month
    FROM public.cs_cards c
    LEFT JOIN public.cs_phases ph ON ph.id = c.current_phase_id
    LEFT JOIN public.cs_agents ag ON ag.id = c.responsible_agent_id
    LEFT JOIN LATERAL (
      -- Maior N de `valor_de_resguardo_N` com valor > 0 (ignora "0,00"). UM valor por card.
      SELECT
        public.cs_parse_money(kv.value->>'value') AS resguardo,
        (regexp_replace(kv.key, '\D', '', 'g'))::int AS resguardo_month
      FROM jsonb_each(c.metadata) kv
      WHERE kv.key ~ '^valor_de_resguardo_[0-9]+$'
        AND public.cs_parse_money(kv.value->>'value') > 0
      ORDER BY (regexp_replace(kv.key, '\D', '', 'g'))::int DESC
      LIMIT 1
    ) rg ON true
  )
  SELECT jsonb_build_object(
    'referenceAt', now(),
    'withoutMinuta', (SELECT count(*) FROM base WHERE due_date IS NULL),
    -- Resguardo da carteira quebrado por situação (o cliente casa com o filtro da tela).
    'resguardo', jsonb_build_object(
      'active', jsonb_build_object(
        'total', COALESCE((SELECT sum(resguardo) FROM base WHERE resguardo IS NOT NULL AND NOT is_terminal), 0),
        'count', (SELECT count(*) FROM base WHERE resguardo IS NOT NULL AND NOT is_terminal)
      ),
      'inactive', jsonb_build_object(
        'total', COALESCE((SELECT sum(resguardo) FROM base WHERE resguardo IS NOT NULL AND is_terminal), 0),
        'count', (SELECT count(*) FROM base WHERE resguardo IS NOT NULL AND is_terminal)
      )
    ),
    'cards', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'pipefyCardId', b.pipefy_card_id,
          'title', b.title,
          'agentId', b.responsible_agent_id,
          'agentName', COALESCE(b.agent_name, 'Sem responsável'),
          'active', NOT b.is_terminal,
          'phaseId', b.current_phase_id,
          'phase', b.phase_name,
          'valor', b.valor,
          'divida', b.divida,
          'descontoPct', CASE
            WHEN b.divida IS NOT NULL AND b.divida > 0 AND b.valor IS NOT NULL
              THEN round((1 - b.valor / b.divida) * 100, 1)
            ELSE NULL
          END,
          'etiqueta', b.etiqueta,
          'resguardo', b.resguardo,
          'resguardoMonth', b.resguardo_month,
          'dueDate', b.due_date,
          'daysToDue', (b.due_date - CURRENT_DATE)
        )
        ORDER BY b.due_date ASC
      )
      FROM base b
      WHERE b.due_date IS NOT NULL
    ), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_cs_minutas() TO authenticated;

-- ── Conferir depois de aplicar ──────────────────────────────────────────────
-- SELECT get_cs_minutas() -> 'resguardo';                            -- { active:{...}, inactive:{...} }
-- SELECT (get_cs_minutas() -> 'resguardo' -> 'active' ->> 'total')::numeric
--      + (get_cs_minutas() -> 'resguardo' -> 'inactive' ->> 'total')::numeric;  -- = "Todos"
