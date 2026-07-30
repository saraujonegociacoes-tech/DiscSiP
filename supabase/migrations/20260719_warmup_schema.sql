-- ============================================================================
-- Aquecimento de números WhatsApp — schema + RLS
-- ============================================================================
-- Domínio SEPARADO (espelha o padrão de isolamento de CS/Leads: tabelas, RLS e
-- helpers próprios, prefixo `warmup_`, nada compartilhado com os outros
-- domínios). Objetivo: até 6 números WhatsApp da mesma BM (várias WABAs)
-- conversam entre si automaticamente para construir reputação/quality rating
-- antes de entrarem em campanhas de disparo real.
--
-- Plano de controle vs. braço executor: o Blue Line decide QUEM fala com QUEM,
-- QUANDO e O QUÊ (template de abertura vs. texto livre de sessão), registra o
-- histórico e dispara o Make por webhook. O envio real à Graph API da Meta
-- acontece no Make. Ver docs do módulo e o plano em .claude/plans.
--
-- Regra central da janela de 24h (implementada na orquestração em TS, mas a
-- fonte de verdade é a tabela warmup_messages): X pode enviar TEXTO LIVRE para Y
-- se e só se existe uma mensagem de Y→X nas últimas 24h. A janela de atendimento
-- do WhatsApp abre no número que RECEBEU. Como os dois lados são controlados
-- pelo Blue Line, o próprio histórico de envios basta — não é preciso webhook de
-- entrega/leitura da Meta para saber se a janela está aberta.
--
-- Escrita: as tabelas de CONFIGURAÇÃO (warmup_numbers, warmup_settings,
-- warmup_templates) são editadas por manager/admin via Server Action (sessão do
-- usuário) — têm policies de INSERT/UPDATE/DELETE. As tabelas de EXECUÇÃO
-- (warmup_conversations, warmup_messages) são escritas SÓ pelo tick e pelo
-- callback do Make, que usam o service_role (bypassa RLS) — para authenticated
-- elas são somente leitura (mesma filosofia "o front só lê" do CS/Leads).
-- ============================================================================

-- ── Tabelas ─────────────────────────────────────────────────────────────────

-- Pool de números do aquecimento (até max_numbers_cap). `sender_id` é o
-- phone_number_id da Meta (usado no path da Graph API pelo Make); `phone_number`
-- é o E.164 usado como `to` quando este número é o destinatário.
CREATE TABLE IF NOT EXISTS public.warmup_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id text UNIQUE NOT NULL,
  phone_number text NOT NULL,
  display_name text,
  waba_id text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'blocked', 'cooling')),
  participating boolean NOT NULL DEFAULT true,
  added_at timestamptz NOT NULL DEFAULT now(),   -- início da contagem de "dias aquecendo"
  quality_rating text CHECK (quality_rating IN ('GREEN', 'YELLOW', 'RED')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Configuração do módulo em key/value (fácil de estender sem migration nova).
CREATE TABLE IF NOT EXISTS public.warmup_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Rampa de volume por "dias aquecendo" (análoga ao Tier de mensagens da Meta).
CREATE TABLE IF NOT EXISTS public.warmup_ramp_stages (
  id serial PRIMARY KEY,
  day_from int NOT NULL,
  day_to int,                                    -- NULL = faixa sem limite superior
  daily_message_cap int NOT NULL,
  new_conversations_per_day_cap int NOT NULL
);

-- Catálogo único: templates aprovados (abrem conversa) e frases livres de sessão.
CREATE TABLE IF NOT EXISTS public.warmup_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('template', 'session_snippet')),
  meta_template_name text,                       -- obrigatório p/ kind='template' (o Make precisa)
  meta_template_language text,
  body text NOT NULL,                            -- corpo do snippet, ou preview do template
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Thread/instância de conversa entre um par de números (par normalizado).
CREATE TABLE IF NOT EXISTS public.warmup_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number_a_id uuid NOT NULL REFERENCES public.warmup_numbers(id) ON DELETE CASCADE,
  number_b_id uuid NOT NULL REFERENCES public.warmup_numbers(id) ON DELETE CASCADE,
  opener_number_id uuid NOT NULL REFERENCES public.warmup_numbers(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_sender_id uuid REFERENCES public.warmup_numbers(id),  -- controla de quem é o turno
  message_count int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'idle', 'closed')),
  CHECK (number_a_id <> number_b_id),
  CHECK (number_a_id < number_b_id)              -- normaliza o par (menor uuid primeiro)
);

