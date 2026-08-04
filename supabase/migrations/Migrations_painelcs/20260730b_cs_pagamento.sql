-- ============================================================================
-- Painel de Sucesso do Cliente (CS) — Página 4: Pagamento + Insights
-- ============================================================================
-- Sprint 4 (ver docs/painelcs-docs/updates/painel-sucesso-cliente-cs.md). Modelo HÍBRIDO
-- decidido com o dono (2026-07-30):
--   • PROJEÇÃO ("quando/quanto vão pagar") = campos criados NA FASE "Aguardando Pagamento"
--     do pipe do SC (o plano: valor + vencimento por parcela, teto 3). Ficam no cs_cards.metadata.
--   • REALIZADO/HISTÓRICO ("quanto já pagaram") = conexão do card do SC com o pipe do FINANCEIRO
--     (fonte de verdade do pagamento) via `child_relations` — 1 card do Financeiro = 1 pagamento
--     de 1 parcela. Não se duplica digitação no SC.
--
-- Verificado com probe real (scripts/probe-cs-connection.mjs, card 1421641222 → 1421643991):
--   • A conexão volta na relação child_relations["Subir pagamento"] (conector `subir_pagamento`).
--   • Campos do card do Financeiro: valor pago=`valor_de_contrata_o`, data=`data_do_pagamento`
--     (DD/MM/YYYY!), parcela=`esse_pagamento_referente_a_qual_parcela`, total parcelas=
--     `quantas_vezes_foi_feito_o_parcelamento`, à vista/parcelado=`o_pagamento_a_vista_ou_parcelado`,
--     total cobrança=`valor_total_da_cobran_a`, forma=`forma_de_pagamento`, comprovante=
--     `comprovante_de_pagamento` (array), id=`n_mera_o_do_pagamento_id`, cliente=`nome_completo`/`cpf`.
--   • Slugs de projeção no card do SC (IRREGULARES — o dono duplicou os campos, viraram "copy_of"):
--       parcela 1: `1_parcela_valor`               / `1_parcela_data_do_pagamento`
--       parcela 2: `copy_of_1_parcela_valor`        / `copy_of_1_parcela_data_do_pagamento`
--       parcela 3: `copy_of_2_parcela_valor`        / `copy_of_2_parcela_data_do_pagamento`
--
-- ⚠ Datas em DD/MM/YYYY → REUSA `cs_parse_date` corrigido na 20260730_cs_parse_date_ptbr.sql
--   (make_date, independe do DateStyle). NÃO redefinir a função aqui.
--
-- ⚠ Depois de aplicar:
--   1. A query do Make E do import-cs-cards.mjs precisa incluir o bloco
--      `child_relations { name cards { id title fields { name value array_value datetime_value field { id } } } }`
--      (sem ele, o node não traz os pagamentos e cs_card_payments nasce vazio — degrada, não quebra).
--   2. GATILHO: um pagamento novo conectado no Financeiro pode NÃO mexer no updated_at do card do
--      SC → o poll por delta não pega. Recomendação: pollar o balde "Aguardando Pagamento" (id
--      343781769) SEM filtro de delta a cada rodada (é pequeno), lendo child_relations.
--   3. Re-rodar `npm run import:cs-cards` pra semear cs_card_payments das conexões existentes.
--
-- Migration forward-only. Peças:
--   1. Tabela cs_card_payments (+ RLS estrito, escopo via card pai — igual cs_card_comments).
--   2. ingest_cs_card estendida: mantém TUDO da 20260722 e adiciona a ingestão de child_relations.
--   3. RPCs get_cs_pagamento_projecao() (snapshot) e get_cs_pagamento_historico(p_start,p_end) (série).
-- ============================================================================

