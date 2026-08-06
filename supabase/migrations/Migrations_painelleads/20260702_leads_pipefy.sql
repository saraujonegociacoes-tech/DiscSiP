-- ============================================================================
-- Dashboard de Leads (Pipefy) — S0: fundações de dados
-- ============================================================================
-- Domínio SEPARADO do discador (ver docs/docs_dashboard_pipefy/). Cria as tabelas
-- de fato do funil de leads do Pipefy + a classificação de fase (produtiva x morta)
-- + RLS por papel. Aditivo, não-destrutivo e idempotente.
--
-- Chaves por ID DO PIPEFY (não por nome): o teste da API mostrou nomes com lixo
-- ("Esther Vitoria " com espaço) e fase com espaço ("Fechamento "). Então:
--   • lead_agents  -> chaveado por pipefy_user_id (estável); nome/email só p/ exibir e ponte
--   • lead_phases  -> chaveado por pipefy_phase_id (estável); nome é label
--
-- Fluxo de escrita: Pipefy -> Make (service_role) chama ingest_lead_event (migration
-- 20260703). O service_role BYPASSA RLS -> NÃO há política de escrita p/ o app; ele só LÊ.
--
-- Duas visões sem duplicar lógica de permissão (mesma tabela, RLS diferente):
--   • agente     -> só os leads sob sua responsabilidade (via profile_id)
--   • supervisor -> visão completa do funil (pipe único; sem recorte de depto)
--   • manager/admin -> tudo
--
-- Isolamento: lead_agents.profile_id é a PONTE de identidade com o discador,
-- nullable. Como o Pipefy já entrega o email do responsável, o backfill futuro é
-- só casar lead_agents.email = profiles.email. O CRUZAMENTO de métricas continua
-- fora de escopo — ver sprints-dashboard-leads.md.
-- ============================================================================

-- ── Classificação de fase (fonte única da regra produtiva x morta) ───────────
-- Chaveada pelo id da fase no Pipefy (à prova de renome/espaço/acento). name é label.
CREATE TABLE IF NOT EXISTS public.lead_phases (
  pipefy_phase_id text PRIMARY KEY,               -- id da fase no Pipefy (ex: '342851011')
  name            text NOT NULL,                  -- rótulo p/ exibição
  kind            text NOT NULL CHECK (kind IN ('produtiva', 'morta')),
  funnel_order    integer,                        -- ordem no funil (NULL p/ fases mortas)
  is_won          boolean NOT NULL DEFAULT false  -- marca a fase de conversão (Venda)
);

INSERT INTO public.lead_phases (pipefy_phase_id, name, kind, funnel_order, is_won) VALUES
  ('342851010', 'Recebidos',           'produtiva', 0, false),
  ('342851011', '1° Acionamento',      'produtiva', 1, false),
  ('343269928', '2° Acionamento',      'produtiva', 2, false),
  ('343269944', '3° Acionamento',      'produtiva', 3, false),
  ('343269967', '4° Acionamento',      'produtiva', 4, false),
  ('343269973', '5° Acionamento',      'produtiva', 5, false),
  ('343269982', '6° Acionamento',      'produtiva', 6, false),
  ('342851012', 'Procedimento',        'produtiva', 7, false),
  ('342851013', 'Fechamento',          'produtiva', 8, false),
  ('342851014', 'Venda',               'produtiva', 9, true),
  ('342866071', 'Quitação/Negociação', 'morta',     NULL, false),
  ('342860587', 'Empréstimo',          'morta',     NULL, false),
  ('342860537', 'Sem Finalidade',      'morta',     NULL, false)
ON CONFLICT (pipefy_phase_id) DO NOTHING;

-- ── Dimensão de agente do Pipefy (responsável = field assignee_select) ───────
-- Natural key = id do usuário no Pipefy. profile_id liga (opcionalmente) ao app.
CREATE TABLE IF NOT EXISTS public.lead_agents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipefy_user_id text NOT NULL UNIQUE,            -- id estável do usuário no Pipefy
  pipefy_name    text,                            -- nome p/ exibição (pode vir com espaço)
  email          text,                            -- do assignee; casa com profiles.email na ponte
  profile_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_agents_profile
  ON public.lead_agents (profile_id) WHERE profile_id IS NOT NULL;

