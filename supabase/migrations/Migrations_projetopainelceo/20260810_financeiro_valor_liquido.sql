-- ============================================================================
-- Painel do CEO — Financeiro: a entrada passa a ser o VALOR LÍQUIDO
-- ============================================================================
-- Decisão do dono (10/ago): o painel contava "Valor que o Cliente Pagou?"
-- (`valor_de_contrata_o`) e passa a contar "Valor do Pagamento Líquido"
-- (`copy_of_valor_do_pagamento_bruto` — o id diz "bruto" por herança de um
-- copy_of no Pipefy; o RÓTULO é que vale, e ele diz Líquido).
--
-- ⚠️ DUAS MUDANÇAS, NÃO UMA. A segunda é a que mexe no histórico:
--
--   1. O VALOR da entrada vira o líquido do card.
--   2. O card vira UMA entrada, sempre. Os campos de parcela
--      (`informe_o_valor_pago_referente_a_N_parcela`) DEIXAM DE SER LIDOS —
--      pedido explícito do dono: "pegue apenas o campo de valor líquido de cada
--      card, ignorando o valor das parcelas".
--
-- A #2 é consequência direta da #1: o líquido é UM número por card, e não existe
-- líquido por parcela. Sem inventar rateio, não há como espalhá-lo pelas parcelas.
--
-- O QUE ISSO CUSTA (medido na base em 10/ago, 4.609 cards):
--   · 516 cards antigos têm parcelas em MESES diferentes; 796 entradas mudam de
--     mês e passam a cair no mês de `data_do_pagamento` do card. O histórico de
--     2024/2025 é redistribuído — os meses não batem mais com o que a aba mostrava.
--   · 5.398 entradas viram 4.591. O total histórico cai de R$ 7.419.648,70 para
--     R$ 5.924.936,20, porque um card que somava 3 parcelas agora soma um líquido só.
--   · Em 2026 (100% da convenção nova) o efeito é só o valor: jul/26 vai de
--     R$ 185.404,52 para R$ 174.727,19, com as mesmas 161 entradas.
-- Está registrado aqui porque é irreversível por reingestão: quem quiser o modelo
-- antigo de volta tem que reaplicar a 20260731_financeiro_schema.sql.
--
-- LÍQUIDO VAZIO OU ZERO: não gera entrada (decisão do dono — o painel mostra o
-- líquido, sem inventar fallback), mas o card também não some em silêncio: a RPC
-- devolve `missingNet`, a lista dos cards que têm dinheiro em outro campo e nada
-- no líquido, para a aba avisar. Hoje são 7 cards em toda a base.
--
-- Idempotente. REESCREVE `fin_entries` inteira a partir do `metadata`/das colunas
-- que já estão no banco — não precisa do Pipefy nem de `npm run import:financeiro`.
-- ============================================================================

BEGIN;

-- ── PARTE 1 — helper: quanto o card diz ter recebido FORA do líquido ────────
-- Só serve ao aviso `missingNet`: quando o líquido está vazio, é este número que
-- diz "tem dinheiro aqui que o painel não está contando". Soma as 4 parcelas da
-- convenção antiga; o id da data da 4ª diz "3" (herança de copy_of), mas o do
-- VALOR é regular.
CREATE OR REPLACE FUNCTION public.fin_valor_parcelas(p_metadata jsonb)
RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(
    COALESCE(public.fin_parse_money(public.fin_field(p_metadata, 'informe_o_valor_pago_referente_a_1_parcela')), 0)
  + COALESCE(public.fin_parse_money(public.fin_field(p_metadata, 'informe_o_valor_pago_referente_a_2_parcela')), 0)
  + COALESCE(public.fin_parse_money(public.fin_field(p_metadata, 'informe_o_valor_pago_referente_a_3_parcela')), 0)
  + COALESCE(public.fin_parse_money(public.fin_field(p_metadata, 'copy_of_informe_o_valor_pago_referente_a_4_parcela')), 0)
  , 0)
$$;

COMMENT ON FUNCTION public.fin_valor_parcelas(jsonb) IS
  'Soma dos campos de parcela do card. NÃO entra no total do painel desde 10/ago — existe só para o aviso missingNet.';