-- ── 1. Tabela dos pagamentos realizados (cards do Financeiro conectados) ──────
-- 1 linha por card do Financeiro (payment_pipefy_card_id = idempotência). O valor cru fica
-- guardado em `raw` (jsonb keyed por field-id) pra não precisar de nova migration se amanhã a
-- gente quiser outro campo do Financeiro.
CREATE TABLE IF NOT EXISTS public.cs_card_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cs_card_id uuid NOT NULL REFERENCES public.cs_cards(id) ON DELETE CASCADE,
  sc_pipefy_card_id text NOT NULL,            -- card do SC (pai da conexão)
  payment_pipefy_card_id text NOT NULL,       -- card do Financeiro (conectado)
  relation_name text,                          -- nome da relação ("Subir pagamento")
  parcela_num int,                             -- esse_pagamento_referente_a_qual_parcela
  valor_pago numeric,                          -- valor_de_contrata_o ("Valor que o Cliente Pagou?")
  data_pagamento date,                         -- data_do_pagamento (DD/MM/YYYY → cs_parse_date)
  forma text,                                  -- forma_de_pagamento (Boleto - Sicoob etc.)
  a_vista_ou_parcelado text,                   -- o_pagamento_a_vista_ou_parcelado
  valor_total_cobranca numeric,                -- valor_total_da_cobran_a
  total_parcelas int,                          -- quantas_vezes_foi_feito_o_parcelamento
  comprovante_url text,                        -- comprovante_de_pagamento (1º item do array)
  pagamento_id text,                           -- n_mera_o_do_pagamento_id
  cliente_nome text,                           -- nome_completo (do card do Financeiro)
  cliente_cpf text,                            -- cpf
  raw jsonb,                                   -- todos os fields do card conectado (keyed por id)
  ingested_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cs_card_payments_dedup_idx
  ON public.cs_card_payments (payment_pipefy_card_id);
CREATE INDEX IF NOT EXISTS cs_card_payments_card_idx ON public.cs_card_payments (cs_card_id);
CREATE INDEX IF NOT EXISTS cs_card_payments_data_idx ON public.cs_card_payments (data_pagamento);

-- ── RLS: mesmo escopo estrito de cs_card_comments (via card pai) ──────────────
ALTER TABLE public.cs_card_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cs_card_payments_select ON public.cs_card_payments;
CREATE POLICY cs_card_payments_select ON public.cs_card_payments FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.cs_cards c
    WHERE c.id = cs_card_payments.cs_card_id
      AND (
        public.cs_current_role() IN ('manager', 'admin')
        OR c.responsible_agent_id = public.cs_current_agent_id()
        OR (
          public.cs_current_role() = 'supervisor'
          AND public.cs_current_department_id() = public.cs_department_id()
          AND (c.responsible_agent_id IS NULL OR public.cs_agent_department_id(c.responsible_agent_id) = public.cs_current_department_id())
        )
      )
  )
);
-- Escrita só via RPC SECURITY DEFINER (service_role) — sem policy de INSERT/UPDATE/DELETE.

