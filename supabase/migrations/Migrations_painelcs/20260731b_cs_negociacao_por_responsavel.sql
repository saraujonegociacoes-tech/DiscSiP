-- ============================================================================
-- CS — Página 2 (Equipe): "Negociações feitas" passa a ser por RESPONSÁVEL DA
-- NEGOCIAÇÃO (campo da fase), não pelo assignee do card
-- ============================================================================
-- Decisão do dono (2026-07-31): a tabela "Negociações feitas no período" era
-- agrupada por `cs_cards.responsible_agent_id` (o assignee do card no Pipefy).
-- Isso responde "de quem é o card", não "quem fez a negociação" — e as duas
-- coisas divergem (o card segue com o consultor do acompanhamento mensal
-- enquanto a negociação é feita por outra pessoa).
--
-- A partir daqui a atribuição vem do campo da própria fase de Negociação:
--   field-id `quem_realizou_a_negocia_o` — rótulo "Quem realizou a Negociação?",
--   tipo `select` com as opções Larissa · Charles · Laura · Mayara.
-- Introspecção ao vivo (2026-07-31, pipe 305801110): é o ÚNICO campo de
-- responsável na fase `Negociação do Cliente` (336929552). Guarda TEXTO (o
-- primeiro nome da opção), não o usuário do Pipefy — então NÃO casa com
-- `cs_agents` (ex.: "Laura" não é assignee de nenhum card) e o agrupamento é
-- pelo próprio valor do campo. O valor PERSISTE depois que o card sai da fase
-- (conferido: cards em 3°/5°/6° Mês seguem com o campo preenchido), que é o que
-- torna o agrupamento possível fora da fase de negociação.
--
-- ⚠ ESCOPO: só a seção "Negociações feitas no período". MOVIMENTO (recebidos /
--   movido c/ ou s/ atualização / só atualização / parado) continua por
--   `responsible_agent_id`, como antes — decisão explícita do dono. As páginas
--   1 (Visão Geral), 3 (Minutas) e 4 (Pagamento) também seguem pelo assignee.
--
-- Peças:
--   1. `cs_negotiation_snapshots.negotiator` — congela QUEM estava no campo no
--      momento em que a negociação foi feita (atribuição point-in-time).
--   2. `ingest_cs_card` — corpo idêntico ao da 20260730b + captura do campo no
--      snapshot. Forward-only: não edita a migration já aplicada.
--   3. `get_cs_team(p_start, p_end)` — mesma assinatura; só o bloco de
--      negociações muda (agrupa por negotiator, sem join em cs_agents).
--
-- Retrocompatibilidade: snapshots gravados ANTES desta migration têm
-- `negotiator` NULL. A leitura cai no valor ATUAL do card (COALESCE), então a
-- tela já rende com o histórico existente; conforme o Make acumula, cada
-- negociação passa a carregar o responsável congelado na hora.
--
-- ⚠ Depois de aplicar: nada obrigatório. Re-rodar `npm run import:cs-cards` só
--   adianta o congelamento nos cards que ainda vão mudar os 5 campos (o
--   backfill não reescreve snapshot antigo — ele só insere quando há delta).
-- ============================================================================

-- ── 1. Responsável da negociação congelado no snapshot ───────────────────────
ALTER TABLE public.cs_negotiation_snapshots
  ADD COLUMN IF NOT EXISTS negotiator text;

COMMENT ON COLUMN public.cs_negotiation_snapshots.negotiator IS
  'Valor de quem_realizou_a_negocia_o ("Quem realizou a Negociação?") no momento do snapshot. '
  'NULL nos snapshots anteriores a 2026-07-31 — a leitura cai no valor atual do card.';

-- ── 2. Ingestão: captura o campo no snapshot ─────────────────────────────────
-- Corpo IDÊNTICO ao da 20260730b (assignees, metadata, transição,
-- current_phase_entered_at, fase nova tolerada, troca de responsável,
-- comentários, snapshot de negociação, pagamentos conectados) + `v_negotiator`.
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
  v_negotiator text;   -- NOVO: "Quem realizou a Negociação?" no momento do snapshot
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

  -- NOVO: quem realizou a negociação (select da fase; texto, não usuário do Pipefy).
  -- Lê `value` e cai em `array_value[0]` — mesma defesa do `sele_o_de_etiqueta` na P3
  -- (o Pipefy devolve select ora num, ora noutro). NÃO entra na detecção de delta:
  -- trocar só o responsável não é "negociação feita" (o gatilho segue sendo os 5 campos).
  v_negotiator := NULLIF(btrim(COALESCE(
    NULLIF(v_metadata->'quem_realizou_a_negocia_o'->>'value', ''),
    NULLIF(v_metadata->'quem_realizou_a_negocia_o'->'array_value'->>0, ''),
    ''
  )), '');

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
      changed_fields, top_priority_changed, negotiator, captured_at
    ) VALUES (
      v_cs_card_id, v_pipefy_card_id, v_qd, v_qa, v_pa, v_pp, v_pv, v_filled, (v_qd IS NOT NULL),
      v_changed, v_top, v_negotiator, v_updated_at
    );
  END IF;

  -- Pagamentos conectados do Financeiro (child_relations → cs_card_payments; 20260730b).
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