-- No máximo UMA conversa ativa por par ao mesmo tempo (evita duas threads
-- concorrentes). O par pode ter várias conversas históricas já encerradas/idle:
-- cada reabertura após 24h de silêncio é uma thread nova, aberta com template.
CREATE UNIQUE INDEX IF NOT EXISTS warmup_conversations_active_pair_idx
  ON public.warmup_conversations (number_a_id, number_b_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS warmup_conversations_pair_idx
  ON public.warmup_conversations (number_a_id, number_b_id);
CREATE INDEX IF NOT EXISTS warmup_conversations_status_idx
  ON public.warmup_conversations (status, last_message_at);

-- Histórico de envios — fonte de verdade da janela de 24h.
CREATE TABLE IF NOT EXISTS public.warmup_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES public.warmup_conversations(id) ON DELETE SET NULL,
  from_number_id uuid NOT NULL REFERENCES public.warmup_numbers(id),
  to_number_id uuid NOT NULL REFERENCES public.warmup_numbers(id),
  message_type text NOT NULL CHECK (message_type IN ('template', 'session')),
  template_id uuid REFERENCES public.warmup_templates(id),
  content text,
  dispatch_mode text NOT NULL DEFAULT 'live' CHECK (dispatch_mode IN ('live', 'dry_run')),
  make_dispatch_ok boolean,                      -- resultado do callback do Make (null enquanto pendente/dry_run)
  graph_message_id text,                         -- id da mensagem retornado pela Graph API (via callback)
  error_detail text,                             -- detalhe do erro da Meta (via callback), quando falha
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS warmup_messages_window_idx
  ON public.warmup_messages (from_number_id, to_number_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS warmup_messages_sender_day_idx
  ON public.warmup_messages (from_number_id, sent_at);

-- ── Seeds ───────────────────────────────────────────────────────────────────

-- dry_run começa TRUE: o tick roda a mecânica inteira e grava histórico
-- simulado, mas nunca chama o Make. O dono liga o modo real depois de revisar.
INSERT INTO public.warmup_settings (key, value) VALUES
  ('qntd_numbers', '6'::jsonb),
  ('max_numbers_cap', '6'::jsonb),
  ('dry_run', 'true'::jsonb),
  ('tick_max_sends', '3'::jsonb),
  ('min_gap_minutes', '4'::jsonb),
  ('max_gap_minutes', '25'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.warmup_ramp_stages (day_from, day_to, daily_message_cap, new_conversations_per_day_cap) VALUES
  (0, 2, 6, 2),
  (3, 6, 14, 3),
  (7, 13, 24, 4),
  (14, NULL, 40, 6)
ON CONFLICT DO NOTHING;

-- ── Helpers de RLS (namespace `warmup_` para manter o módulo extraível) ──────

CREATE OR REPLACE FUNCTION public.warmup_current_role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT role::text FROM public.profiles WHERE id = auth.uid()
$$;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Módulo sensível (risco de bloqueio de conta/BM na Meta): só manager/admin
-- enxergam e configuram. Nenhum acesso para agente/supervisor.

ALTER TABLE public.warmup_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warmup_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warmup_ramp_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warmup_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warmup_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warmup_messages ENABLE ROW LEVEL SECURITY;

-- Tabelas de CONFIGURAÇÃO: manager/admin têm CRUD completo (via Server Action
-- com sessão do usuário).
DROP POLICY IF EXISTS warmup_numbers_all ON public.warmup_numbers;
CREATE POLICY warmup_numbers_all ON public.warmup_numbers FOR ALL TO authenticated
  USING (public.warmup_current_role() IN ('manager', 'admin'))
  WITH CHECK (public.warmup_current_role() IN ('manager', 'admin'));

DROP POLICY IF EXISTS warmup_settings_all ON public.warmup_settings;
CREATE POLICY warmup_settings_all ON public.warmup_settings FOR ALL TO authenticated
  USING (public.warmup_current_role() IN ('manager', 'admin'))
  WITH CHECK (public.warmup_current_role() IN ('manager', 'admin'));

DROP POLICY IF EXISTS warmup_templates_all ON public.warmup_templates;
CREATE POLICY warmup_templates_all ON public.warmup_templates FOR ALL TO authenticated
  USING (public.warmup_current_role() IN ('manager', 'admin'))
  WITH CHECK (public.warmup_current_role() IN ('manager', 'admin'));

-- warmup_ramp_stages é lookup de configuração raramente alterado; leitura para
-- manager/admin, escrita fica por conta de migration/service_role.
DROP POLICY IF EXISTS warmup_ramp_stages_select ON public.warmup_ramp_stages;
CREATE POLICY warmup_ramp_stages_select ON public.warmup_ramp_stages FOR SELECT TO authenticated
  USING (public.warmup_current_role() IN ('manager', 'admin'));

-- Tabelas de EXECUÇÃO: somente leitura para manager/admin. A escrita é
-- exclusiva do tick/callback via service_role (bypassa RLS) — não há policy de
-- INSERT/UPDATE/DELETE para authenticated de propósito.
DROP POLICY IF EXISTS warmup_conversations_select ON public.warmup_conversations;
CREATE POLICY warmup_conversations_select ON public.warmup_conversations FOR SELECT TO authenticated
  USING (public.warmup_current_role() IN ('manager', 'admin'));

DROP POLICY IF EXISTS warmup_messages_select ON public.warmup_messages;
CREATE POLICY warmup_messages_select ON public.warmup_messages FOR SELECT TO authenticated
  USING (public.warmup_current_role() IN ('manager', 'admin'));

-- ── Conferir depois de aplicar ──────────────────────────────────────────────
-- SELECT key, value FROM public.warmup_settings ORDER BY key;             -- 6 linhas
-- SELECT day_from, day_to, daily_message_cap FROM public.warmup_ramp_stages ORDER BY day_from;  -- 4 faixas
