-- ============================================================================
-- Painel do CEO — Projeções: filtro de período (mês civil × ciclo 11→10)
-- ============================================================================
-- Pedido do dono (06/ago): a aba Projeções ganha o mesmo seletor das outras duas.
--
-- ── O que o período filtra, e o que ele NÃO filtra ──────────────────────────
-- Ele filtra a **data de vencimento** da projeção: a aba passa a mostrar só o que vence
-- dentro da janela escolhida.
--
-- As FAIXAS (vencida / ≤30d / 31–90d / >90d) continuam contadas **contra hoje**, não
-- contra o início do período — decisão do dono. Ou seja: escolhendo agosto, uma parcela
-- que venceu em 02/08 aparece como "vencida" mesmo estando dentro do período, porque ela
-- venceu de verdade. A faixa responde "isso já atrasou?", que é uma pergunta sobre hoje;
-- o período responde "que recorte eu quero ver".
--
-- ── Por que recomputar tudo a partir dos itens ──────────────────────────────
-- Até aqui, `total`, `byWindow` e `byProduct` vinham prontos das duas sub-RPCs e os
-- `items` vinham à parte. Com filtro, isso quebraria: a lista encolheria e os totais
-- ficariam do conjunto inteiro. Então esta versão passa a derivar TODOS os agregados
-- dos itens já filtrados. Efeito colateral bom: o total exibido é, por construção, a
-- soma do que está na tela — antes eram dois caminhos que podiam divergir.
--
-- ⚠️ MUDANÇA DE ASSINATURA. Como um DEFAULT criaria DUAS funções (a de 0 e a de 2
-- argumentos) e `get_ceo_projecoes()` ficaria ambígua — "function is not unique" —, a de
-- 0 argumentos é DERRUBADA antes. Mesmo cuidado da 20260805c.
--
-- p_start/p_end NULL = sem filtro (snapshot completo, o comportamento antigo).
--
-- Idempotente. Não toca em dado, nem nas duas sub-RPCs (que seguem sem período).
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.get_ceo_projecoes();

