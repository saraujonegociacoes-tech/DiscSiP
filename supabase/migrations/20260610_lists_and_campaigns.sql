-- ============================================================================
-- Sprint 6.3a — Listas e Campanhas configuráveis
-- ============================================================================
-- Rode este script no Supabase (SQL Editor). É idempotente: pode rodar de novo
-- sem quebrar (usa IF NOT EXISTS / DROP IF EXISTS).
--
-- Resumo:
--   • campaigns        → horário de funcionamento + campos visíveis ao agente
--   • campaign_agents  → quais agentes participam de cada campanha (N:N)
--   • lists            → mailing carregado dentro de uma campanha + reciclagem
--   • campaign_contacts→ vínculo com a lista, dados extras e contador de tentativas
--   • ContactStatus    → novo valor 'exhausted' (esgotou a reciclagem)
-- ============================================================================

-- ── 1. campaigns: horário de funcionamento e campos visíveis ────────────────
-- schedule_start / schedule_end: horário do dia (NULL = sem restrição de horário)
-- visible_fields: chaves de campos que o agente vê na discagem
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS schedule_start time,
  ADD COLUMN IF NOT EXISTS schedule_end   time,
  ADD COLUMN IF NOT EXISTS visible_fields jsonb NOT NULL DEFAULT '["name", "phone_number"]'::jsonb;

-- ── 2. campaign_agents: quem participa da campanha ──────────────────────────
CREATE TABLE IF NOT EXISTS public.campaign_agents (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  agent_id    uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_agents_pkey PRIMARY KEY (id),
  CONSTRAINT campaign_agents_campaign_id_fkey FOREIGN KEY (campaign_id)
    REFERENCES public.campaigns(id) ON DELETE CASCADE,
  CONSTRAINT campaign_agents_agent_id_fkey FOREIGN KEY (agent_id)
    REFERENCES public.agents(id) ON DELETE CASCADE,
  CONSTRAINT campaign_agents_unique UNIQUE (campaign_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_agents_agent ON public.campaign_agents (agent_id);

-- ── 3. lists: mailing dentro de uma campanha + regras de reciclagem ──────────
-- column_mapping (jsonb), formato:
--   {
--     "name":  "Nome",        -- cabeçalho da coluna usada como nome
--     "phone": "Telefone",    -- cabeçalho da coluna usada como telefone
--     "extras": [             -- demais colunas viram campos nomeados em extra_data
--       { "key": "info_adicional", "label": "Informação Adicional", "column": "Info" }
--     ]
--   }
-- recycle_statuses (jsonb): lista de status que voltam à fila, ex: ["no_answer","busy"]
CREATE TABLE IF NOT EXISTS public.lists (
  id                   uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id          uuid NOT NULL,
  name                 text NOT NULL,
  column_mapping       jsonb   NOT NULL DEFAULT '{}'::jsonb,
  recycle_enabled      boolean NOT NULL DEFAULT false,
  recycle_statuses     jsonb   NOT NULL DEFAULT '[]'::jsonb,
  recycle_after_hours  integer NOT NULL DEFAULT 24,
  recycle_max_attempts integer NOT NULL DEFAULT 3,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lists_pkey PRIMARY KEY (id),
  CONSTRAINT lists_campaign_id_fkey FOREIGN KEY (campaign_id)
    REFERENCES public.campaigns(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lists_campaign ON public.lists (campaign_id);

-- ── 4. campaign_contacts: vínculo com lista, dados extras e tentativas ──────
ALTER TABLE public.campaign_contacts
  ADD COLUMN IF NOT EXISTS list_id    uuid,
  ADD COLUMN IF NOT EXISTS extra_data jsonb   NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS attempts   integer NOT NULL DEFAULT 0;

ALTER TABLE public.campaign_contacts DROP CONSTRAINT IF EXISTS campaign_contacts_list_id_fkey;
ALTER TABLE public.campaign_contacts
  ADD CONSTRAINT campaign_contacts_list_id_fkey FOREIGN KEY (list_id)
    REFERENCES public.lists(id) ON DELETE SET NULL;

-- novo status 'exhausted' — recria a CHECK constraint incluindo o valor
ALTER TABLE public.campaign_contacts DROP CONSTRAINT IF EXISTS campaign_contacts_status_check;
ALTER TABLE public.campaign_contacts
  ADD CONSTRAINT campaign_contacts_status_check CHECK (
    status = ANY (ARRAY[
      'pending'::text, 'dialing'::text, 'answered'::text, 'no_answer'::text,
      'busy'::text, 'failed'::text, 'do_not_call'::text, 'exhausted'::text
    ])
  );

-- índices usados pela busca de próximo contato e pela reciclagem
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_campaign_status
  ON public.campaign_contacts (campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_list
  ON public.campaign_contacts (list_id);