-- ── Leads (estado atual de cada card) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leads (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipefy_card_id        text NOT NULL UNIQUE,          -- chave de idempotência do Make
  title                 text,                          -- identificação do lead (field 'nome' / título)
  current_phase_id      text,                          -- lookup SOFT em lead_phases (sem FK)
  current_phase         text,                          -- nome da fase p/ exibição
  responsible_agent_id  uuid REFERENCES public.lead_agents(id) ON DELETE SET NULL, -- mais recente
  duplicate_responsible boolean NOT NULL DEFAULT false, -- 2+ responsáveis simultâneos (alerta)
  channel               text,                          -- 'capta_o_do_lead' (Meta ADS etc.; ver S5)
  discard_reason        text,                          -- Motivo do Descarte (fases mortas)
  created_at            timestamptz,                   -- "Criado em" no Pipefy
  first_contact_at      timestamptz,                   -- field '1_acionamento_hora' (datetime_value)
  finalized_at          timestamptz,                   -- "finished_at" (NULL = em aberto)
  updated_at            timestamptz,                   -- "updated_at" (p/ detectar lead parado)
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb, -- payload bruto do Pipefy
  synced_at             timestamptz NOT NULL DEFAULT now()  -- última gravação do Make
);

CREATE INDEX IF NOT EXISTS idx_leads_agent   ON public.leads (responsible_agent_id);
CREATE INDEX IF NOT EXISTS idx_leads_phase   ON public.leads (current_phase_id);
CREATE INDEX IF NOT EXISTS idx_leads_created ON public.leads (created_at);
CREATE INDEX IF NOT EXISTS idx_leads_open    ON public.leads (finalized_at) WHERE finalized_at IS NULL;

-- ── Eventos de lead (log de transições de fase) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.lead_events (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id        uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  pipefy_card_id text NOT NULL,                          -- denormalizado (conveniência do Make)
  from_phase     text,                                   -- nome (exibição)
  to_phase       text,                                   -- nome (exibição)
  to_phase_id    text,                                   -- lookup SOFT em lead_phases (classificação/funil)
  agent_id       uuid REFERENCES public.lead_agents(id) ON DELETE SET NULL, -- responsável no momento
  occurred_at    timestamptz NOT NULL,                   -- quando a movimentação ocorreu
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_events_lead     ON public.lead_events (lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_events_occurred ON public.lead_events (occurred_at);
CREATE INDEX IF NOT EXISTS idx_lead_events_agent    ON public.lead_events (agent_id);

-- ── Helper: qual lead_agent está ligado ao usuário logado ────────────────────
-- SECURITY DEFINER bypassa RLS de lead_agents (evita recursão de política).
-- Retorna NULL se o usuário não tem mapeamento -> self-view fica fail-closed.
CREATE OR REPLACE FUNCTION public.current_lead_agent_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.lead_agents WHERE profile_id = auth.uid();
$$;

-- ============================================================================
-- RLS — só leitura para o app; escrita é exclusiva do service_role (Make), que
-- bypassa RLS. Papéis: agent (o seu), supervisor/manager/admin (visão completa).
-- ============================================================================

-- ── lead_phases (lookup público a autenticados) ──────────────────────────────
ALTER TABLE public.lead_phases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_phases_select ON public.lead_phases;
CREATE POLICY lead_phases_select ON public.lead_phases FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ── lead_agents (dimensão; leitura a autenticados p/ joins das views) ────────
ALTER TABLE public.lead_agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_agents_select ON public.lead_agents;
CREATE POLICY lead_agents_select ON public.lead_agents FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ── leads ────────────────────────────────────────────────────────────────────
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leads_select ON public.leads;
CREATE POLICY leads_select ON public.leads FOR SELECT USING (
  current_profile_role() IN ('supervisor', 'manager', 'admin')
  OR responsible_agent_id = current_lead_agent_id()
);
-- Sem política de escrita: usuários do app não gravam; o Make usa service_role.

-- ── lead_events ──────────────────────────────────────────────────────────────
ALTER TABLE public.lead_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_events_select ON public.lead_events;
CREATE POLICY lead_events_select ON public.lead_events FOR SELECT USING (
  current_profile_role() IN ('supervisor', 'manager', 'admin')
  OR agent_id = current_lead_agent_id()
);