-- ── 2. ingest_cs_card estendida ──────────────────────────────────────────────
-- Corpo IDÊNTICO ao da 20260722 (assignees, metadata, transição, current_phase_entered_at,
-- fase nova tolerada, troca de responsável, comentários, snapshot de negociação) + um bloco
-- final que persiste os PAGAMENTOS conectados (child_relations → cs_card_payments). Se o node
-- não trouxer child_relations (query ainda não atualizada), o bloco não faz nada (degrada).
CREATE OR REPLACE FUNCTION public.ingest_cs_card(node jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pipefy_card_id text := node->>'id';
  v_title text := node->>'title';
  v_created_at timestamptz := NULLIF(node->>'created_at', '')::timestamptz;
  v_finished_at timestamptz := NULLIF(node->>'finished_at', '')::timestamptz;
  v_done boolean := (node->>'done')::boolean;
  v_updated_at timestamptz := COALESCE(NULLIF(node->>'updated_at', '')::timestamptz, now());
  v_phase_id text := node->'current_phase'->>'id';
  v_phase_name text := node->'current_phase'->>'name';
  v_phase_entered_at timestamptz := NULLIF((
    SELECT ph->>'lastTimeIn'
    FROM jsonb_array_elements(COALESCE(node->'phases_history', '[]'::jsonb)) ph
    WHERE ph->'phase'->>'id' = v_phase_id
    ORDER BY ph->>'lastTimeIn' DESC
    LIMIT 1
  ), '')::timestamptz;
  v_assignees jsonb := COALESCE(node->'assignees', '[]'::jsonb);
  v_assignee_count int := jsonb_array_length(v_assignees);
  v_agent_id uuid;
  v_duplicate boolean := v_assignee_count > 1;
  v_metadata jsonb;
  v_cs_card_id uuid;
  v_from_phase text;
  v_from_phase_id text;
  v_prev_agent_id uuid;
  -- Snapshot de negociação (os 5 campos, na ordem de prioridade)
  v_qd text; v_qa text; v_pa text; v_pp text; v_pv text;
  v_prev_qd text; v_prev_qa text; v_prev_pa text; v_prev_pp text; v_prev_pv text;
  v_has_prev boolean := false;
  v_changed text[] := ARRAY[]::text[];
  v_top int;
  v_filled int;
BEGIN
  -- Assignees → cs_agents.
  INSERT INTO public.cs_agents (pipefy_user_id, pipefy_name, email)
  SELECT a->>'id', a->>'name', a->>'email'
  FROM jsonb_array_elements(v_assignees) AS a
  WHERE a->>'id' IS NOT NULL
  ON CONFLICT (pipefy_user_id) DO UPDATE
    SET pipefy_name = EXCLUDED.pipefy_name, email = EXCLUDED.email;

  IF v_assignee_count > 0 THEN
    SELECT id INTO v_agent_id
    FROM public.cs_agents
    WHERE pipefy_user_id = (v_assignees -> (v_assignee_count - 1))->>'id';
  END IF;

  -- Fase nova? Semeia uma linha mínima pra não violar a FK de cs_cards.current_phase_id.
  IF v_phase_id IS NOT NULL THEN
    INSERT INTO public.cs_phases (id, name, funnel_order, pipefy_index)
    VALUES (v_phase_id, COALESCE(v_phase_name, '(nova fase)'), 9999, 9999)
    ON CONFLICT (id) DO NOTHING;
  END IF;

  -- Metadata = todos os campos por field-id.
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

  -- Estado anterior do card (fase + responsável) — pra detectar transição/troca.
  SELECT current_phase, current_phase_id, responsible_agent_id
    INTO v_from_phase, v_from_phase_id, v_prev_agent_id
  FROM public.cs_cards WHERE pipefy_card_id = v_pipefy_card_id;

  INSERT INTO public.cs_cards (
    pipefy_card_id, title, current_phase_id, current_phase, current_phase_entered_at,
    responsible_agent_id, duplicate_responsible, pipefy_created_at, pipefy_finished_at,
    pipefy_done, metadata, synced_at, updated_at
  ) VALUES (
    v_pipefy_card_id, v_title, v_phase_id, v_phase_name, v_phase_entered_at,
    v_agent_id, v_duplicate, v_created_at, v_finished_at,
    v_done, v_metadata, now(), v_updated_at
  )
  ON CONFLICT (pipefy_card_id) DO UPDATE SET
    title = EXCLUDED.title,
    current_phase_id = EXCLUDED.current_phase_id,
    current_phase = EXCLUDED.current_phase,
    current_phase_entered_at = COALESCE(EXCLUDED.current_phase_entered_at, public.cs_cards.current_phase_entered_at),
    responsible_agent_id = EXCLUDED.responsible_agent_id,
    duplicate_responsible = EXCLUDED.duplicate_responsible,
    pipefy_finished_at = EXCLUDED.pipefy_finished_at,
    pipefy_done = EXCLUDED.pipefy_done,
    metadata = EXCLUDED.metadata,
    synced_at = now(),
    updated_at = EXCLUDED.updated_at
  RETURNING id INTO v_cs_card_id;

  -- Transição de fase (só quando muda; occurred_at = updated_at do card).
  IF v_from_phase_id IS DISTINCT FROM v_phase_id THEN
    PERFORM public.ingest_cs_event(jsonb_build_object(
      'cs_card_id', v_cs_card_id,
      'pipefy_card_id', v_pipefy_card_id,
      'from_phase', v_from_phase,
      'from_phase_id', v_from_phase_id,
      'to_phase', v_phase_name,
      'to_phase_id', v_phase_id,
      'agent_id', v_agent_id,
      'occurred_at', v_updated_at
    ));
  END IF;

  -- Troca de responsável (base de "cards recebidos").
  IF v_prev_agent_id IS DISTINCT FROM v_agent_id AND v_agent_id IS NOT NULL THEN
    INSERT INTO public.cs_card_assignee_events (
      cs_card_id, pipefy_card_id, from_agent_id, to_agent_id, to_phase_id, to_phase, occurred_at
    ) VALUES (
      v_cs_card_id, v_pipefy_card_id, v_prev_agent_id, v_agent_id, v_phase_id, v_phase_name, v_updated_at
    )
    ON CONFLICT (pipefy_card_id, occurred_at) DO NOTHING;
  END IF;

  -- Comentários (base de "atualização = comentário"). Guarda o autor; dedup por hash.
  INSERT INTO public.cs_card_comments (
    cs_card_id, pipefy_card_id, pipefy_comment_id, author_pipefy_id, author_name, text, content_hash, created_at
  )
  SELECT
    v_cs_card_id, v_pipefy_card_id,
    cm->>'id',
    cm->'author'->>'id',
    COALESCE(NULLIF(cm->>'author_name', ''), cm->'author'->>'name'),
    cm->>'text',
    md5(COALESCE(cm->>'text', '')),
    (cm->>'created_at')::timestamptz
  FROM jsonb_array_elements(COALESCE(node->'comments', '[]'::jsonb)) AS cm
  WHERE NULLIF(cm->>'created_at', '') IS NOT NULL
  ON CONFLICT (pipefy_card_id, created_at, content_hash) DO NOTHING;

  -- Snapshot de negociação: compara os 5 campos com o último snapshot.
  v_qd := NULLIF(btrim(COALESCE(v_metadata->'q_d_valor_da_quita_o_com_desconto'->>'value', '')), '');
  v_qa := NULLIF(btrim(COALESCE(v_metadata->'q_a_valor_da_quita_o_atualizada_sem_desconto'->>'value', '')), '');
  v_pa := NULLIF(btrim(COALESCE(v_metadata->'p_a_parcelas_em_atraso'->>'value', '')), '');
  v_pp := NULLIF(btrim(COALESCE(v_metadata->'p_p_parcelas_a_pagar'->>'value', '')), '');
  v_pv := NULLIF(btrim(COALESCE(v_metadata->'p_v_parcelas_vencer'->>'value', '')), '');

  SELECT qd, qa, pa, pp, pv INTO v_prev_qd, v_prev_qa, v_prev_pa, v_prev_pp, v_prev_pv
  FROM public.cs_negotiation_snapshots
  WHERE cs_card_id = v_cs_card_id
  ORDER BY captured_at DESC
  LIMIT 1;
  v_has_prev := FOUND;

  IF v_has_prev THEN
    IF v_qd IS DISTINCT FROM v_prev_qd THEN v_changed := array_append(v_changed, 'q_d'); END IF;
    IF v_qa IS DISTINCT FROM v_prev_qa THEN v_changed := array_append(v_changed, 'q_a'); END IF;
    IF v_pa IS DISTINCT FROM v_prev_pa THEN v_changed := array_append(v_changed, 'p_a'); END IF;
    IF v_pp IS DISTINCT FROM v_prev_pp THEN v_changed := array_append(v_changed, 'p_p'); END IF;
    IF v_pv IS DISTINCT FROM v_prev_pv THEN v_changed := array_append(v_changed, 'p_v'); END IF;
  END IF;

  v_top := CASE
    WHEN 'q_d' = ANY(v_changed) THEN 1
    WHEN 'q_a' = ANY(v_changed) THEN 2
    WHEN 'p_a' = ANY(v_changed) THEN 3
    WHEN 'p_p' = ANY(v_changed) THEN 4
    WHEN 'p_v' = ANY(v_changed) THEN 5
    ELSE NULL
  END;

  v_filled := (v_qd IS NOT NULL)::int + (v_qa IS NOT NULL)::int + (v_pa IS NOT NULL)::int
            + (v_pp IS NOT NULL)::int + (v_pv IS NOT NULL)::int;

  IF (NOT v_has_prev) OR COALESCE(array_length(v_changed, 1), 0) > 0 THEN
    INSERT INTO public.cs_negotiation_snapshots (
      cs_card_id, pipefy_card_id, qd, qa, pa, pp, pv, filled_count, has_qd,
      changed_fields, top_priority_changed, captured_at
    ) VALUES (
      v_cs_card_id, v_pipefy_card_id, v_qd, v_qa, v_pa, v_pp, v_pv, v_filled, (v_qd IS NOT NULL),
      v_changed, v_top, v_updated_at
    );
  END IF;

  -- ── NOVO (Página 4): pagamentos conectados do Financeiro (child_relations) ──
  -- Relação "Subir pagamento": cada card conectado = 1 pagamento de 1 parcela. Reagrega os
  -- fields do card conectado (array) num jsonb keyed por field-id (mesmo shape do metadata) e
  -- lê por slug. Idempotente por payment_pipefy_card_id; re-ingerir atualiza (valor corrigido).
  -- cs_parse_date lê DD/MM/YYYY (20260730). Filtra pela relação "Subir pagamento" pra não
  -- confundir com outras conexões do card (se renomear a conexão, ajustar o nome aqui).
  INSERT INTO public.cs_card_payments (
    cs_card_id, sc_pipefy_card_id, payment_pipefy_card_id, relation_name, parcela_num,
    valor_pago, data_pagamento, forma, a_vista_ou_parcelado, valor_total_cobranca,
    total_parcelas, comprovante_url, pagamento_id, cliente_nome, cliente_cpf, raw
  )
  SELECT
    v_cs_card_id,
    v_pipefy_card_id,
    cc->>'id',
    rel->>'name',
    NULLIF(regexp_replace(COALESCE(pf->'esse_pagamento_referente_a_qual_parcela'->>'value', ''), '\D', '', 'g'), '')::int,
    public.cs_parse_money(pf->'valor_de_contrata_o'->>'value'),
    public.cs_parse_date(pf->'data_do_pagamento'->>'value'),
    NULLIF(pf->'forma_de_pagamento'->>'value', ''),
    NULLIF(pf->'o_pagamento_a_vista_ou_parcelado'->>'value', ''),
    public.cs_parse_money(pf->'valor_total_da_cobran_a'->>'value'),
    NULLIF(regexp_replace(COALESCE(pf->'quantas_vezes_foi_feito_o_parcelamento'->>'value', ''), '\D', '', 'g'), '')::int,
    COALESCE(NULLIF(pf->'comprovante_de_pagamento'->'array_value'->>0, ''), NULLIF(pf->'comprovante_de_pagamento'->>'value', '')),
    NULLIF(pf->'n_mera_o_do_pagamento_id'->>'value', ''),
    NULLIF(pf->'nome_completo'->>'value', ''),
    NULLIF(pf->'cpf'->>'value', ''),
    pf
  FROM jsonb_array_elements(COALESCE(node->'child_relations', '[]'::jsonb)) AS rel
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(rel->'cards', '[]'::jsonb)) AS cc
  CROSS JOIN LATERAL (
    SELECT COALESCE(jsonb_object_agg(
      fld->'field'->>'id',
      jsonb_build_object(
        'name', fld->>'name',
        'value', fld->>'value',
        'array_value', fld->'array_value',
        'datetime_value', fld->>'datetime_value'
      )
    ), '{}'::jsonb) AS pf
    FROM jsonb_array_elements(COALESCE(cc->'fields', '[]'::jsonb)) AS fld
    WHERE fld->'field'->>'id' IS NOT NULL
  ) agg
  WHERE rel->>'name' = 'Subir pagamento'
    AND cc->>'id' IS NOT NULL
  ON CONFLICT (payment_pipefy_card_id) DO UPDATE SET
    parcela_num = EXCLUDED.parcela_num,
    valor_pago = EXCLUDED.valor_pago,
    data_pagamento = EXCLUDED.data_pagamento,
    forma = EXCLUDED.forma,
    a_vista_ou_parcelado = EXCLUDED.a_vista_ou_parcelado,
    valor_total_cobranca = EXCLUDED.valor_total_cobranca,
    total_parcelas = EXCLUDED.total_parcelas,
    comprovante_url = EXCLUDED.comprovante_url,
    pagamento_id = EXCLUDED.pagamento_id,
    cliente_nome = EXCLUDED.cliente_nome,
    cliente_cpf = EXCLUDED.cliente_cpf,
    raw = EXCLUDED.raw,
    ingested_at = now();

  RETURN jsonb_build_object('cs_card_id', v_cs_card_id, 'agent_id', v_agent_id, 'duplicate', v_duplicate);
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_cs_card(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_cs_card(jsonb) TO service_role;

-- ── 3a. Leitura da PROJEÇÃO (snapshot, sem período — como a P1/P3) ───────────
-- SECURITY INVOKER (default): o RLS de cs_cards/cs_card_payments já escopa por papel+departamento.
-- Coorte = cards com plano de pagamento (1ª parcela prevista preenchida) OU com algum pagamento
-- realizado. Por card devolve `plano` (parcelas previstas 1..3, do metadata) + `pagamentos`
-- (realizados, de cs_card_payments). A reconciliação prevista×paga, KPIs de carteira, calendário
-- e status moram no cliente (CsPagamento.tsx) — mesmo padrão da get_cs_minutas.
CREATE OR REPLACE FUNCTION public.get_cs_pagamento_projecao()
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT
      c.id AS cs_card_id,
      c.pipefy_card_id,
      c.title,
      c.responsible_agent_id,
      ag.pipefy_name AS agent_name,
      c.current_phase_id,
      COALESCE(c.current_phase, 'Sem fase') AS phase_name,
      COALESCE(ph.is_terminal, false) AS is_terminal,
      NULLIF(c.metadata->'forma_de_pagamento'->>'value', '') AS forma,
      -- Plano por parcela (slugs irregulares — o dono duplicou os campos).
      public.cs_parse_money(c.metadata->'1_parcela_valor'->>'value')                      AS p1_valor,
      public.cs_parse_date (c.metadata->'1_parcela_data_do_pagamento'->>'value')          AS p1_data,
      public.cs_parse_money(c.metadata->'copy_of_1_parcela_valor'->>'value')              AS p2_valor,
      public.cs_parse_date (c.metadata->'copy_of_1_parcela_data_do_pagamento'->>'value')  AS p2_data,
      public.cs_parse_money(c.metadata->'copy_of_2_parcela_valor'->>'value')              AS p3_valor,
      public.cs_parse_date (c.metadata->'copy_of_2_parcela_data_do_pagamento'->>'value')  AS p3_data
    FROM public.cs_cards c
    LEFT JOIN public.cs_phases ph ON ph.id = c.current_phase_id
    LEFT JOIN public.cs_agents ag ON ag.id = c.responsible_agent_id
    WHERE NULLIF(c.metadata->'1_parcela_valor'->>'value', '') IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.cs_card_payments p WHERE p.cs_card_id = c.id)
  )
  SELECT jsonb_build_object(
    'referenceAt', now(),
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
          'forma', b.forma,
          'plano', (
            SELECT COALESCE(jsonb_agg(
              jsonb_build_object('num', pl.n, 'valorPrevisto', pl.vp, 'dataPrevista', pl.dp)
              ORDER BY pl.n
            ), '[]'::jsonb)
            FROM (VALUES
              (1, b.p1_valor, b.p1_data),
              (2, b.p2_valor, b.p2_data),
              (3, b.p3_valor, b.p3_data)
            ) AS pl(n, vp, dp)
            WHERE pl.vp IS NOT NULL OR pl.dp IS NOT NULL
          ),
          'pagamentos', (
            SELECT COALESCE(jsonb_agg(
              jsonb_build_object(
                'parcelaNum', p.parcela_num,
                'valorPago', p.valor_pago,
                'dataPagamento', p.data_pagamento,
                'comprovanteUrl', p.comprovante_url,
                'pagamentoId', p.pagamento_id
              )
              ORDER BY p.parcela_num NULLS LAST, p.data_pagamento
            ), '[]'::jsonb)
            FROM public.cs_card_payments p
            WHERE p.cs_card_id = b.cs_card_id
          )
        )
        ORDER BY b.phase_name, b.title
      )
      FROM base b
    ), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_cs_pagamento_projecao() TO authenticated;

