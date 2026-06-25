-- ============================================================================
-- #3 — Presença em tempo real dos agentes (online/offline = está discando)
-- ============================================================================
-- O softphone faz "heartbeat" (~20s) gravando a PRÓPRIA linha com o estado do
-- discador. O dashboard deriva online de last_seen_at recente (< 60s). É estado
-- volátil (não vai em call_logs, que é histórico imutável). Idempotente.
--
-- Tabela separada (e não colunas em profiles) porque a RLS de profiles só deixa
-- admin dar UPDATE — o agente precisa escrever a própria presença.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.agent_presence (
  agent_id      uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Espelha DialerStatus do front (store/dialerStore.ts)
  dialer_status text NOT NULL DEFAULT 'idle'
                  CHECK (dialer_status IN ('idle', 'running', 'paused', 'completed')),
  -- Campanha que o agente está discando (informativo; null fora de campanha)
  campaign_id   uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

-- ── RLS: cada agente grava só a própria presença; leitura = visibilidade de profiles ──
ALTER TABLE public.agent_presence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_presence_select ON public.agent_presence;
CREATE POLICY agent_presence_select ON public.agent_presence FOR SELECT USING (
  agent_id = auth.uid()
  OR current_profile_role() IN ('manager', 'admin')
  OR (current_profile_role() = 'supervisor' AND profile_dept(agent_id) = current_profile_dept())
);

-- INSERT + UPDATE: o upsert do heartbeat só pode tocar a própria linha
DROP POLICY IF EXISTS agent_presence_insert ON public.agent_presence;
CREATE POLICY agent_presence_insert ON public.agent_presence FOR INSERT
  WITH CHECK (agent_id = auth.uid());

DROP POLICY IF EXISTS agent_presence_update ON public.agent_presence;
CREATE POLICY agent_presence_update ON public.agent_presence FOR UPDATE
  USING (agent_id = auth.uid())
  WITH CHECK (agent_id = auth.uid());
