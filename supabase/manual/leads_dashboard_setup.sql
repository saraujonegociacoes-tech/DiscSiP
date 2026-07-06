-- ============================================================================
-- Dashboard de Leads (Pipefy) — SETUP CONSOLIDADO (aplicar de uma vez)
-- ============================================================================
-- Equivale às 3 migrations juntas:
--   20260702_leads_pipefy.sql + 20260702_leads_pipefy_views.sql + 20260703_leads_pipefy_ingest.sql
--
-- COMO USAR: cole tudo no SQL Editor do Supabase e rode uma vez.
--
-- ⚠ Este script RECRIA o schema de leads DO ZERO (drop + create). Rode ANTES da
--   carga histórica (passo 8). Se já houver dados de leads, eles serão apagados.
--   NÃO toca em nada do discador (profiles, campaigns, call_logs etc.).
--
-- SEM CONFLITO: roda numa transação (tudo-ou-nada) e dropa antes de criar, então
--   converge pro estado certo mesmo que uma versão anterior já tenha sido aplicada.
--
-- Depende de objetos já existentes (migrations do discador):
--   public.profiles(id), public.current_profile_role(), role service_role, auth.uid().
-- ============================================================================

BEGIN;

-- ── 0. Reset do domínio de leads (só objetos de leads) ───────────────────────
-- Ordem importa: views -> tabelas (CASCADE dropa as policies) -> funções.
-- A policy leads_select DEPENDE de current_lead_agent_id(), então a função só pode
-- cair depois que as tabelas (e suas policies) forem removidas.
DROP VIEW     IF EXISTS public.v_duplicate_responsibility;
DROP VIEW     IF EXISTS public.v_phase_distribution;
DROP VIEW     IF EXISTS public.v_dead_reasons;
DROP VIEW     IF EXISTS public.v_funnel;
DROP VIEW     IF EXISTS public.v_agent_kpis;
DROP VIEW     IF EXISTS public.v_lead_progress;
DROP TABLE    IF EXISTS public.lead_events CASCADE;
DROP TABLE    IF EXISTS public.leads       CASCADE;
DROP TABLE    IF EXISTS public.lead_agents CASCADE;
DROP TABLE    IF EXISTS public.lead_phases CASCADE;
DROP FUNCTION IF EXISTS public.ingest_lead_card(jsonb);
DROP FUNCTION IF EXISTS public.ingest_lead_event(jsonb);
DROP FUNCTION IF EXISTS public.current_lead_agent_id();

-- ── 1. Tabelas + seed + índices ──────────────────────────────────────────────

-- Classificação de fase (chave = id da fase no Pipefy; name é label)
-- sla_hours (S2): prazo em horas, contado a partir de leads.created_at, para o lead
-- SAIR desta fase (próxima tentativa de contato). NULL = sem SLA (nunca "parado").
CREATE TABLE public.lead_phases (
  pipefy_phase_id text PRIMARY KEY,
  name            text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('produtiva', 'morta')),
  funnel_order    integer,
  is_won          boolean NOT NULL DEFAULT false,
  sla_hours       numeric
);

INSERT INTO public.lead_phases (pipefy_phase_id, name, kind, funnel_order, is_won, sla_hours) VALUES
  ('342851010', 'Recebidos',           'produtiva', 0, false, 0.05),  -- 1ª tentativa: D+0, 3 min
  ('342851011', '1° Acionamento',      'produtiva', 1, false, 8),     -- 2ª tentativa: D+0
  ('343269928', '2° Acionamento',      'produtiva', 2, false, 24),    -- 3ª tentativa: D+1
  ('343269944', '3° Acionamento',      'produtiva', 3, false, 48),    -- 4ª tentativa: D+2
  ('343269967', '4° Acionamento',      'produtiva', 4, false, 96),    -- 5ª tentativa: D+4
  ('343269973', '5° Acionamento',      'produtiva', 5, false, 168),   -- 6ª tentativa: D+7
  ('343269982', '6° Acionamento',      'produtiva', 6, false, NULL),  -- aguarda desfecho
  ('342851012', 'Procedimento',        'produtiva', 7, false, NULL),
  ('342851013', 'Fechamento',          'produtiva', 8, false, NULL),
  ('342851014', 'Venda',               'produtiva', 9, true,  NULL),
  ('342866071', 'Quitação/Negociação', 'morta',     NULL, false, NULL),
  ('342860587', 'Empréstimo',          'morta',     NULL, false, NULL),
  ('342860537', 'Sem Finalidade',      'morta',     NULL, false, NULL);