-- ── PARTE 2 — Ingestão ──────────────────────────────────────────────────────
-- Mesmo contrato de antes (recebe o node CRU do Pipefy, do Make ou do backfill) e
-- as mesmas colunas de contexto em `fin_cards`. Muda só como `fin_entries` nasce.
CREATE OR REPLACE FUNCTION public.ingest_financeiro_card(node jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pipefy_card_id text := node->>'id';
  v_metadata jsonb;
  v_fin_card_id uuid;
  v_category text;
  v_paid_value numeric;
  v_net_value numeric;
  v_paid_date date;
  v_entries int := 0;
  v_skipped int := 0;
  v_motivo text := NULL;
BEGIN
  IF v_pipefy_card_id IS NULL THEN
    RAISE EXCEPTION 'ingest_financeiro_card: node sem id';
  END IF;

  SELECT jsonb_object_agg(
    f->'field'->>'id',
    jsonb_build_object(
      'name', f->>'name',
      'value', f->>'value',
      'array_value', f->'array_value',
      'datetime_value', f->>'datetime_value'
    )
  ) INTO v_metadata
  FROM jsonb_array_elements(COALESCE(node->'fields', '[]'::jsonb)) AS f
  WHERE f->'field'->>'id' IS NOT NULL;

  v_metadata   := COALESCE(v_metadata, '{}'::jsonb);
  v_category   := public.fin_card_category(v_metadata);
  v_paid_value := public.fin_parse_money(public.fin_field(v_metadata, 'valor_de_contrata_o'));
  -- ⭐ A ENTRADA DO PAINEL. O field-id diz "bruto"; o rótulo no Pipefy diz
  -- "Valor do Pagamento Líquido" e é ele que o dono pediu.
  v_net_value  := public.fin_parse_money(public.fin_field(v_metadata, 'copy_of_valor_do_pagamento_bruto'));
  v_paid_date  := public.fin_parse_date(public.fin_field(v_metadata, 'data_do_pagamento'));

  INSERT INTO public.fin_cards (
    pipefy_card_id, title, current_phase_id, current_phase,
    charged_value, paid_value, net_value, paid_date,
    category, department, payment_method, contract_ref,
    pipefy_created_at, pipefy_done, metadata, synced_at, updated_at
  ) VALUES (
    v_pipefy_card_id,
    node->>'title',
    node->'current_phase'->>'id',
    node->'current_phase'->>'name',
    public.fin_parse_money(public.fin_field(v_metadata, 'valor_total_da_cobran_a')),
    v_paid_value,
    v_net_value,
    v_paid_date,
    v_category,
    public.fin_norm_department(public.fin_field(v_metadata, 'informe_o_seu_departamento')),
    public.fin_field(v_metadata, 'forma_de_pagamento'),
    public.fin_field(v_metadata, 'n_mera_o_do_pagamento_id'),
    NULLIF(node->>'created_at', '')::timestamptz,
    (node->>'done')::boolean,
    v_metadata,
    now(),
    COALESCE(NULLIF(node->>'updated_at', '')::timestamptz, now())
  )
  ON CONFLICT (pipefy_card_id) DO UPDATE SET
    title = EXCLUDED.title,
    current_phase_id = EXCLUDED.current_phase_id,
    current_phase = EXCLUDED.current_phase,
    charged_value = EXCLUDED.charged_value,
    paid_value = EXCLUDED.paid_value,
    net_value = EXCLUDED.net_value,
    paid_date = EXCLUDED.paid_date,
    category = EXCLUDED.category,
    department = EXCLUDED.department,
    payment_method = EXCLUDED.payment_method,
    contract_ref = EXCLUDED.contract_ref,
    pipefy_done = EXCLUDED.pipefy_done,
    metadata = EXCLUDED.metadata,
    synced_at = now(),
    updated_at = EXCLUDED.updated_at
  RETURNING id INTO v_fin_card_id;

  -- DELETE + INSERT (e não upsert): se o líquido for apagado no card, a entrada
  -- tem que sumir junto. `seq` continua existindo por causa do UNIQUE da tabela,
  -- mas agora é sempre 1 — um card, uma entrada.
  DELETE FROM public.fin_entries WHERE fin_card_id = v_fin_card_id;

  IF v_net_value IS NULL OR v_net_value = 0 THEN
    -- Sem líquido não há entrada (decisão do dono). Se houver dinheiro em outro
    -- campo, o card aparece no aviso `missingNet` da RPC de leitura.
    v_skipped := 1;
    v_motivo := 'sem_liquido';
  ELSIF v_paid_date IS NULL THEN
    -- Sem data não dá pra alocar em mês nenhum: não inventamos uma.
    v_skipped := 1;
    v_motivo := 'sem_data';
  ELSE
    INSERT INTO public.fin_entries (fin_card_id, seq, entry_value, entry_date, source)
    VALUES (v_fin_card_id, 1::smallint, v_net_value, v_paid_date, 'liquido');
    v_entries := 1;
  END IF;

  RETURN jsonb_build_object(
    'fin_card_id', v_fin_card_id,
    'entries', v_entries,
    'skipped', v_skipped,
    'motivo', v_motivo,
    'category', v_category
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_financeiro_card(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_financeiro_card(jsonb) TO service_role;


-- ── PARTE 3 — Reconstrói o histórico inteiro ────────────────────────────────
-- As linhas que já estão no banco nasceram da regra ANTIGA (parcelas + valor
-- pago). Como `net_value` e `paid_date` já estão gravados em `fin_cards` desde a
-- Sprint 1, dá pra regerar tudo aqui mesmo — sem tocar no Pipefy e sem depender
-- de alguém rodar o backfill. Reaplicar esta migration é seguro: o bloco é
-- determinístico e recomeça do zero.
DELETE FROM public.fin_entries;

INSERT INTO public.fin_entries (fin_card_id, seq, entry_value, entry_date, source)
SELECT c.id, 1::smallint, c.net_value, c.paid_date, 'liquido'
FROM public.fin_cards c
WHERE c.net_value IS NOT NULL
  AND c.net_value <> 0
  AND c.paid_date IS NOT NULL;


-- ── PARTE 4 — Leitura do painel ─────────────────────────────────────────────
-- Assinatura idêntica à da 20260805c (p_start, p_end, p_modo). Muda:
--   · nasce `missingNet`: card com dinheiro em outro campo e líquido vazio/zero.
--     É o contrapeso da decisão de não ter fallback — o valor não entra na soma,
--     mas aparece na tela para alguém preencher o campo no Pipefy.
--   · SAI o `duplicates` (aviso de lançamento em duplicata). Pedido do dono no mesmo
--     dia: tirar o bloco da aba. Como ninguém mais lê a chave, o agrupamento sai
--     junto em vez de virar payload morto — ele continua escrito, palavra por
--     palavra, na 20260805c, que é de onde copiar se um dia voltar.
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

  -- Card que tem dinheiro declarado em OUTRO campo e nada no líquido. Não entra em
  -- soma nenhuma — é lista de pendência para preencher o campo no Pipefy. Recortado
  -- pela mesma janela, por `data_do_pagamento`.
  sem_liquido AS (
    SELECT
      c.pipefy_card_id,
      c.title,
      c.category,
      COALESCE(c.department, 'Sem departamento') AS department,
      c.paid_date,
      COALESCE(NULLIF(c.paid_value, 0), public.fin_valor_parcelas(c.metadata)) AS valor
    FROM public.fin_cards c
    WHERE c.current_phase_id IS DISTINCT FROM '327456661'
      AND COALESCE(c.net_value, 0) = 0
      AND c.paid_date >= v_start AND c.paid_date < v_end
      AND COALESCE(NULLIF(c.paid_value, 0), public.fin_valor_parcelas(c.metadata), 0) <> 0
  )
  SELECT jsonb_build_object(
    'periodStart',  to_char(v_start, 'YYYY-MM-DD'),
    'periodEnd',    to_char(v_end,   'YYYY-MM-DD'),
    'mode',         CASE WHEN v_ciclo THEN 'ciclo' ELSE 'mes' END,
    'total',         COALESCE((SELECT SUM(signed_value) FROM periodo),  0),
    'count',         COALESCE((SELECT COUNT(*)          FROM periodo),  0),
    'previousTotal', COALESCE((SELECT SUM(signed_value) FROM anterior), 0),
    'previousCount', COALESCE((SELECT COUNT(*)          FROM anterior), 0),
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
    'missingNet', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'cardId', pipefy_card_id, 'title', title, 'category', category,
        'department', department, 'paidDate', to_char(paid_date, 'YYYY-MM-DD'),
        'value', valor) ORDER BY paid_date DESC, pipefy_card_id)
      FROM sem_liquido), '[]'::jsonb),
    'missingNetTotal', COALESCE((SELECT SUM(valor) FROM sem_liquido), 0)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_ceo_financeiro(timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ceo_financeiro(timestamptz, timestamptz, text) TO authenticated;

COMMENT ON FUNCTION public.get_ceo_financeiro(timestamptz, timestamptz, text) IS
  'Entradas do Financeiro para o painel do CEO (guarda ceo/admin). A entrada é o VALOR LÍQUIDO do card (10/ago). p_modo = mes|ciclo controla os 12 baldes.';

COMMIT;

-- ============================================================================
-- Conferir depois de aplicar
-- ============================================================================
-- 1) Uma entrada por card, todas 'liquido'?
--      SELECT source, count(*) FROM public.fin_entries GROUP BY source;
--      -- esperado: UMA linha, 'liquido' (nada de 'card'/'parcela')
--      SELECT count(*) FROM (SELECT fin_card_id FROM public.fin_entries
--                            GROUP BY 1 HAVING count(*) > 1) x;   -- esperado: 0
--
-- 2) A entrada é mesmo o líquido do card?
--      SELECT count(*) FROM public.fin_entries e
--      JOIN public.fin_cards c ON c.id = e.fin_card_id
--      WHERE e.entry_value IS DISTINCT FROM c.net_value
--         OR e.entry_date  IS DISTINCT FROM c.paid_date;          -- esperado: 0
--
-- 3) Quem ficou de fora (medido em 10/ago: 8 cards, 7 deles com dinheiro em outro campo)
--      SELECT pipefy_card_id, paid_date, paid_value,
--             public.fin_valor_parcelas(metadata) AS parcelas
--      FROM public.fin_cards
--      WHERE COALESCE(net_value, 0) = 0
--      ORDER BY paid_date DESC;
--
-- 4) O aviso chega na tela? (o mês de abril/26 tem um caso conhecido: #1331093662)
--      SELECT public.get_ceo_financeiro('2026-04-01T03:00:00Z','2026-05-01T03:00:00Z') -> 'missingNet';
--
-- 5) Total de julho/26 — esperado R$ 174.727,19 em 161 entradas (era R$ 185.404,52):
--      SELECT public.get_ceo_financeiro('2026-07-01T03:00:00Z','2026-08-01T03:00:00Z') ->> 'total';
-- ============================================================================
