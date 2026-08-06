-- ============================================================================
-- Painel do CEO — Financeiro: a série de 12 períodos passa a seguir o toggle
-- ============================================================================
-- Bug relatado pelo dono (05/ago): trocar o seletor para "Ciclo 11→10" mudava os KPIs
-- mas o gráfico continuava em meses civis.
--
-- Não era bug de código: era **decisão** da Sprint 1, escrita assim na migration —
-- "a série é sempre em meses civis, porque em ciclo 11→10 a barra de julho não seria
-- julho". A intenção era proteger a leitura; o efeito foi uma tela que ignora o filtro,
-- que é pior. O dono decidiu: a série segue o recorte. Este arquivo implementa isso.
--
-- ⚠️ MUDANÇA DE ASSINATURA. `get_ceo_financeiro` ganha um 3º parâmetro. Como um
-- DEFAULT criaria DUAS funções (a de 2 e a de 3 argumentos) e a chamada com 2 ficaria
-- ambígua — "function is not unique" —, a de 2 argumentos é DERRUBADA antes.
-- Nada mais no banco a chama: `get_ceo_saude_empresa` v2 lê `fin_entries` direto.
--
-- Idempotente. Não toca em dado.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.get_ceo_financeiro(timestamptz, timestamptz);

-- p_modo: 'mes' (default, mês civil) | 'ciclo' (11→10, a convenção da operação).
--
-- No modo 'ciclo' os 12 baldes são os 12 ciclos terminando no ciclo selecionado, e o
-- rótulo passa a ser a data de início do ciclo — o frontend formata como "11 jun".
-- O balde é fechado à esquerda e aberto à direita, igual ao período.
CREATE OR REPLACE FUNCTION public.get_ceo_financeiro(
  p_start timestamptz,
  p_end   timestamptz,
  p_modo  text DEFAULT 'mes'
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_start      date;
  v_end        date;   -- EXCLUSIVO
  v_prev_start date;
  v_days       int;
  v_ciclo      boolean := (lower(COALESCE(p_modo, 'mes')) = 'ciclo');
  v_result     jsonb;
BEGIN
  IF public.ceo_current_role() NOT IN ('ceo', 'admin') THEN
    RETURN NULL;
  END IF;

  v_start := (p_start AT TIME ZONE 'America/Sao_Paulo')::date;
  v_end   := (p_end   AT TIME ZONE 'America/Sao_Paulo')::date;
  v_days  := GREATEST(v_end - v_start, 1);
  v_prev_start := v_start - v_days;

  WITH base AS (
    SELECT
      e.entry_value * public.fin_entry_sign(c.category) AS signed_value,
      e.entry_date,
      COALESCE(c.category, 'Sem categoria') AS category,
      COALESCE(c.department, 'Sem departamento') AS department,
      COALESCE(c.payment_method, 'Sem forma') AS payment_method
    FROM public.fin_entries e
    JOIN public.fin_cards c ON c.id = e.fin_card_id
    WHERE c.current_phase_id IS DISTINCT FROM '327456661'
  ),
  periodo  AS (SELECT * FROM base WHERE entry_date >= v_start      AND entry_date < v_end),
  anterior AS (SELECT * FROM base WHERE entry_date >= v_prev_start AND entry_date < v_start),

  -- Os 12 baldes. Em 'mes' são meses civis terminando no mês de v_end−1 (como sempre
  -- foi). Em 'ciclo' são os 12 ciclos terminando no ciclo selecionado: como o período
  -- que chega JÁ é o ciclo escolhido, basta recuar de mês em mês a partir de v_start,
  -- o que preserva o dia 11 automaticamente.
  baldes AS (
    SELECT
      CASE WHEN v_ciclo
           THEN (v_start - (i || ' months')::interval)::date
           ELSE (date_trunc('month', (v_end - 1)::date) - (i || ' months')::interval)::date
      END AS ini,
      CASE WHEN v_ciclo
           THEN (v_start - ((i - 1) || ' months')::interval)::date
           ELSE (date_trunc('month', (v_end - 1)::date) - ((i - 1) || ' months')::interval)::date
      END AS fim
    FROM generate_series(11, 0, -1) i
  ),
  -- ⚠️ ORDER BY dentro do jsonb_agg: agregar sobre CTE ordenada NÃO garante a ordem do
  -- array, e o gráfico depende da ordem cronológica.
  serie AS (
    SELECT
      b.ini,
      to_char(b.ini, 'YYYY-MM-DD') AS bucket,
      COALESCE(SUM(x.signed_value), 0) AS total,
      COUNT(x.entry_date) AS count
    FROM baldes b
    LEFT JOIN base x ON x.entry_date >= b.ini AND x.entry_date < b.fim
    GROUP BY b.ini
  ),
  por_categoria    AS (SELECT category       AS key, SUM(signed_value) AS total, COUNT(*) AS count FROM periodo GROUP BY category),
  por_departamento AS (SELECT department     AS key, SUM(signed_value) AS total, COUNT(*) AS count FROM periodo GROUP BY department),
  por_forma        AS (SELECT payment_method AS key, SUM(signed_value) AS total, COUNT(*) AS count FROM periodo GROUP BY payment_method),
  duplicados AS (
    SELECT
      c.contract_ref, c.category, c.paid_date, c.paid_value,
      COUNT(*) AS cards,
      jsonb_agg(c.pipefy_card_id ORDER BY c.pipefy_card_id) AS card_ids,
      jsonb_agg(DISTINCT COALESCE(c.department, 'Sem departamento')) AS departments
    FROM public.fin_cards c
    WHERE c.current_phase_id IS DISTINCT FROM '327456661'
      AND c.contract_ref IS NOT NULL
      AND c.paid_value IS NOT NULL
      AND c.paid_date >= v_start AND c.paid_date < v_end
    GROUP BY c.contract_ref, c.category, c.paid_date, c.paid_value
    HAVING COUNT(*) > 1
  )
  SELECT jsonb_build_object(
    'periodStart',  to_char(v_start, 'YYYY-MM-DD'),
    'periodEnd',    to_char(v_end,   'YYYY-MM-DD'),
    'mode',         CASE WHEN v_ciclo THEN 'ciclo' ELSE 'mes' END,
    'total',         COALESCE((SELECT SUM(signed_value) FROM periodo),  0),
    'count',         COALESCE((SELECT COUNT(*)          FROM periodo),  0),
    'previousTotal', COALESCE((SELECT SUM(signed_value) FROM anterior), 0),
    'previousCount', COALESCE((SELECT COUNT(*)          FROM anterior), 0),
    -- `month` continua sendo o nome da chave por compatibilidade com o frontend, mas
    -- agora carrega a DATA DE INÍCIO do balde ('YYYY-MM-DD') em vez de 'YYYY-MM'. Quem
    -- rotula é a tela, que sabe o modo.
    'monthly', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('month', bucket, 'total', total, 'count', count) ORDER BY ini)
      FROM serie
    ), '[]'::jsonb),
    'byCategory', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', key, 'total', total, 'count', count) ORDER BY total DESC)
      FROM por_categoria), '[]'::jsonb),
    'byDepartment', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', key, 'total', total, 'count', count) ORDER BY total DESC)
      FROM por_departamento), '[]'::jsonb),
    'byPaymentMethod', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', key, 'total', total, 'count', count) ORDER BY total DESC)
      FROM por_forma), '[]'::jsonb),
    'duplicates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'contractRef', contract_ref, 'category', category,
        'paidDate', to_char(paid_date, 'YYYY-MM-DD'), 'value', paid_value,
        'cards', cards, 'cardIds', card_ids, 'departments', departments))
      FROM duplicados), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_ceo_financeiro(timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ceo_financeiro(timestamptz, timestamptz, text) TO authenticated;

COMMENT ON FUNCTION public.get_ceo_financeiro(timestamptz, timestamptz, text) IS
  'Entradas do Financeiro para o painel do CEO (guarda ceo/admin). p_modo = mes|ciclo controla os 12 baldes da série.';

COMMIT;

-- ============================================================================
-- Conferir depois de aplicar
-- ============================================================================
-- 1) Existe SÓ a função de 3 argumentos? (duas versões = "function is not unique")
--      SELECT pg_get_function_identity_arguments(oid)
--      FROM pg_proc WHERE proname = 'get_ceo_financeiro';
--      -- esperado: UMA linha, 'timestamptz, timestamptz, text'
--
-- 2) O modo muda os baldes?
--      SELECT public.get_ceo_financeiro('2026-07-01T03:00:00Z','2026-08-01T03:00:00Z','mes')
--               -> 'monthly' -> 0 ->> 'month';     -- um dia 01
--      SELECT public.get_ceo_financeiro('2026-07-11T03:00:00Z','2026-08-11T03:00:00Z','ciclo')
--               -> 'monthly' -> 0 ->> 'month';     -- um dia 11
--
-- 3) O total do período NÃO pode mudar com o modo (o modo só afeta a série):
--      -- os dois abaixo, com o MESMO p_start/p_end, têm que dar o mesmo 'total'.
--      SELECT public.get_ceo_financeiro('2026-07-01T03:00:00Z','2026-08-01T03:00:00Z','mes')   ->> 'total',
--             public.get_ceo_financeiro('2026-07-01T03:00:00Z','2026-08-01T03:00:00Z','ciclo') ->> 'total';
--
-- 4) A série tem 12 baldes em ordem crescente?
--      SELECT jsonb_array_length(public.get_ceo_financeiro(now()-interval '30 days', now()) -> 'monthly');  -- 12
-- ============================================================================
