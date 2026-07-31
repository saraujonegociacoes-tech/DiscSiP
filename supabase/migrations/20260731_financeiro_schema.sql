-- ============================================================================
-- Financeiro (pipe 2.0 - Financeiro) — schema, ingestão e leitura do CEO
-- Painel do CEO, Sprint 1. Ver:
--   docs/projetopainelceo-docs/updates/painel-ceo-sprints.md          (roadmap)
--   docs/projetopainelceo-docs/updates/introspeccao-pipefy-financeiro.md (mapeamento)
-- ============================================================================
-- VERTICAL ISOLADA, clone do molde do CS (20260715_cs_pipeline_schema.sql):
-- tabelas/RLS/RPCs próprios, nada compartilhado. Pipe Pipefy: "2.0 - Financeiro"
-- (id 304386356), mapeado por introspecção ao vivo em 31/jul/2026.
--
-- ⚠️ POR QUE SÃO DUAS TABELAS (fin_cards + fin_entries)
-- O pipe mudou de convenção no meio de 2025:
--   • cards de 2024/2025 guardam ATÉ 4 pagamentos no mesmo card, cada um com
--     valor e data próprios (campos "informe_o_valor_pago_referente_a_N_parcela"
--     + "informe_a_data_do_pagamento_da_N_parcela") — e as datas caem em MESES
--     DIFERENTES. Medido: 222 de 1.200 cards com 2+ parcelas preenchidas.
--   • cards de 2026 usam 1 card por parcela (`esse_pagamento_referente_a_qual_parcela`),
--     com o valor em `valor_de_contrata_o`. Nenhum card de 2026 usa os campos de parcela.
-- Um modelo de 1 linha por card alocaria o dinheiro no mês errado em todo o
-- histórico. Então `fin_cards` guarda o CONTEXTO e `fin_entries` guarda UM
-- PAGAMENTO POR LINHA — é `fin_entries` que alimenta KPI e série mensal.
--
-- Nos cards antigos, `valor_de_contrata_o` é INCONSISTENTE (às vezes a soma das
-- parcelas, às vezes só a primeira: bate em 773 casos e diverge em 102 numa
-- amostra de 1.200). Por isso, quando há parcela preenchida, a ingestão usa as
-- parcelas e IGNORA esse campo.
--
-- Não existe `fin_phases` (o CS tem `cs_phases`): são 5 fases e a única regra que
-- depende delas é excluir "Pagamento cancelado". Guardamos id+nome denormalizados
-- no card e evitamos uma tabela de seed que precisaria ser mantida à mão.
-- ============================================================================


-- ── PARTE 1 — Tabelas ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.fin_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipefy_card_id text UNIQUE NOT NULL,
  title text,                                   -- nome do contratante (dado sensível)
  current_phase_id text,
  current_phase text,
  -- Valores do card. `paid_value` é o KPI nos cards da convenção nova (decisão do
  -- dono: "Valor que o Cliente Pagou?"); `charged_value` é o total cobrado do
  -- contrato e `net_value` o rotulado "Líquido" (o field-id diz "bruto" por
  -- herança de um copy_of no Pipefy — o rótulo é que vale).
  charged_value numeric,                        -- valor_total_da_cobran_a
  paid_value numeric,                           -- valor_de_contrata_o
  net_value numeric,                            -- copy_of_valor_do_pagamento_bruto
  paid_date date,                               -- data_do_pagamento (DD/MM/YYYY na origem)
  category text,                                -- COALESCE das 3 "referências" (ver fin_card_category)
  department text,                              -- informe_o_seu_departamento, JÁ normalizado
  payment_method text,                          -- forma_de_pagamento
  contract_ref text,                            -- n_mera_o_do_pagamento_id — NÃO é chave única
  pipefy_created_at timestamptz,
  pipefy_done boolean,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,  -- TODOS os campos do card, por field-id (padrão do CS)
  synced_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

-- Um pagamento por linha. Regerada inteira a cada ingestão do card (o card é a
-- fonte de verdade; não há id de parcela no Pipefy pra fazer upsert linha a linha).
CREATE TABLE IF NOT EXISTS public.fin_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fin_card_id uuid NOT NULL REFERENCES public.fin_cards(id) ON DELETE CASCADE,
  seq smallint NOT NULL,                        -- 1..4 (parcela) ou 1 (card da convenção nova)
  entry_value numeric NOT NULL,
  entry_date date NOT NULL,
  source text NOT NULL,                         -- 'parcela' | 'card' — de qual convenção a linha veio
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fin_card_id, seq)
);

