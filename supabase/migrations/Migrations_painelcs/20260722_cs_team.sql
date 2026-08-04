-- ============================================================================
-- Painel de Sucesso do Cliente (CS) — Página 2: Equipe (série temporal)
-- ============================================================================
-- Reformulação 2026-07-21 (ver docs/updates/painel-sucesso-cliente-cs.md). Esta
-- migration é a FUNDAÇÃO da Página 2 (Equipe): a série temporal que hoje não
-- existe. Ela adiciona a ingestão que faltava pra começar a acumular a partir de
-- agora + a RPC de leitura da aba.
--
-- Decisões do dono (sessão 2026-07-22):
--   · Atribuição do "atualizou?": QUALQUER comentário no card conta (guardamos o
--     autor mesmo assim, pra drill-down e pra poder trocar depois sem re-ingerir).
--   · "Negociação feita" no ciclo = MUDANÇA nos 5 campos (entrada na fase NÃO conta).
--   · Relevância pela ORDEM DE PRIORIDADE (sem epsilon de R$/%): guardamos toda
--     mudança de valor e classificamos pela maior prioridade que mudou —
--     Q.D(1) › Q.A(2) › P.A(3) › P.P(4) › P.V(5).
--   · Completude (snapshot atual): Completa=5 · Parcial=3–4 COM Q.D · Incompleta=
--     1–2, ou 3–4 SEM Q.D · Sem negociação=0.
--   · "Cards recebidos no ciclo": novo `cs_card_assignee_events` (troca de
--     responsável) — barato agora, caro retrofitar depois.
--
-- Peças:
--   1.  cs_phases: flags is_negotiation / exclude_from_movement (viés data-driven).
--   2.  cs_card_events.from_phase_id (fase de origem por id — habilita ignorar
--       SAÍDA de negociação/aguardando, não só a entrada).
--   3.  Tabelas novas: cs_card_comments, cs_negotiation_snapshots,
--       cs_card_assignee_events (+ RLS estrito, escopo via card pai).
--   4.  ingest_cs_card estendida: tolerante a fase nova (upsert defensivo),
--       persiste comentários, snapshota os 5 campos (detecção de delta) e registra
--       troca de responsável. ingest_cs_event passa a gravar from_phase_id.
--   5.  get_cs_team(p_start, p_end) — leitura da aba Equipe numa chamada (jsonb).
--
-- ⚠ Depois de aplicar: re-rodar `npm run import:cs-cards` (query já com comments)
--   pra semear os comentários existentes + o 1º snapshot de cada card. As métricas
--   de série temporal (movimento/comentário/negociação por ciclo) só ganham corpo
--   conforme o cenário do Make roda daqui pra frente — a completude já rende do
--   snapshot atual.
-- ============================================================================

-- ── 1. Flags de fase (viés de movimento, data-driven) ────────────────────────
-- Em vez de hardcodar ids no cálculo, o dashboard lê estas flags. O dono liga/
-- desliga com um UPDATE — sem redeploy.
ALTER TABLE public.cs_phases
  ADD COLUMN IF NOT EXISTS is_negotiation        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exclude_from_movement  boolean NOT NULL DEFAULT false;

-- Fase de Negociação (separada do movimento geral, tem controle próprio na aba).
-- Decisão do dono: "Negociação" = `Negociação do Cliente` (funnel_order 2).
UPDATE public.cs_phases SET is_negotiation = true WHERE id = '336929552';

-- "Aguardando pagamento": ignorar entrada E saída no cálculo de movimento. A fase
-- existe no pipe mas está vazia e não está nas 35 fases seedadas (2026-07-22). O
-- upsert defensivo (passo 4) vai inseri-la assim que um card cair lá; então basta:
--   UPDATE public.cs_phases SET exclude_from_movement = true WHERE id = '<id_aguardando_pagamento>';
-- (rode quando souber o id — ou marque pelo nome depois de o backfill semeá-la).

-- ── 2. Fase de origem por id nos eventos de transição ────────────────────────
-- Eventos antigos (backfill) ficam com NULL aqui; o cálculo usa fallback por nome.
ALTER TABLE public.cs_card_events
  ADD COLUMN IF NOT EXISTS from_phase_id text;

-- ── 3. Tabelas novas ─────────────────────────────────────────────────────────

