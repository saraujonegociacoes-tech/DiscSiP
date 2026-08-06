-- ============================================================================
-- Dashboard de Leads (Pipefy) — Sprint 2: séries temporais
-- ============================================================================
-- Duas RPCs novas, agregadas no Postgres (regra do 1102), SECURITY INVOKER (o RLS do
-- usuário vale em v_lead_progress). Idempotente (CREATE OR REPLACE), não toca dados.
--
-- (1) get_leads_timeseries(p_start, p_end): evolução DIÁRIA dentro do período (para a linha
--     da Visão Geral). Um ponto por dia (fuso BRT, dias sem movimento preenchidos com 0):
--     recebidos por created_at; ganhos/mortos por finalized_at.
--
-- (2) get_leads_trend(p_windows): tendência ENTRE CICLOS (para a aba Performance). Recebe um
--     array de janelas [{key,start,end}] (o app monta a partir de recentCycles) e devolve, por
--     janela, recebidos/ganhos/mortos + média de horas até 1º contato (retroativos fora). O app
--     calcula as taxas (conversão, lead morto) e os rótulos.
-- ============================================================================

BEGIN;

-- ── (1) Série diária dentro do período ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_leads_timeseries(p_start timestamptz, p_end timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH days AS (
    -- Todos os dias BRT do período (end é exclusivo → último dia = end − 1 dia).
    SELECT gs::date AS day
    FROM generate_series(
      (p_start AT TIME ZONE 'America/Sao_Paulo')::date::timestamp,
      ((p_end   AT TIME ZONE 'America/Sao_Paulo')::date - interval '1 day'),
      interval '1 day'
    ) gs
  ),
  rec AS (  -- recebidos por dia (created_at no período)
    SELECT (created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day, count(*) AS n
    FROM public.v_lead_progress
    WHERE created_at >= p_start AND created_at < p_end
    GROUP BY 1
  ),
  fin AS (  -- ganhos/mortos por dia (finalized_at no período)
    SELECT (finalized_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
           count(*) FILTER (WHERE is_won)  AS won,
           count(*) FILTER (WHERE is_dead) AS dead
    FROM public.v_lead_progress
    WHERE finalized_at >= p_start AND finalized_at < p_end
    GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'day',      to_char(d.day, 'YYYY-MM-DD'),
           'received', COALESCE(rec.n, 0),
           'won',      COALESCE(fin.won, 0),
           'dead',     COALESCE(fin.dead, 0)
         ) ORDER BY d.day), '[]'::jsonb)
  FROM days d
  LEFT JOIN rec ON rec.day = d.day
  LEFT JOIN fin ON fin.day = d.day
$$;

GRANT EXECUTE ON FUNCTION public.get_leads_timeseries(timestamptz, timestamptz) TO authenticated;

-- ── (2) Tendência entre ciclos ───────────────────────────────────────────────
-- p_windows = [{ "key": "...", "start": "<UTC ISO>", "end": "<UTC ISO>" }, ...]
CREATE OR REPLACE FUNCTION public.get_leads_trend(p_windows jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',      w.value->>'key',
           'received', m.received,
           'won',      m.won,
           'dead',     m.dead,
           'avgHoursToFirstContact', m.avg_ftc
         ) ORDER BY w.ord), '[]'::jsonb)
  FROM jsonb_array_elements(p_windows) WITH ORDINALITY AS w(value, ord)
  CROSS JOIN LATERAL (
    SELECT count(*)                                AS received,
           count(*) FILTER (WHERE is_won)          AS won,
           count(*) FILTER (WHERE is_dead)         AS dead,
           round(avg(hours_to_first_contact) FILTER (WHERE hours_to_first_contact >= 0)::numeric, 1) AS avg_ftc
    FROM public.v_lead_progress
    WHERE created_at >= (w.value->>'start')::timestamptz
      AND created_at <  (w.value->>'end')::timestamptz
  ) m
$$;

GRANT EXECUTE ON FUNCTION public.get_leads_trend(jsonb) TO authenticated;

COMMIT;

-- ============================================================================
-- Verificação (ajuste o ciclo):
--   SELECT public.get_leads_timeseries('2026-06-11T03:00:00Z','2026-07-11T03:00:00Z');
--   SELECT public.get_leads_trend('[{"key":"2026-06-11","start":"2026-06-11T03:00:00Z","end":"2026-07-11T03:00:00Z"}]'::jsonb);
-- Esperado: timeseries com 1 ponto por dia (soma de received == kpis.total do ciclo);
--           trend com 1 objeto por janela.
-- ============================================================================