CREATE INDEX IF NOT EXISTS fin_cards_phase_idx ON public.fin_cards (current_phase_id);
CREATE INDEX IF NOT EXISTS fin_cards_paid_date_idx ON public.fin_cards (paid_date);
CREATE INDEX IF NOT EXISTS fin_cards_contract_idx ON public.fin_cards (contract_ref);
CREATE INDEX IF NOT EXISTS fin_entries_date_idx ON public.fin_entries (entry_date);
CREATE INDEX IF NOT EXISTS fin_entries_card_idx ON public.fin_entries (fin_card_id);


-- ── PARTE 2 — Parsers e helpers ─────────────────────────────────────────────

-- Dinheiro: clone fiel de cs_parse_money (20260727_cs_minutas.sql). Este pipe manda
-- formato brasileiro sem símbolo ("1.500,00"), que o ramo `,[0-9]{1,2}$` já resolve.
-- Nunca lança: entrada suja → NULL.
CREATE OR REPLACE FUNCTION public.fin_parse_money(raw text)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s text;
BEGIN
  IF raw IS NULL THEN RETURN NULL; END IF;
  s := trim(raw);
  IF s = '' THEN RETURN NULL; END IF;
  IF s ~ ',[0-9]{1,2}$' THEN
    s := replace(replace(s, '.', ''), ',', '.');
  END IF;
  s := regexp_replace(s, '[^0-9.\-]', '', 'g');
  IF s !~ '^-?[0-9]+(\.[0-9]+)?$' THEN RETURN NULL; END IF;
  RETURN s::numeric;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- ⚠️ Data: este é o ponto onde clonar o CS teria dado ERRADO EM SILÊNCIO.