-- 3a. Comentários do card (base de "atualização = comentário"). Guarda o autor
--     (author_name é escalar e sempre vem; author.id quando disponível). Dedup por
--     (card, created_at, hash do texto) — reprocessar no overlap do poll não duplica.
CREATE TABLE IF NOT EXISTS public.cs_card_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cs_card_id uuid NOT NULL REFERENCES public.cs_cards(id) ON DELETE CASCADE,
  pipefy_card_id text NOT NULL,
  pipefy_comment_id text,
  author_pipefy_id text,
  author_name text,
  text text,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL,          -- created_at do comentário no Pipefy
  ingested_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cs_card_comments_dedup_idx
  ON public.cs_card_comments (pipefy_card_id, created_at, content_hash);
CREATE INDEX IF NOT EXISTS cs_card_comments_card_idx ON public.cs_card_comments (cs_card_id);
CREATE INDEX IF NOT EXISTS cs_card_comments_created_idx ON public.cs_card_comments (created_at);

-- 3b. Snapshot dos 5 campos de negociação (histórico anti "update insignificante").
--     Grava toda MUDANÇA de valor (comparação por string = qualquer delta, honra a
--     decisão de não usar epsilon numérico). `changed_fields` = quais dos 5 mudaram
--     vs o snapshot anterior; `top_priority_changed` = maior prioridade mudada
--     (1=Q.D … 5=P.V). O 1º snapshot de cada card é a linha-base (changed vazio).
CREATE TABLE IF NOT EXISTS public.cs_negotiation_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cs_card_id uuid NOT NULL REFERENCES public.cs_cards(id) ON DELETE CASCADE,
  pipefy_card_id text NOT NULL,
  qd text, qa text, pa text, pp text, pv text,     -- valores crus no momento
  filled_count int NOT NULL,                        -- quantos dos 5 preenchidos
  has_qd boolean NOT NULL,                           -- Q.D preenchido (âncora)?
  changed_fields text[] NOT NULL DEFAULT '{}',
  top_priority_changed int,                          -- 1..5; NULL na linha-base
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cs_neg_snap_card_idx ON public.cs_negotiation_snapshots (cs_card_id);
CREATE INDEX IF NOT EXISTS cs_neg_snap_captured_idx ON public.cs_negotiation_snapshots (captured_at);

-- 3c. Troca de responsável (base de "cards recebidos no ciclo e onde parou").
--     Dedup por (card, occurred_at). Card novo já atribuído = 1 evento de recebimento.
CREATE TABLE IF NOT EXISTS public.cs_card_assignee_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cs_card_id uuid NOT NULL REFERENCES public.cs_cards(id) ON DELETE CASCADE,
  pipefy_card_id text NOT NULL,
  from_agent_id uuid REFERENCES public.cs_agents(id),
  to_agent_id uuid REFERENCES public.cs_agents(id),
  to_phase_id text,                                  -- fase onde o card estava (onde parou)
  to_phase text,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cs_card_assignee_events_dedup_idx
  ON public.cs_card_assignee_events (pipefy_card_id, occurred_at);
CREATE INDEX IF NOT EXISTS cs_card_assignee_events_card_idx ON public.cs_card_assignee_events (cs_card_id);
CREATE INDEX IF NOT EXISTS cs_card_assignee_events_to_agent_idx ON public.cs_card_assignee_events (to_agent_id);

-- ── RLS das tabelas novas (mesmo escopo estrito de cs_card_events: via card pai) ──
ALTER TABLE public.cs_card_comments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cs_negotiation_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cs_card_assignee_events   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cs_card_comments_select ON public.cs_card_comments;
CREATE POLICY cs_card_comments_select ON public.cs_card_comments FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.cs_cards c
    WHERE c.id = cs_card_comments.cs_card_id
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

DROP POLICY IF EXISTS cs_negotiation_snapshots_select ON public.cs_negotiation_snapshots;
CREATE POLICY cs_negotiation_snapshots_select ON public.cs_negotiation_snapshots FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.cs_cards c
    WHERE c.id = cs_negotiation_snapshots.cs_card_id
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

DROP POLICY IF EXISTS cs_card_assignee_events_select ON public.cs_card_assignee_events;
CREATE POLICY cs_card_assignee_events_select ON public.cs_card_assignee_events FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.cs_cards c
    WHERE c.id = cs_card_assignee_events.cs_card_id
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

-- ── 4. Ingestão estendida ────────────────────────────────────────────────────

