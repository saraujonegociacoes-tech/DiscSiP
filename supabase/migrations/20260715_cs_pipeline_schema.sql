-- ============================================================================
-- Painel de Sucesso do Cliente (CS) — schema + ingestão (Sprint 1)
-- ============================================================================
-- Domínio SEPARADO do dashboard de Leads (comercial): tabelas, RPCs e RLS
-- próprios, espelhando o padrão de `leads`/`lead_events`/`lead_phases`/
-- `lead_agents` (supabase/manual/leads_dashboard_setup.sql), mas isolados —
-- nenhuma tabela/RPC daqui é compartilhada com o comercial. Decisão registrada
-- em docs/updates/painel-sucesso-cliente-cs.md: réplica isolada por vertical,
-- não schema genérico multi-pipe (Make já é 1 cenário por pipe; um RPC
-- genérico só moveria a complexidade de lugar e arriscaria o comercial em
-- produção toda vez que se mexe em CS).
--
-- Pipe Pipefy: "3.3 - Customer Success" (id 305801110). Fases seedadas abaixo
-- vêm de introspecção ao vivo (dono rodou a query e colou o resultado) — 35
-- fases: Triagem → Apresentação → Negociação do Cliente → 24 fases mensais
-- (1° a 24° Mês, acompanhamento pós-negociação) → saídas (Quitados, Concluído,
-- Distratos, Acordos Vencidos, Arquivado, Falta de Contato, Distribuição
-- Processual, Pendente envio de carta de quitação).
--
-- Decisão do dono: ingerir TODOS os campos do card em `cs_cards.metadata`
-- (inclui CPF/RG/endereço/telefone/dados financeiros do cliente — é uma
-- esteira de negociação de dívida). Por isso o RLS de leitura de `cs_cards`/
-- `cs_card_events` é mais estrito que o de `cs_phases`/`cs_agents`: só quem é
-- do departamento de CS (ou manager/admin) enxerga qualquer linha.
--
-- Classificação de fase (produtiva/morta/ganha) fica pra Sprint 2 (dashboard)
-- — não é necessária pra esta camada de ingestão.
-- ============================================================================