CREATE OR REPLACE FUNCTION public.get_ceo_projecoes(
  p_start timestamptz DEFAULT NULL,
  p_end   timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_neg    jsonb;
  v_cs     jsonb;
  v_items  jsonb;
  v_today  date;
  v_ini    date;
  v_fim    date;   -- EXCLUSIVO
  v_result jsonb;
BEGIN
  IF public.ceo_current_role() NOT IN ('ceo', 'admin') THEN
    RETURN NULL;
  END IF;

  v_today := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  -- O corte do dia é BRT: quem manda é o Postgres, não o Worker (que roda em UTC).
  v_ini := CASE WHEN p_start IS NULL THEN NULL ELSE (p_start AT TIME ZONE 'America/Sao_Paulo')::date END;
  v_fim := CASE WHEN p_end   IS NULL THEN NULL ELSE (p_end   AT TIME ZONE 'America/Sao_Paulo')::date END;

  v_neg := COALESCE(public.get_ceo_projecoes_negociacao(), '{}'::jsonb);
  v_cs  := COALESCE(public.get_ceo_projecoes_cs(),         '{}'::jsonb);

  -- Junta as duas fontes e aplica o recorte por vencimento. Item sem dueDate não entra
  -- num período (não há como situá-lo); sem filtro, entra normalmente.
  SELECT COALESCE(jsonb_agg(i), '[]'::jsonb)
  INTO v_items
  FROM jsonb_array_elements(
         COALESCE(v_neg->'items', '[]'::jsonb) || COALESCE(v_cs->'items', '[]'::jsonb)
       ) i
  WHERE (v_ini IS NULL AND v_fim IS NULL)
     OR (
          (i->>'dueDate') IS NOT NULL
      AND (v_ini IS NULL OR (i->>'dueDate')::date >= v_ini)
      AND (v_fim IS NULL OR (i->>'dueDate')::date <  v_fim)
        );

  WITH itens AS (
    SELECT
      i->>'source'                    AS source,
      COALESCE((i->>'value')::numeric, 0) AS value,
      i->>'window'                    AS win,
      COALESCE(NULLIF(i->>'product', ''), 'Sem produto') AS product
    FROM jsonb_array_elements(v_items) i
  )
  SELECT jsonb_build_object(
    'referenceDate', v_today,
    'periodStart',   CASE WHEN v_ini IS NULL THEN NULL ELSE to_char(v_ini, 'YYYY-MM-DD') END,
    'periodEnd',     CASE WHEN v_fim IS NULL THEN NULL ELSE to_char(v_fim, 'YYYY-MM-DD') END,
    'total', COALESCE((SELECT SUM(value) FROM itens), 0),
    'count', COALESCE((SELECT COUNT(*)   FROM itens), 0),
    'negociacao', jsonb_build_object(
      'total', COALESCE((SELECT SUM(value) FROM itens WHERE source = 'negociacao'), 0),
      'count', COALESCE((SELECT COUNT(*)   FROM itens WHERE source = 'negociacao'), 0)
    ),
    'cs', jsonb_build_object(
      'total', COALESCE((SELECT SUM(value) FROM itens WHERE source = 'cs'), 0),
      'count', COALESCE((SELECT COUNT(*)   FROM itens WHERE source = 'cs'), 0)
    ),
    -- byProduct é só da Negociação (o CS não tem produto por parcela).
    -- ⚠️ ORDER BY dentro do jsonb_agg: agregar sobre CTE ordenada não garante a ordem, e
    -- a tela lê o primeiro elemento como "maior".
    'byProduct', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', product, 'total', t, 'count', c) ORDER BY t DESC)
      FROM (
        SELECT product, SUM(value) AS t, COUNT(*) AS c
        FROM itens WHERE source = 'negociacao' GROUP BY product
      ) q
    ), '[]'::jsonb),
    -- As 4 faixas sempre presentes, mesmo zeradas — a tela desenha as quatro colunas.
    'byWindow', COALESCE((
      SELECT jsonb_object_agg(k, jsonb_build_object(
        'total', COALESCE((SELECT SUM(value) FROM itens WHERE win = k), 0),
        'count', COALESCE((SELECT COUNT(*)   FROM itens WHERE win = k), 0)
      ))
      FROM unnest(ARRAY['vencida', 'ate30', 'd31a90', 'mais90']) AS k
    ), '{}'::jsonb),
    'items', v_items
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_ceo_projecoes(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ceo_projecoes(timestamptz, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.get_ceo_projecoes(timestamptz, timestamptz) IS
  'Projeções de pagamento (CS + Negociação) para o painel do CEO. p_start/p_end filtram por VENCIMENTO; as faixas seguem relativas a hoje. NULL/NULL = snapshot completo.';

COMMIT;

-- ============================================================================
-- Conferir depois de aplicar
-- ============================================================================
-- 1) Existe SÓ a função de 2 argumentos? (duas versões = "function is not unique")
--      SELECT pg_get_function_identity_arguments(oid)
--      FROM pg_proc WHERE proname = 'get_ceo_projecoes';
--      -- esperado: UMA linha, 'timestamptz, timestamptz'
--
-- 2) Sem período, o número é o mesmo de antes?
--      SELECT public.get_ceo_projecoes() ->> 'total';
--      -- esperado (06/ago, já com o re-cálculo da 20260805): 5250.00 em 3 cards
--
-- 3) O filtro recorta mesmo?
--      SELECT public.get_ceo_projecoes('2026-08-01T03:00:00Z','2026-09-01T03:00:00Z') ->> 'total';
--      -- só o que vence em agosto; <= o total sem filtro
--
-- 4) O total é sempre a soma do que está na lista? (a garantia nova desta versão)
--      SELECT (SELECT SUM((i->>'value')::numeric)
--              FROM jsonb_array_elements(r -> 'items') i) AS soma_dos_itens,
--             (r ->> 'total')::numeric AS total_reportado
--      FROM (SELECT public.get_ceo_projecoes('2026-08-01T03:00:00Z','2026-09-01T03:00:00Z') AS r) x;
--      -- as duas colunas TÊM que ser iguais
--
-- 5) Guarda: como service_role devolve NULL?
--      SELECT public.get_ceo_projecoes();   -- NULL
-- ============================================================================