-- Helper: 1 se o campo (por field-id) está preenchido no metadata, senão 0. IMMUTABLE
-- pra poder ser usado em agregações/filtros da RPC de leitura sem custo.
CREATE OR REPLACE FUNCTION public.cs_field_filled(p_metadata jsonb, p_field text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN NULLIF(btrim(COALESCE(p_metadata -> p_field ->> 'value', '')), '') IS NOT NULL THEN 1
    ELSE 0
  END
$$;

-- ingest_cs_event: agora grava from_phase_id (fase de origem por id).
CREATE OR REPLACE FUNCTION public.ingest_cs_event(payload jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.cs_card_events (cs_card_id, pipefy_card_id, from_phase, from_phase_id, to_phase, to_phase_id, agent_id, occurred_at)
  VALUES (
    (payload->>'cs_card_id')::uuid,
    payload->>'pipefy_card_id',
    payload->>'from_phase',
    payload->>'from_phase_id',
    payload->>'to_phase',
    payload->>'to_phase_id',
    NULLIF(payload->>'agent_id', '')::uuid,
    (payload->>'occurred_at')::timestamptz
  )
  ON CONFLICT (pipefy_card_id, to_phase_id, occurred_at) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_cs_event(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_cs_event(jsonb) TO service_role;

-- ingest_cs_card: tudo da 20260721 (assignees, metadata, transição, current_phase_entered_at)
--   + fase nova tolerada (upsert defensivo, evita quebra de FK quando o pipe ganha fase)
--   + comentários (dedup) + snapshot de negociação (detecção de delta) + troca de responsável.
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
  -- funnel_order/pipefy_index altos (sorta por último); o dono corrige order/flags depois.
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

  -- Transição de fase (só quando muda; occurred_at = updated_at do card). Agora leva
  -- from_phase_id, pra o dashboard ignorar também a SAÍDA de negociação/aguardando.
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

  -- Troca de responsável (base de "cards recebidos"). Card novo já atribuído conta como
  -- 1 recebimento. Backfill re-rodado não gera evento (prev = novo).
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

  -- Snapshot de negociação: compara os 5 campos com o último snapshot; grava a linha-base
  -- (1ª vez) ou quando qualquer valor mudou. Sem epsilon — string diferente = mudou.
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

  RETURN jsonb_build_object('cs_card_id', v_cs_card_id, 'agent_id', v_agent_id, 'duplicate', v_duplicate);
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_cs_card(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_cs_card(jsonb) TO service_role;

-- ── 5. Leitura da Página 2 (Equipe) ──────────────────────────────────────────
-- SECURITY INVOKER (default): o RLS de cs_cards/eventos/comentários/snapshots já
-- escopa por quem está logado. Agrega no Postgres (jsonb numa linha só, mesmo truque
-- da get_cs_matrix) pra não puxar tabela inteira pro Worker.
--
-- Coorte dos buckets e da completude = cards ATIVOS (não terminais). Movimento
-- ignora entrada E saída de fases is_negotiation/exclude_from_movement. "Atualizou?"
-- = qualquer comentário no ciclo. "Negociação feita" = mudança real nos 5 campos no
-- ciclo (linha-base não conta). Completude do snapshot atual (rende sem série temporal).
CREATE OR REPLACE FUNCTION public.get_cs_team(p_start timestamptz, p_end timestamptz)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH
  excl AS (
    SELECT id, name FROM public.cs_phases WHERE is_negotiation OR exclude_from_movement
  ),
  active_cards AS (
    SELECT c.id, c.responsible_agent_id, c.metadata
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
  neg_done AS (
    SELECT s.cs_card_id, MIN(s.top_priority_changed) AS top_tier
    FROM public.cs_negotiation_snapshots s
    WHERE s.captured_at >= p_start AND s.captured_at < p_end
      AND COALESCE(array_length(s.changed_fields, 1), 0) > 0
    GROUP BY s.cs_card_id
  ),
  received AS (
    SELECT a.to_agent_id AS agent_id, count(*) AS n
    FROM public.cs_card_assignee_events a
    WHERE a.occurred_at >= p_start AND a.occurred_at < p_end
    GROUP BY a.to_agent_id
  ),
  card_flags AS (
    SELECT
      ac.id AS cs_card_id,
      ac.responsible_agent_id AS agent_id,
      (ac.id IN (SELECT cs_card_id FROM moved))    AS is_moved,
      (ac.id IN (SELECT cs_card_id FROM commented)) AS is_commented,
      (ac.id IN (SELECT cs_card_id FROM neg_done))  AS is_neg_done,
      ( public.cs_field_filled(ac.metadata, 'q_d_valor_da_quita_o_com_desconto')
      + public.cs_field_filled(ac.metadata, 'q_a_valor_da_quita_o_atualizada_sem_desconto')
      + public.cs_field_filled(ac.metadata, 'p_a_parcelas_em_atraso')
      + public.cs_field_filled(ac.metadata, 'p_p_parcelas_a_pagar')
      + public.cs_field_filled(ac.metadata, 'p_v_parcelas_vencer') ) AS filled,
      (public.cs_field_filled(ac.metadata, 'q_d_valor_da_quita_o_com_desconto') = 1) AS has_qd
    FROM active_cards ac
  ),
  per_agent AS (
    SELECT
      cf.agent_id,
      count(*) AS active_cards,
      count(*) FILTER (WHERE cf.is_moved AND cf.is_commented)          AS moved_with_update,
      count(*) FILTER (WHERE cf.is_moved AND NOT cf.is_commented)      AS moved_no_update,
      count(*) FILTER (WHERE NOT cf.is_moved AND cf.is_commented)      AS only_update,
      count(*) FILTER (WHERE NOT cf.is_moved AND NOT cf.is_commented)  AS idle,
      count(*) FILTER (WHERE cf.filled = 5)                            AS neg_completa,
      count(*) FILTER (WHERE cf.filled BETWEEN 3 AND 4 AND cf.has_qd)  AS neg_parcial,
      count(*) FILTER (WHERE cf.filled BETWEEN 1 AND 4
                        AND NOT (cf.filled BETWEEN 3 AND 4 AND cf.has_qd)) AS neg_incompleta,
      count(*) FILTER (WHERE cf.filled = 0)                            AS neg_sem,
      count(*) FILTER (WHERE cf.is_neg_done)                           AS negociacoes_feitas
    FROM card_flags cf
    GROUP BY cf.agent_id
  ),
  agents_json AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'agentId', pa.agent_id,
        'agentName', COALESCE(ag.pipefy_name, 'Sem responsável'),
        'activeCards', pa.active_cards,
        'movedWithUpdate', pa.moved_with_update,
        'movedNoUpdate', pa.moved_no_update,
        'onlyUpdate', pa.only_update,
        'idle', pa.idle,
        'received', COALESCE(rc.n, 0),
        'negCompleta', pa.neg_completa,
        'negParcial', pa.neg_parcial,
        'negIncompleta', pa.neg_incompleta,
        'negSem', pa.neg_sem,
        'negociacoesFeitas', pa.negociacoes_feitas
      )
      ORDER BY pa.active_cards DESC, ag.pipefy_name ASC NULLS LAST
    ), '[]'::jsonb) AS arr
    FROM per_agent pa
    LEFT JOIN public.cs_agents ag ON ag.id = pa.agent_id
    LEFT JOIN received rc ON rc.agent_id = pa.agent_id
  ),
  totals AS (
    SELECT jsonb_build_object(
      'activeCards', COALESCE(sum(active_cards), 0),
      'movedWithUpdate', COALESCE(sum(moved_with_update), 0),
      'movedNoUpdate', COALESCE(sum(moved_no_update), 0),
      'onlyUpdate', COALESCE(sum(only_update), 0),
      'idle', COALESCE(sum(idle), 0),
      'received', (SELECT COALESCE(sum(n), 0) FROM received),
      'negCompleta', COALESCE(sum(neg_completa), 0),
      'negParcial', COALESCE(sum(neg_parcial), 0),
      'negIncompleta', COALESCE(sum(neg_incompleta), 0),
      'negSem', COALESCE(sum(neg_sem), 0),
      'negociacoesFeitas', COALESCE(sum(negociacoes_feitas), 0)
    ) AS obj
    FROM per_agent
  ),
  tiers AS (
    SELECT jsonb_build_object(
      'qd', count(*) FILTER (WHERE top_tier = 1),
      'qa', count(*) FILTER (WHERE top_tier = 2),
      'pa', count(*) FILTER (WHERE top_tier = 3),
      'pp', count(*) FILTER (WHERE top_tier = 4),
      'pv', count(*) FILTER (WHERE top_tier = 5)
    ) AS obj
    FROM neg_done
  )
  SELECT jsonb_build_object(
    'periodStart', p_start,
    'periodEnd', p_end,
    'agents', (SELECT arr FROM agents_json),
    'totals', (SELECT obj FROM totals),
    'negotiationTiers', (SELECT obj FROM tiers)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_cs_team(timestamptz, timestamptz) TO authenticated;

-- ── Conferir depois de aplicar ──────────────────────────────────────────────
-- SELECT count(*) FILTER (WHERE is_negotiation) FROM public.cs_phases;  -- 1 (Negociação do Cliente)
-- Depois de re-rodar o backfill (npm run import:cs-cards):
--   SELECT count(*) FROM public.cs_negotiation_snapshots;  -- ~1 por card com algum dos 5 campos
--   SELECT get_cs_team(date_trunc('month', now()) - interval '1 month', now());  -- estrutura jsonb