-- ── 3b. Leitura do HISTÓRICO (série temporal, filtrável por período) ─────────
-- Pagamentos realizados com data_pagamento no período [p_start, p_end). SECURITY INVOKER: o
-- RLS de cs_card_payments/cs_cards escopa. A curva por mês/dia e a lista/drill moram no cliente.
CREATE OR REPLACE FUNCTION public.get_cs_pagamento_historico(p_start timestamptz, p_end timestamptz)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH pays AS (
    SELECT
      p.sc_pipefy_card_id,
      p.payment_pipefy_card_id,
      p.parcela_num,
      p.valor_pago,
      p.data_pagamento,
      p.comprovante_url,
      c.title,
      c.responsible_agent_id,
      ag.pipefy_name AS agent_name
    FROM public.cs_card_payments p
    JOIN public.cs_cards c ON c.id = p.cs_card_id
    LEFT JOIN public.cs_agents ag ON ag.id = c.responsible_agent_id
    WHERE p.data_pagamento >= (p_start)::date
      AND p.data_pagamento <  (p_end)::date
  )
  SELECT jsonb_build_object(
    'periodStart', p_start,
    'periodEnd', p_end,
    'totalRecebido', COALESCE((SELECT sum(valor_pago) FROM pays), 0),
    'count', (SELECT count(*) FROM pays),
    'payments', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'pipefyCardId', pays.sc_pipefy_card_id,
          'paymentCardId', pays.payment_pipefy_card_id,
          'title', pays.title,
          'agentId', pays.responsible_agent_id,
          'agentName', COALESCE(pays.agent_name, 'Sem responsável'),
          'parcelaNum', pays.parcela_num,
          'valorPago', pays.valor_pago,
          'dataPagamento', pays.data_pagamento,
          'comprovanteUrl', pays.comprovante_url
        )
        ORDER BY pays.data_pagamento DESC
      )
      FROM pays
    ), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_cs_pagamento_historico(timestamptz, timestamptz) TO authenticated;

-- ── Conferir depois de aplicar ──────────────────────────────────────────────
-- Depois de atualizar a query (Make/import) com child_relations e re-rodar o backfill:
--   SELECT count(*) FROM public.cs_card_payments;                      -- pagamentos ingeridos
--   SELECT get_cs_pagamento_projecao() -> 'cards' -> 0;                -- 1 card: plano + pagamentos
--   SELECT get_cs_pagamento_historico(now() - interval '90 days', now() + interval '1 day');