-- Dimensão de agente do Pipefy (chave = pipefy_user_id; email p/ ponte futura)
CREATE TABLE public.lead_agents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipefy_user_id text NOT NULL UNIQUE,
  pipefy_name    text,
  email          text,
  profile_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_lead_agents_profile
  ON public.lead_agents (profile_id) WHERE profile_id IS NOT NULL;

-- Leads (estado atual de cada card)
CREATE TABLE public.leads (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipefy_card_id        text NOT NULL UNIQUE,
  title                 text,
  current_phase_id      text,                          -- lookup SOFT em lead_phases (sem FK)
  current_phase         text,
  responsible_agent_id  uuid REFERENCES public.lead_agents(id) ON DELETE SET NULL,
  duplicate_responsible boolean NOT NULL DEFAULT false,
  channel               text,                          -- 'capta_o_do_lead'
  discard_reason        text,
  created_at            timestamptz,
  first_contact_at      timestamptz,
  finalized_at          timestamptz,
  updated_at            timestamptz,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_leads_agent   ON public.leads (responsible_agent_id);
CREATE INDEX idx_leads_phase   ON public.leads (current_phase_id);
CREATE INDEX idx_leads_created ON public.leads (created_at);
CREATE INDEX idx_leads_open    ON public.leads (finalized_at) WHERE finalized_at IS NULL;

-- Eventos de lead (log de transições de fase)
CREATE TABLE public.lead_events (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id        uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  pipefy_card_id text NOT NULL,
  from_phase     text,
  to_phase       text,
  to_phase_id    text,                                 -- lookup SOFT em lead_phases
  agent_id       uuid REFERENCES public.lead_agents(id) ON DELETE SET NULL,
  occurred_at    timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_lead_events_lead     ON public.lead_events (lead_id);
CREATE INDEX idx_lead_events_occurred ON public.lead_events (occurred_at);
CREATE INDEX idx_lead_events_agent    ON public.lead_events (agent_id);

-- ── 2. Helper + RLS (só leitura p/ o app; escrita é do service_role) ─────────

CREATE FUNCTION public.current_lead_agent_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.lead_agents WHERE profile_id = auth.uid();
$$;

ALTER TABLE public.lead_phases ENABLE ROW LEVEL SECURITY;
CREATE POLICY lead_phases_select ON public.lead_phases FOR SELECT
  USING (auth.uid() IS NOT NULL);

ALTER TABLE public.lead_agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY lead_agents_select ON public.lead_agents FOR SELECT
  USING (auth.uid() IS NOT NULL);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY leads_select ON public.leads FOR SELECT USING (
  current_profile_role() IN ('supervisor', 'manager', 'admin')
  OR responsible_agent_id = current_lead_agent_id()
);

ALTER TABLE public.lead_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY lead_events_select ON public.lead_events FOR SELECT USING (
  current_profile_role() IN ('supervisor', 'manager', 'admin')
  OR agent_id = current_lead_agent_id()
);

-- ── 3. Views agregadas (security_invoker = true -> RLS do usuário vale) ───────

CREATE VIEW public.v_lead_progress
WITH (security_invoker = true) AS
SELECT
  l.id                     AS lead_id,
  l.responsible_agent_id,
  l.current_phase,
  cp.kind                  AS phase_kind,
  cp.funnel_order          AS current_funnel_order,
  l.created_at,
  l.first_contact_at,
  l.finalized_at,
  l.updated_at,
  l.discard_reason,
  l.channel,
  l.duplicate_responsible,
  (cp.kind = 'morta')      AS is_dead,
  (l.finalized_at IS NULL) AS is_open,
  GREATEST(COALESCE(cp.funnel_order, -1), COALESCE(ev.reached, -1)) AS max_funnel_order,
  (GREATEST(COALESCE(cp.funnel_order, -1), COALESCE(ev.reached, -1)) >= won.ord) AS is_won,
  CASE WHEN l.first_contact_at IS NOT NULL AND l.created_at IS NOT NULL
       THEN EXTRACT(EPOCH FROM (l.first_contact_at - l.created_at)) / 3600.0
  END AS hours_to_first_contact,
  CASE WHEN l.updated_at IS NOT NULL
       THEN EXTRACT(EPOCH FROM (now() - l.updated_at)) / 3600.0
  END AS hours_since_update,
  -- ── colunas do S2 (SLA / lead parado) ──
  l.title                  AS title,
  cp.sla_hours,
  (
        l.finalized_at IS NULL                                                  -- aberto
    AND cp.kind IS DISTINCT FROM 'morta'                                        -- não morto
    AND GREATEST(COALESCE(cp.funnel_order, -1), COALESCE(ev.reached, -1)) < won.ord  -- não ganho
    AND cp.sla_hours IS NOT NULL                                                -- fase com SLA
    AND l.created_at IS NOT NULL
    AND EXTRACT(EPOCH FROM (now() - l.created_at)) / 3600.0 > cp.sla_hours      -- estourou a cadência
  ) AS is_stuck
FROM public.leads l
LEFT JOIN public.lead_phases cp ON cp.pipefy_phase_id = l.current_phase_id
CROSS JOIN (SELECT funnel_order AS ord FROM public.lead_phases WHERE is_won LIMIT 1) won
LEFT JOIN LATERAL (
  SELECT max(p2.funnel_order) AS reached
  FROM public.lead_events e
  JOIN public.lead_phases p2 ON p2.pipefy_phase_id = e.to_phase_id
  WHERE e.lead_id = l.id
) ev ON true;

CREATE VIEW public.v_agent_kpis
WITH (security_invoker = true) AS
SELECT
  la.id          AS agent_id,
  la.pipefy_name,
  la.email,
  count(p.lead_id)                                          AS total_leads,
  count(*) FILTER (WHERE p.is_open)                         AS open_leads,
  count(*) FILTER (WHERE p.is_won)                          AS won_leads,
  count(*) FILTER (WHERE p.is_dead)                         AS dead_leads,
  count(*) FILTER (WHERE p.is_open AND p.hours_since_update > 48) AS stuck_leads,
  round(avg(p.hours_to_first_contact)::numeric, 1)         AS avg_hours_to_first_contact,
  round(count(*) FILTER (WHERE p.is_won)::numeric  / NULLIF(count(p.lead_id), 0), 4) AS conversion_rate,
  round(count(*) FILTER (WHERE p.is_dead)::numeric / NULLIF(count(p.lead_id), 0), 4) AS dead_rate
FROM public.lead_agents la
JOIN public.v_lead_progress p ON p.responsible_agent_id = la.id
GROUP BY la.id, la.pipefy_name, la.email;

CREATE VIEW public.v_funnel
WITH (security_invoker = true) AS
SELECT
  ph.funnel_order,
  ph.name          AS phase_name,
  count(p.lead_id) AS leads_reached
FROM public.lead_phases ph
LEFT JOIN public.v_lead_progress p ON p.max_funnel_order >= ph.funnel_order
WHERE ph.kind = 'produtiva'
GROUP BY ph.funnel_order, ph.name
ORDER BY ph.funnel_order;

CREATE VIEW public.v_dead_reasons
WITH (security_invoker = true) AS
SELECT
  COALESCE(NULLIF(trim(p.discard_reason), ''), 'Não informado') AS reason,
  count(*) AS leads
FROM public.v_lead_progress p
WHERE p.is_dead
GROUP BY COALESCE(NULLIF(trim(p.discard_reason), ''), 'Não informado')
ORDER BY count(*) DESC;

CREATE VIEW public.v_phase_distribution
WITH (security_invoker = true) AS
SELECT
  p.current_phase        AS phase,
  p.phase_kind           AS kind,
  p.current_funnel_order AS funnel_order,
  count(*)               AS leads
FROM public.v_lead_progress p
GROUP BY p.current_phase, p.phase_kind, p.current_funnel_order
ORDER BY p.current_funnel_order NULLS LAST;

CREATE VIEW public.v_duplicate_responsibility
WITH (security_invoker = true) AS
SELECT
  l.id            AS lead_id,
  l.title,
  l.current_phase,
  la.pipefy_name  AS responsible,
  l.updated_at
FROM public.leads l
LEFT JOIN public.lead_agents la ON la.id = l.responsible_agent_id
WHERE l.duplicate_responsible;

-- ── 4. Função de ingestão (o Make chama isto via service_role) ───────────────

CREATE FUNCTION public.ingest_lead_event(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_card_id      text        := payload->>'card_id';
  v_resp         jsonb       := COALESCE(payload->'responsibles', '[]'::jsonb);
  v_elem         jsonb;
  v_recent_uid   text;
  v_dup          boolean;
  v_agent_id     uuid;
  v_lead_id      uuid;
  v_to_phase     text        := NULLIF(trim(payload->>'to_phase'), '');
  v_to_phase_id  text        := NULLIF(payload->>'to_phase_id', '');
  v_occurred_at  timestamptz := COALESCE((payload->>'occurred_at')::timestamptz, now());
BEGIN
  IF v_card_id IS NULL THEN
    RAISE EXCEPTION 'ingest_lead_event: card_id é obrigatório';
  END IF;

  v_dup := jsonb_array_length(v_resp) > 1;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(v_resp)
  LOOP
    IF NULLIF(v_elem->>'id', '') IS NOT NULL THEN
      INSERT INTO public.lead_agents (pipefy_user_id, pipefy_name, email)
      VALUES (
        v_elem->>'id',
        NULLIF(trim(v_elem->>'name'), ''),
        NULLIF(trim(v_elem->>'email'), '')
      )
      ON CONFLICT (pipefy_user_id) DO UPDATE SET
        pipefy_name = COALESCE(EXCLUDED.pipefy_name, lead_agents.pipefy_name),
        email       = COALESCE(EXCLUDED.email, lead_agents.email);
    END IF;
  END LOOP;

  IF jsonb_array_length(v_resp) > 0 THEN
    v_recent_uid := v_resp -> (jsonb_array_length(v_resp) - 1) ->> 'id';
    SELECT id INTO v_agent_id FROM public.lead_agents WHERE pipefy_user_id = v_recent_uid;
  END IF;

  INSERT INTO public.leads (
    pipefy_card_id, title, current_phase_id, current_phase, responsible_agent_id,
    duplicate_responsible, channel, discard_reason,
    created_at, first_contact_at, finalized_at, updated_at, metadata, synced_at
  ) VALUES (
    v_card_id,
    payload->>'title',
    v_to_phase_id,
    v_to_phase,
    v_agent_id,
    v_dup,
    NULLIF(payload->>'channel', ''),
    NULLIF(payload->>'discard_reason', ''),
    (payload->>'created_at')::timestamptz,
    (payload->>'first_contact_at')::timestamptz,
    (payload->>'finalized_at')::timestamptz,
    COALESCE((payload->>'updated_at')::timestamptz, v_occurred_at),
    COALESCE(payload->'raw', '{}'::jsonb),
    now()
  )
  ON CONFLICT (pipefy_card_id) DO UPDATE SET
    title                 = COALESCE(EXCLUDED.title, leads.title),
    current_phase_id      = EXCLUDED.current_phase_id,
    current_phase         = EXCLUDED.current_phase,
    responsible_agent_id  = COALESCE(EXCLUDED.responsible_agent_id, leads.responsible_agent_id),
    duplicate_responsible = EXCLUDED.duplicate_responsible,
    channel               = COALESCE(EXCLUDED.channel, leads.channel),
    discard_reason        = COALESCE(EXCLUDED.discard_reason, leads.discard_reason),
    first_contact_at      = COALESCE(leads.first_contact_at, EXCLUDED.first_contact_at),
    finalized_at          = EXCLUDED.finalized_at,
    updated_at            = EXCLUDED.updated_at,
    metadata              = EXCLUDED.metadata,
    synced_at             = now()
  RETURNING id INTO v_lead_id;

  INSERT INTO public.lead_events (lead_id, pipefy_card_id, from_phase, to_phase, to_phase_id, agent_id, occurred_at)
  SELECT v_lead_id, v_card_id, NULLIF(trim(payload->>'from_phase'), ''), v_to_phase, v_to_phase_id, v_agent_id, v_occurred_at
  WHERE NOT EXISTS (
    SELECT 1 FROM public.lead_events
    WHERE pipefy_card_id = v_card_id
      AND to_phase_id IS NOT DISTINCT FROM v_to_phase_id
      AND occurred_at = v_occurred_at
  );

  RETURN jsonb_build_object('lead_id', v_lead_id, 'agent_id', v_agent_id, 'duplicate', v_dup);
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_lead_event(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.ingest_lead_event(jsonb) TO service_role;

-- Adapter: recebe o NODE cru do Pipefy, traduz e delega ao ingest_lead_event.
-- Usado pelo Make (depois do Iterator: POST { "node": {{node}} }).
CREATE OR REPLACE FUNCTION public.ingest_lead_card(node jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_fields    jsonb := COALESCE(node->'fields', '[]'::jsonb);
  v_assignees jsonb := COALESCE(node->'assignees', '[]'::jsonb);
  v_ids       jsonb;
  v_resp      jsonb;
  v_discard   text;
  v_payload   jsonb;
BEGIN
  SELECT COALESCE(fe->'array_value', '[]'::jsonb) INTO v_ids
  FROM jsonb_array_elements(v_fields) fe
  WHERE fe->'field'->>'id' = 'respons_vel'
  LIMIT 1;
  v_ids := COALESCE(v_ids, '[]'::jsonb);

  IF jsonb_typeof(v_ids) = 'array' AND jsonb_array_length(v_ids) > 0 THEN
    SELECT COALESCE(jsonb_agg(
             jsonb_build_object('id', t.rid, 'name', a.name, 'email', a.email)
             ORDER BY t.ord), '[]'::jsonb)
    INTO v_resp
    FROM jsonb_array_elements_text(v_ids) WITH ORDINALITY AS t(rid, ord)
    LEFT JOIN LATERAL (
      SELECT ae->>'name' AS name, ae->>'email' AS email
      FROM jsonb_array_elements(v_assignees) ae
      WHERE ae->>'id' = t.rid
      LIMIT 1
    ) a ON true;
  ELSE
    SELECT COALESCE(jsonb_agg(
             jsonb_build_object('id', ae->>'id', 'name', ae->>'name', 'email', ae->>'email')), '[]'::jsonb)
    INTO v_resp
    FROM jsonb_array_elements(v_assignees) ae;
  END IF;

  SELECT val INTO v_discard
  FROM (
    SELECT fe->>'value' AS val, (fe->'field'->>'id') AS id
    FROM jsonb_array_elements(v_fields) fe
    WHERE fe->'field'->>'id' = 'motivo_descarte'
       OR fe->'field'->>'id' LIKE 'informe_o_motivo%'
  ) s
  WHERE COALESCE(trim(val), '') <> ''
  ORDER BY (id = 'motivo_descarte') DESC
  LIMIT 1;

  v_payload := jsonb_build_object(
    'card_id',          node->>'id',
    'title',            COALESCE(
                          (SELECT fe->>'value' FROM jsonb_array_elements(v_fields) fe WHERE fe->'field'->>'id'='nome' LIMIT 1),
                          node->>'title'),
    'to_phase',         node->'current_phase'->>'name',
    'to_phase_id',      node->'current_phase'->>'id',
    'from_phase',       NULL,
    'responsibles',     v_resp,
    'created_at',       node->>'created_at',
    'updated_at',       node->>'updated_at',
    'finalized_at',     node->>'finished_at',
    'first_contact_at', (SELECT fe->>'datetime_value' FROM jsonb_array_elements(v_fields) fe WHERE fe->'field'->>'id'='1_acionamento_hora' LIMIT 1),
    'channel',          (SELECT fe->>'value' FROM jsonb_array_elements(v_fields) fe WHERE fe->'field'->>'id'='capta_o_do_lead' LIMIT 1),
    'discard_reason',   v_discard,
    'occurred_at',      node->>'updated_at',
    'raw',              node
  );

  RETURN public.ingest_lead_event(v_payload);
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_lead_card(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.ingest_lead_card(jsonb) TO service_role;

COMMIT;

-- ============================================================================
-- Verificação rápida (rode depois, separado):
--   SELECT count(*) FROM public.lead_phases;   -- deve dar 13
--   SELECT proname FROM pg_proc WHERE proname IN ('ingest_lead_event','current_lead_agent_id');
--   SELECT table_name FROM information_schema.views WHERE table_name LIKE 'v_%lead%' OR table_name LIKE 'v_agent%';
-- ============================================================================