-- ── Tabelas ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.cs_phases (
  id text PRIMARY KEY,               -- id da fase no Pipefy
  name text NOT NULL,
  funnel_order integer NOT NULL,     -- ordem sequencial (derivada do `index` do Pipefy)
  pipefy_index numeric NOT NULL,     -- `index` cru do Pipefy, guardado pra re-sync futuro
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cs_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipefy_user_id text UNIQUE NOT NULL,
  pipefy_name text,
  email text,
  profile_id uuid REFERENCES public.profiles(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cs_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipefy_card_id text UNIQUE NOT NULL,
  title text,
  current_phase_id text REFERENCES public.cs_phases(id),
  current_phase text,                          -- nome da fase, denormalizado (mesmo padrão de `leads.current_phase`)
  responsible_agent_id uuid REFERENCES public.cs_agents(id),
  duplicate_responsible boolean NOT NULL DEFAULT false,  -- card com 2+ assignees (mesma assunção do leads: "mais recente" = último elemento — a confirmar)
  pipefy_created_at timestamptz,
  pipefy_finished_at timestamptz,
  pipefy_done boolean,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,  -- TODOS os campos do card, por field-id (decisão do dono)
  synced_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.cs_card_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cs_card_id uuid NOT NULL REFERENCES public.cs_cards(id) ON DELETE CASCADE,
  pipefy_card_id text NOT NULL,
  from_phase text,
  to_phase text,
  to_phase_id text,
  agent_id uuid REFERENCES public.cs_agents(id),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Dedup de evento (mesma convenção do lead_events): reprocessar no overlap do
-- poll não duplica.
CREATE UNIQUE INDEX IF NOT EXISTS cs_card_events_dedup_idx
  ON public.cs_card_events (pipefy_card_id, to_phase_id, occurred_at);

CREATE INDEX IF NOT EXISTS cs_cards_responsible_idx ON public.cs_cards (responsible_agent_id);
CREATE INDEX IF NOT EXISTS cs_cards_phase_idx ON public.cs_cards (current_phase_id);
CREATE INDEX IF NOT EXISTS cs_card_events_card_idx ON public.cs_card_events (cs_card_id);

-- ── Seed das fases (introspecção ao vivo do pipe 305801110, 15/jul) ─────────
INSERT INTO public.cs_phases (id, name, funnel_order, pipefy_index) VALUES
  ('334667295', 'Triagem', 0, 0.296875),
  ('334667292', 'Apresentação', 1, 0.3125),
  ('336929552', 'Negociação do Cliente', 2, 0.34375),
  ('337169861', '1° Mês', 3, 1.8125),
  ('337600814', '2° Mês', 4, 2.8125),
  ('337601448', '3° Mês', 5, 3.359375),
  ('337602123', '4° Mês', 6, 3.6328125),
  ('337604722', '5° Mês', 7, 3.76953125),
  ('337605356', '6° Mês', 8, 3.837890625),
  ('337921158', '7° Mês', 9, 3.8720703125),
  ('337950049', '8° Mês', 10, 3.88916015625),
  ('337950050', '9° Mês', 11, 3.897705078125),
  ('337950053', '10° Mês', 12, 3.9019775390625),
  ('337950054', '11° Mês', 13, 3.90411376953125),
  ('337950075', '12° Mês', 14, 3.905181884765625),
  ('337950081', '13° Mês', 15, 3.905982971191406),
  ('337950082', '14° Mês', 16, 3.906116485595703),
  ('337950088', '15° Mês', 17, 3.906183242797852),
  ('337950093', '16° Mês', 18, 3.906216621398926),
  ('337950094', '17° Mês', 19, 3.906233310699463),
  ('338353782', '18° Mês', 20, 3.906237483024597),
  ('337950133', '19° Mês', 21, 3.906241655349731),
  ('337950137', '20° Mês', 22, 3.906245827674866),
  ('337950144', '21° Mês', 23, 3.906247913837433),
  ('338348199', '22° Mês', 24, 3.906248956918716),
  ('338348498', '23° Mês', 25, 3.906249478459358),
  ('338348813', '24° Mês', 26, 3.906249739229679),
  ('340634023', 'Acordos Vencidos', 27, 3.90624986961484),
  ('337186300', 'Quitados', 28, 3.90625),
  ('338460922', 'Distratos', 29, 3.9296875),
  ('338563627', 'Distribuição Processual', 30, 3.94140625),
  ('341679391', 'Pendente envio de carta de quitação', 31, 3.947265625),
  ('337186801', 'Falta de contato', 32, 3.953125),
  ('334667293', 'Concluído', 33, 4),
  ('334667294', 'Arquivado', 34, 5)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  funnel_order = EXCLUDED.funnel_order,
  pipefy_index = EXCLUDED.pipefy_index;

-- ── Helpers de RLS (namespace `cs_` pra não colidir com o que já existe pro
-- leads — não temos o SQL delas aqui pra conferir, `supabase/` não é mais
-- versionado) ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cs_current_role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT role::text FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.cs_current_department_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT department_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.cs_department_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT id FROM public.departments WHERE slug = 'cs' LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.cs_current_agent_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT id FROM public.cs_agents WHERE profile_id = auth.uid() LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.cs_agent_department_id(p_agent_id uuid) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT p.department_id
  FROM public.cs_agents a
  JOIN public.profiles p ON p.id = a.profile_id
  WHERE a.id = p_agent_id
$$;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Escopo do domínio inteiro (fases/agentes/cards/eventos): manager/admin veem
-- tudo; quem é do departamento de CS vê tudo do CS; qualquer outro
-- (comercial, negociação, sem departamento) não vê NADA daqui — "só quem é do
-- CS poderia ter acesso" (decisão do dono). Dentro do CS, agente vê só os
-- próprios cards; supervisor vê o próprio departamento (mesma filosofia do
-- leads: agente=o seu, supervisor=seu depto, manager/admin=tudo).

ALTER TABLE public.cs_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cs_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cs_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cs_card_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cs_phases_select ON public.cs_phases;
CREATE POLICY cs_phases_select ON public.cs_phases FOR SELECT TO authenticated USING (
  public.cs_current_role() IN ('manager', 'admin')
  OR public.cs_current_department_id() = public.cs_department_id()
);

DROP POLICY IF EXISTS cs_agents_select ON public.cs_agents;
CREATE POLICY cs_agents_select ON public.cs_agents FOR SELECT TO authenticated USING (
  public.cs_current_role() IN ('manager', 'admin')
  OR public.cs_current_department_id() = public.cs_department_id()
);

DROP POLICY IF EXISTS cs_cards_select ON public.cs_cards;
CREATE POLICY cs_cards_select ON public.cs_cards FOR SELECT TO authenticated USING (
  public.cs_current_role() IN ('manager', 'admin')
  OR responsible_agent_id = public.cs_current_agent_id()
  OR (
    public.cs_current_role() = 'supervisor'
    AND public.cs_current_department_id() = public.cs_department_id()
    AND (responsible_agent_id IS NULL OR public.cs_agent_department_id(responsible_agent_id) = public.cs_current_department_id())
  )
);

DROP POLICY IF EXISTS cs_card_events_select ON public.cs_card_events;
CREATE POLICY cs_card_events_select ON public.cs_card_events FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.cs_cards c
    WHERE c.id = cs_card_events.cs_card_id
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

-- Nenhuma policy de INSERT/UPDATE/DELETE pra authenticated — a escrita é só
-- via RPC SECURITY DEFINER abaixo, executável só pelo service_role (Make/
-- backfill). Mesmo padrão do leads: "o front só lê".

-- ── Ingestão ────────────────────────────────────────────────────────────────

-- Registra uma transição de fase (dedup por pipefy_card_id+to_phase_id+occurred_at).
CREATE OR REPLACE FUNCTION public.ingest_cs_event(payload jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.cs_card_events (cs_card_id, pipefy_card_id, from_phase, to_phase, to_phase_id, agent_id, occurred_at)
  VALUES (
    (payload->>'cs_card_id')::uuid,
    payload->>'pipefy_card_id',
    payload->>'from_phase',
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

-- Recebe o node CRU do Pipefy (Make e o backfill mandam o mesmo formato — ver
-- scripts/import-cs-cards.mjs e docs/docs_dashboard_cs/). Faz upsert de
-- assignees, upsert do card (metadata = TODOS os campos, por field-id) e
-- registra evento de troca de fase quando detecta mudança.
--
-- Responsável = último elemento de `assignees` quando há 2+ (mesma assunção
-- do leads — "mais recente" = último; a confirmar). 0 assignees → sem
-- responsável (fica visível só pra supervisor/manager/admin do CS).
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
  v_assignees jsonb := COALESCE(node->'assignees', '[]'::jsonb);
  v_assignee_count int := jsonb_array_length(v_assignees);
  v_agent_id uuid;
  v_duplicate boolean := v_assignee_count > 1;
  v_metadata jsonb;
  v_cs_card_id uuid;
  v_from_phase text;
  v_from_phase_id text;
BEGIN
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

  SELECT current_phase, current_phase_id INTO v_from_phase, v_from_phase_id
  FROM public.cs_cards WHERE pipefy_card_id = v_pipefy_card_id;

  INSERT INTO public.cs_cards (
    pipefy_card_id, title, current_phase_id, current_phase, responsible_agent_id,
    duplicate_responsible, pipefy_created_at, pipefy_finished_at, pipefy_done,
    metadata, synced_at, updated_at
  ) VALUES (
    v_pipefy_card_id, v_title, v_phase_id, v_phase_name, v_agent_id,
    v_duplicate, v_created_at, v_finished_at, v_done,
    COALESCE(v_metadata, '{}'::jsonb), now(), v_updated_at
  )
  ON CONFLICT (pipefy_card_id) DO UPDATE SET
    title = EXCLUDED.title,
    current_phase_id = EXCLUDED.current_phase_id,
    current_phase = EXCLUDED.current_phase,
    responsible_agent_id = EXCLUDED.responsible_agent_id,
    duplicate_responsible = EXCLUDED.duplicate_responsible,
    pipefy_finished_at = EXCLUDED.pipefy_finished_at,
    pipefy_done = EXCLUDED.pipefy_done,
    metadata = EXCLUDED.metadata,
    synced_at = now(),
    updated_at = EXCLUDED.updated_at
  RETURNING id INTO v_cs_card_id;

  -- Poll não sabe o instante exato da troca; occurred_at = updated_at do card
  -- (mesma convenção do leads). Compara por ID (estável), não por nome — um
  -- reboot de nome de fase no Pipefy não deve virar uma transição falsa. Só
  -- grava evento quando a fase realmente muda.
  IF v_from_phase_id IS DISTINCT FROM v_phase_id THEN
    PERFORM public.ingest_cs_event(jsonb_build_object(
      'cs_card_id', v_cs_card_id,
      'pipefy_card_id', v_pipefy_card_id,
      'from_phase', v_from_phase,
      'to_phase', v_phase_name,
      'to_phase_id', v_phase_id,
      'agent_id', v_agent_id,
      'occurred_at', v_updated_at
    ));
  END IF;

  RETURN jsonb_build_object('cs_card_id', v_cs_card_id, 'agent_id', v_agent_id, 'duplicate', v_duplicate);
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_cs_card(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_cs_card(jsonb) TO service_role;

-- ── Conferir depois de aplicar ──────────────────────────────────────────────
-- SELECT count(*) FROM public.cs_phases;  -- esperado: 35
-- SELECT id, name, funnel_order FROM public.cs_phases ORDER BY funnel_order LIMIT 5;