-- ── 3. Leitura da Página 2 (Equipe) ──────────────────────────────────────────
-- Mesma assinatura da 20260723_cs_team_v2; o bloco de MOVIMENTO é idêntico (segue
-- por responsible_agent_id). Só as NEGOCIAÇÕES mudam de eixo: agrupam pelo campo
-- da fase, não pelo assignee — e por isso somem o `agentId`/`agentName` e o join
-- em cs_agents, dando lugar a `negotiator`/`negotiatorName` (texto do select).
--
-- Atribuição point-in-time com degradação: pega o negotiator do ÚLTIMO snapshot
-- COM DELTA dentro do período (a negociação mais recente do card naquele ciclo) e,
-- se ele for NULL (snapshot anterior a esta migration), cai no valor ATUAL do card.
-- Card sem valor em lugar nenhum vai pro balde "Sem responsável pela negociação".
CREATE OR REPLACE FUNCTION public.get_cs_team(p_start timestamptz, p_end timestamptz)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH
  excl AS (
    SELECT id, name FROM public.cs_phases WHERE is_negotiation OR exclude_from_movement
  ),
  -- ── Movimento (coorte = cards ativos) — INALTERADO, por responsible_agent_id ──
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
  -- Coorte inalterada (1 linha por CARD com delta no período); só o eixo muda.
  -- DISTINCT ON = o snapshot mais recente do card dentro do período.
  neg_snap AS (
    SELECT DISTINCT ON (s.cs_card_id) s.cs_card_id, s.negotiator
    FROM public.cs_negotiation_snapshots s
    WHERE s.captured_at >= p_start AND s.captured_at < p_end
      AND COALESCE(array_length(s.changed_fields, 1), 0) > 0
    ORDER BY s.cs_card_id, s.captured_at DESC
  ),
  neg_cards AS (
    SELECT
      c.pipefy_card_id, c.title,
      NULLIF(btrim(COALESCE(
        ns.negotiator,
        NULLIF(c.metadata->'quem_realizou_a_negocia_o'->>'value', ''),
        NULLIF(c.metadata->'quem_realizou_a_negocia_o'->'array_value'->>0, ''),
        ''
      )), '') AS negotiator,
      public.cs_field_filled(c.metadata, 'q_d_valor_da_quita_o_com_desconto')            AS f_qd,
      public.cs_field_filled(c.metadata, 'q_a_valor_da_quita_o_atualizada_sem_desconto') AS f_qa,
      public.cs_field_filled(c.metadata, 'p_a_parcelas_em_atraso')                       AS f_pa,
      public.cs_field_filled(c.metadata, 'p_p_parcelas_a_pagar')                         AS f_pp,
      public.cs_field_filled(c.metadata, 'p_v_parcelas_vencer')                          AS f_pv
    FROM public.cs_cards c
    JOIN neg_snap ns ON ns.cs_card_id = c.id
  ),
  neg_final AS (
    SELECT
      pipefy_card_id, title, negotiator,
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
      nf.negotiator,
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
    GROUP BY nf.negotiator
  ),
  negotiations AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'negotiator', na.negotiator,
        'negotiatorName', COALESCE(na.negotiator, 'Sem responsável pela negociação'),
        'total', na.total,
        'completa', na.completa,
        'parcial', na.parcial,
        'incompleta', na.incompleta,
        'cards', na.cards
      )
      ORDER BY na.total DESC, na.negotiator ASC NULLS LAST
    ), '[]'::jsonb) AS arr
    FROM neg_agent na
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
-- 1) A coluna existe e a ingestão passou a preencher:
--    SELECT count(*) FILTER (WHERE negotiator IS NOT NULL) AS com_negociador, count(*) AS total
--    FROM public.cs_negotiation_snapshots;
-- 2) O eixo da tabela virou o campo da fase (esperado: nomes do select — Larissa/
--    Charles/Laura/Mayara — e/ou "Sem responsável pela negociação"):
--    SELECT jsonb_pretty(get_cs_team(now() - interval '400 days', now()) -> 'negotiations');
-- 3) O movimento continua por assignee (nomes completos de cs_agents):
--    SELECT jsonb_pretty(get_cs_team(now() - interval '400 days', now()) -> 'movement');
-- 4) O total não mudou (mesma coorte, só reagrupada):
--    SELECT get_cs_team(now() - interval '400 days', now()) -> 'negotiationTotals';
