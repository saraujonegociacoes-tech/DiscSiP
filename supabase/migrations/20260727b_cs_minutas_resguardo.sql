-- ============================================================================
-- Painel de CS — Página 3 (Minutas): métrica de Valor Resguardado
-- ============================================================================
-- Adendo à 20260727_cs_minutas.sql (já aplicada). Só faz CREATE OR REPLACE de
-- get_cs_minutas() pra incluir o RESGUARDO — migration é forward-only, não se edita
-- a anterior. Os parsers cs_parse_money/cs_parse_date continuam os da 20260727.
--
-- Regra do resguardo (decisões do dono 2026-07-27):
--   • Fonte = SÓ a série mensal `valor_de_resguardo_N` (N = 1..∞). NÃO usa os campos
--     "atualmente / até o momento" (há 7 famílias de campo de resguardo no pipe; o dono
--     escolheu a série mensal).
--   • Por card, pega o valor do **mês mais avançado (maior N) cujo valor é > 0** — pula os
--     "0,00" (um preenchimento zerado recente não apaga o último resguardo real). NÃO é a
--     fase atual do card: é o maior N preenchido no metadata.
--   • `resguardoTotal` = Σ desse resguardo sobre **TODOS os cards escopados, sem exceção**
--     (com ou sem minuta, ativo ou terminal) — é o resguardo da carteira. Fica fixo,
--     independente dos filtros da tela (que só recortam a lista de minutas).
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
      -- Maior N de `valor_de_resguardo_N` com valor > 0 (ignora "0,00"). O nº do mês sai dos
      -- dígitos da chave. cs_parse_money nunca lança (exceção → NULL), então o filtro > 0 é seguro.
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
    -- Resguardo da CARTEIRA: todos os cards escopados, sem exceção.
    'resguardoTotal', COALESCE((SELECT sum(resguardo) FROM base WHERE resguardo IS NOT NULL), 0),
    'resguardoCount', (SELECT count(*) FROM base WHERE resguardo IS NOT NULL),
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
-- SELECT get_cs_minutas() -> 'resguardoTotal';                       -- Σ resguardo da carteira
-- SELECT get_cs_minutas() -> 'resguardoCount';                       -- cards com resguardo > 0
-- SELECT get_cs_minutas() -> 'cards' -> 0 -> 'resguardo';            -- resguardo de um card
-- SELECT get_cs_minutas() -> 'cards' -> 0 -> 'resguardoMonth';       -- de qual mês veio