-- `cs_parse_date` faz `left(raw,10)::date`, que pressupõe ISO. Este pipe manda
-- DD/MM/YYYY em 100% dos cards (`datetime_value` vem sempre null, verificado no
-- dado real), e `'10/07/2026'::date` estoura → o EXCEPTION devolveria NULL para
-- TODAS as entradas, sem erro nenhum, e o painel mostraria mês vazio.
-- Ordem: DD/MM/YYYY primeiro (o formato real), ISO como rede de segurança.
CREATE OR REPLACE FUNCTION public.fin_parse_date(raw text)
RETURNS date
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s text;
BEGIN
  IF raw IS NULL THEN RETURN NULL; END IF;
  s := trim(raw);
  IF s = '' THEN RETURN NULL; END IF;
  IF s ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}' THEN
    RETURN to_date(left(s, 10), 'DD/MM/YYYY');
  END IF;
  RETURN left(s, 10)::date;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- Valor `value` de um field-id dentro do metadata (que é indexado por field-id,
-- mesma forma do cs_cards.metadata).
CREATE OR REPLACE FUNCTION public.fin_field(p_metadata jsonb, p_field_id text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(p_metadata->p_field_id->>'value', '')
$$;

-- "Categoria" são TRÊS campos no Pipefy, um por departamento — qual está
-- preenchido depende de quem lançou. Cobertura medida: todos os cards têm
-- exatamente um deles (2 em 360 têm dois, e aí a ordem abaixo decide).
-- É COALESCE e NÃO um CASE por departamento: o histórico tem cards com o nome
-- ANTIGO do departamento e um CASE os perderia em silêncio.
CREATE OR REPLACE FUNCTION public.fin_card_category(p_metadata jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    public.fin_field(p_metadata, 'refer_ncia_do_pagamento'),                  -- Comercial
    public.fin_field(p_metadata, 'refer_ncia_do_pagamento_juridico'),         -- Negociação
    public.fin_field(p_metadata, 'copy_of_refer_ncia_do_pagamento_juridico')  -- Quitação
  )
$$;

-- "Departamento - Jurídico" é o nome ANTIGO de "Departamento - Negociação"
-- (confirmado pelo dono, 31/jul): o campo foi renomeado e o histórico ficou com o
-- valor velho, que por isso nem aparece mais nas opções do Pipefy. Sem normalizar,
-- o mesmo departamento vira duas fatias no gráfico.
CREATE OR REPLACE FUNCTION public.fin_norm_department(p_department text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_department = 'Departamento - Jurídico' THEN 'Departamento - Negociação'
    ELSE p_department
  END
$$;

-- Sinal da entrada por categoria (decisão do dono, 31/jul): desconto e devolução
-- SAEM do caixa; distrato e reversão são entradas normais. Categoria nova nasce
-- POSITIVA — pra virar negativa tem que casar aqui, que é o default seguro.
CREATE OR REPLACE FUNCTION public.fin_entry_sign(p_category text)
RETURNS smallint
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN COALESCE(p_category, '') ~* '(desconto|devolu)' THEN (-1)::smallint
    ELSE 1::smallint
  END
$$;


-- ── PARTE 3 — RLS ───────────────────────────────────────────────────────────
-- Ninguém lê estas tabelas direto. RLS ligado SEM policy de SELECT = nega tudo
-- para `authenticated`; o acesso do painel acontece só pela RPC de leitura
-- (SECURITY DEFINER + guarda ceo_current_role()), que é a estratégia registrada
-- no Sprint 0 — centralizar o CEO nas RPCs em vez de espalhar 'ceo' pelo RLS de
-- cada domínio. Escrita: só service_role, via a RPC de ingestão.
-- Consequência: um `SELECT * FROM fin_cards` pelo app volta VAZIO de propósito.

ALTER TABLE public.fin_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fin_entries ENABLE ROW LEVEL SECURITY;


-- ── PARTE 4 — Ingestão ──────────────────────────────────────────────────────
-- Recebe o node CRU do Pipefy — mesmo formato que o Make e o backfill mandam
-- (scripts/import-financeiro.mjs), igual ao ingest_cs_card. O mapeamento de
-- field-ids vive SÓ aqui; o JS não conhece campo nenhum.
--
-- Idempotente: upsert por pipefy_card_id + as fin_entries do card são regeradas.
CREATE OR REPLACE FUNCTION public.ingest_financeiro_card(node jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pipefy_card_id text := node->>'id';
  v_metadata jsonb;
  v_fin_card_id uuid;
  v_category text;
  v_paid_value numeric;
  v_paid_date date;
  v_entries int := 0;
  v_skipped int := 0;
  v_value numeric;
  v_date date;
  r record;
BEGIN
  IF v_pipefy_card_id IS NULL THEN
    RAISE EXCEPTION 'ingest_financeiro_card: node sem id';
  END IF;

  -- metadata = todos os campos por field-id (mesma forma do cs_cards.metadata,
  -- pra que os helpers leiam ->'<field-id>'->>'value').
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

  v_metadata := COALESCE(v_metadata, '{}'::jsonb);
  v_category := public.fin_card_category(v_metadata);
  v_paid_value := public.fin_parse_money(public.fin_field(v_metadata, 'valor_de_contrata_o'));
  v_paid_date := public.fin_parse_date(public.fin_field(v_metadata, 'data_do_pagamento'));

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
    public.fin_parse_money(public.fin_field(v_metadata, 'copy_of_valor_do_pagamento_bruto')),
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

  -- Regenera as entradas do card. DELETE + INSERT (e não upsert linha a linha)
  -- porque o Pipefy não dá id de parcela: se uma parcela for apagada no card, a
  -- linha correspondente tem que sumir junto.
  DELETE FROM public.fin_entries WHERE fin_card_id = v_fin_card_id;

  -- Convenção ANTIGA (2024/2025): uma linha por parcela preenchida.
  -- O id da data da 4ª parcela diz "3" — é herança de um copy_of no Pipefy, e é o
  -- id que vale, não o nome. Conferido na introspecção.
  FOR r IN
    SELECT * FROM (VALUES
      (1::smallint, 'informe_o_valor_pago_referente_a_1_parcela',          'informe_a_data_do_pagamento_da_1_parcela'),
      (2::smallint, 'informe_o_valor_pago_referente_a_2_parcela',          'informe_a_data_do_pagamento_da_2_parcela'),
      (3::smallint, 'informe_o_valor_pago_referente_a_3_parcela',          'informe_a_data_do_pagamento_da_3_parcela'),
      (4::smallint, 'copy_of_informe_o_valor_pago_referente_a_4_parcela',  'copy_of_informe_a_data_do_pagamento_da_3_parcela')
    ) AS t(seq, value_field, date_field)
  LOOP
    v_value := public.fin_parse_money(public.fin_field(v_metadata, r.value_field));
    -- Parcela sem data cai na data do card (visto no histórico: "1ª parcela 0,00"
    -- sem data, que o filtro de valor já descarta).
    v_date := COALESCE(public.fin_parse_date(public.fin_field(v_metadata, r.date_field)), v_paid_date);

    CONTINUE WHEN v_value IS NULL OR v_value = 0;

    IF v_date IS NULL THEN
      -- Sem data não dá pra alocar em mês nenhum: não inventamos uma.
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.fin_entries (fin_card_id, seq, entry_value, entry_date, source)
    VALUES (v_fin_card_id, r.seq, v_value, v_date, 'parcela');
    v_entries := v_entries + 1;
  END LOOP;

  -- Convenção NOVA (2026): nenhum campo de parcela → o card inteiro é uma entrada.
  IF v_entries = 0 AND v_paid_value IS NOT NULL AND v_paid_value <> 0 THEN
    IF v_paid_date IS NULL THEN
      v_skipped := v_skipped + 1;
    ELSE
      INSERT INTO public.fin_entries (fin_card_id, seq, entry_value, entry_date, source)
      VALUES (v_fin_card_id, 1::smallint, v_paid_value, v_paid_date, 'card');
      v_entries := 1;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'fin_card_id', v_fin_card_id,
    'entries', v_entries,
    'skipped', v_skipped,
    'category', v_category
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_financeiro_card(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_financeiro_card(jsonb) TO service_role;


-- ── PARTE 5 — Leitura do painel do CEO ──────────────────────────────────────
-- SECURITY DEFINER + guarda ceo_current_role() (helper do Sprint 0,
-- 20260729_ceo_role.sql): é isto que dá acesso ao CEO sem espalhar 'ceo' pelo RLS.
-- Sem o papel certo devolve NULL — a action degrada pra painel vazio.
--
-- Agrega no Postgres e devolve 1 linha jsonb (padrão do domínio: evita o teto de
-- 1000 linhas do PostgREST e o estouro de CPU do Worker — ver
-- docs/discadora-docs/fixes/correcao-cpu-cloudflare-1102.md).
--
-- Recortes:
--   • KPIs (total/contagem/ticket) = a JANELA escolhida (mês civil ou ciclo 11→10,
--     decisão do dono: os dois, via toggle no frontend).
--   • `previous` = janela imediatamente anterior, do MESMO tamanho → delta do KPI.
--   • `monthly` = sempre os 12 MESES CIVIS terminando no mês de p_end,
--     independente da janela. Uma série mensal só faz sentido em mês civil, e
--     assim o gráfico continua legível quando a janela é de um mês só.
--   • `duplicates` = aviso de lançamento duplicado, NUNCA dedupe (pedido do dono).
CREATE OR REPLACE FUNCTION public.get_ceo_financeiro(p_start timestamptz, p_end timestamptz)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_start date;
  v_end date;          -- EXCLUSIVO, como o `end` de LeadPeriod
  v_prev_start date;
  v_days int;
  v_result jsonb;
BEGIN
  IF public.ceo_current_role() NOT IN ('ceo', 'admin') THEN
    RETURN NULL;
  END IF;

  -- entry_date é `date` (dia do pagamento, sem hora); o período chega em UTC.
  -- Converte no fuso de Brasília pelo mesmo motivo do src/lib/period.ts: o app
  -- roda em UTC no Cloudflare e o corte do dia tem que ser o corte BRT.
  v_start := (p_start AT TIME ZONE 'America/Sao_Paulo')::date;
  v_end := (p_end AT TIME ZONE 'America/Sao_Paulo')::date;
  v_days := GREATEST(v_end - v_start, 1);
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
    -- "Pagamento cancelado" (327456661) não conta; as outras 4 fases sim
    -- (o dinheiro entra quando o card nasce — decisão do dono).
    WHERE c.current_phase_id IS DISTINCT FROM '327456661'
  ),
  periodo AS (
    SELECT * FROM base WHERE entry_date >= v_start AND entry_date < v_end
  ),
  anterior AS (
    SELECT * FROM base WHERE entry_date >= v_prev_start AND entry_date < v_start
  ),
  meses AS (
    SELECT generate_series(
      date_trunc('month', (v_end - 1)::date) - interval '11 months',
      date_trunc('month', (v_end - 1)::date),
      interval '1 month'
    )::date AS m
  ),
  -- ⚠️ A ordem tem que ser imposta no jsonb_agg, não num ORDER BY dentro da CTE:
  -- agregar sobre uma CTE ordenada NÃO garante a ordem do array. O gráfico depende da
  -- ordem cronológica e o KPI "maior categoria" lê o primeiro elemento de byCategory.
  mensal AS (
    SELECT
      mm.m AS month_start,
      to_char(mm.m, 'YYYY-MM') AS month,
      COALESCE(SUM(b.signed_value), 0) AS total,
      COUNT(b.entry_date) AS count
    FROM meses mm
    LEFT JOIN base b ON date_trunc('month', b.entry_date)::date = mm.m
    GROUP BY mm.m
  ),
  por_categoria AS (
    SELECT category AS key, SUM(signed_value) AS total, COUNT(*) AS count
    FROM periodo GROUP BY category
  ),
  por_departamento AS (
    SELECT department AS key, SUM(signed_value) AS total, COUNT(*) AS count
    FROM periodo GROUP BY department
  ),
  por_forma AS (
    SELECT payment_method AS key, SUM(signed_value) AS total, COUNT(*) AS count
    FROM periodo GROUP BY payment_method
  ),
  -- Suspeita de lançamento em duplicata: mesmo contrato + mesmo valor + mesma
  -- categoria + mesmo dia. A categoria é parte da regra de propósito — o mesmo
  -- contrato com categorias diferentes (um pagamento e um desconto, por exemplo)
  -- é dado LEGÍTIMO e não pode virar alerta.
  duplicados AS (
    SELECT
      c.contract_ref,
      c.category,
      c.paid_date,
      c.paid_value,
      COUNT(*) AS cards,
      jsonb_agg(c.pipefy_card_id ORDER BY c.pipefy_card_id) AS card_ids,
      jsonb_agg(DISTINCT COALESCE(c.department, 'Sem departamento')) AS departments
    FROM public.fin_cards c
    WHERE c.current_phase_id IS DISTINCT FROM '327456661'
      AND c.contract_ref IS NOT NULL
      AND c.paid_value IS NOT NULL
      AND c.paid_date >= v_start
      AND c.paid_date < v_end
    GROUP BY c.contract_ref, c.category, c.paid_date, c.paid_value
    HAVING COUNT(*) > 1
  )
  SELECT jsonb_build_object(
    'periodStart', v_start,
    'periodEnd', v_end,
    'total', COALESCE((SELECT SUM(signed_value) FROM periodo), 0),
    'count', (SELECT COUNT(*) FROM periodo),
    'previousTotal', COALESCE((SELECT SUM(signed_value) FROM anterior), 0),
    'previousCount', (SELECT COUNT(*) FROM anterior),
    'monthly', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('month', month, 'total', total, 'count', count)
                       ORDER BY month_start)
      FROM mensal
    ), '[]'::jsonb),
    'byCategory', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', key, 'total', total, 'count', count)
                       ORDER BY total DESC)
      FROM por_categoria
    ), '[]'::jsonb),
    'byDepartment', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', key, 'total', total, 'count', count)
                       ORDER BY total DESC)
      FROM por_departamento
    ), '[]'::jsonb),
    'byPaymentMethod', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', key, 'total', total, 'count', count)
                       ORDER BY total DESC)
      FROM por_forma
    ), '[]'::jsonb),
    'duplicates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'contractRef', contract_ref,
        'category', category,
        'paidDate', paid_date,
        'value', paid_value,
        'cards', cards,
        'cardIds', card_ids,
        'departments', departments
      ) ORDER BY paid_date DESC, contract_ref)
      FROM duplicados
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_ceo_financeiro(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ceo_financeiro(timestamptz, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.get_ceo_financeiro(timestamptz, timestamptz) IS
  'Entradas do Financeiro para o painel do CEO (guarda ceo/admin). Ver docs/projetopainelceo-docs/updates/painel-ceo-sprints.md';


-- ── Conferir depois de aplicar ──────────────────────────────────────────────
-- 1) Tabelas e funções nasceram?
--      SELECT count(*) FROM public.fin_cards;    -- 0 antes do backfill
--      SELECT public.fin_parse_date('10/07/2026');   -- esperado: 2026-07-10  (NÃO null!)
--      SELECT public.fin_parse_money('1.500,00');    -- esperado: 1500.00
--      SELECT public.fin_entry_sign('Desconto - Devolução');  -- esperado: -1
--      SELECT public.fin_entry_sign('Pagamento - Distrato');  -- esperado:  1
--      SELECT public.fin_norm_department('Departamento - Jurídico'); -- Departamento - Negociação
--
-- 2) Depois do backfill (npm run import:financeiro):
--      SELECT count(*) FROM public.fin_cards;
--      SELECT source, count(*) FROM public.fin_entries GROUP BY source;
--        -- esperado: 'card' (cards de 2026) e 'parcela' (histórico), os dois > 0
--      SELECT count(*) FROM public.fin_cards WHERE paid_date IS NULL;  -- esperado: 0
--
-- 3) A guarda funciona? (logado como ceo/admin devolve jsonb; outro papel, NULL)
--      SELECT public.get_ceo_financeiro(now() - interval '30 days', now());
