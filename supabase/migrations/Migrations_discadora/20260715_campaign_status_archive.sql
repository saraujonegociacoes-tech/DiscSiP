-- ============================================================================
-- Status de campanha calculado + arquivamento
-- ============================================================================
-- Problema: campaigns.status era escrito só na criação (default do banco = 'draft')
-- e nunca mais atualizado — updateCampaignStatus() existia mas não tinha nenhum
-- chamador. Resultado: toda campanha ficava presa em "Rascunho" para sempre, mesmo
-- já configurada e discando de verdade.
--
-- Fix: o status deixa de ser um campo setado manualmente e passa a ser CALCULADO a
-- partir do estado real da campanha (tem agente? tem contato? está dentro do
-- horário? já esgotou a fila?) — mesma regra que já existia em JS só pra travar a
-- discagem (isWithinSchedule, DialerTab.tsx). A coluna campaigns.status crua NÃO é
-- removida (evita mudança destrutiva); só deixa de ser lida pelo app.
--
-- Junto: arquivamento (soft-hide reversível, distinto da exclusão definitiva que já
-- existe). campaigns.archived_at NULL = ativa; preenchida = arquivada.
--
-- security_invoker = true nas views: rodam com o RLS do usuário logado, mesmo
-- padrão de 20260706_dashboard_aggregations.sql.
-- ============================================================================

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;

-- ── Status calculado ───────────────────────────────────────────────────────────
-- draft     = sem agente vinculado OU sem nenhum contato carregado (não está pronta)
-- completed = tem contato, e a fila esgotou (pending = 0 e dialing = 0)
-- paused    = pronta, mas fora da janela schedule_start/schedule_end agora
-- active    = pronta e dentro da janela (ou sem restrição de horário)
-- Trata janela que vira a noite (ex.: 22:00 → 06:00), igual a isWithinSchedule em
-- src/app/softphone/DialerTab.tsx.
CREATE OR REPLACE FUNCTION public.campaign_computed_status(
  p_schedule_start time,
  p_schedule_end time,
  p_agent_count bigint,
  p_total bigint,
  p_pending bigint,
  p_dialing bigint
) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_agent_count = 0 OR p_total = 0 THEN 'draft'
    WHEN p_pending = 0 AND p_dialing = 0 THEN 'completed'
    WHEN p_schedule_start IS NULL OR p_schedule_end IS NULL THEN 'active'
    WHEN p_schedule_start <= p_schedule_end THEN
      CASE WHEN (now() AT TIME ZONE 'America/Sao_Paulo')::time
                 BETWEEN p_schedule_start AND p_schedule_end
           THEN 'active' ELSE 'paused' END
    ELSE
      CASE WHEN (now() AT TIME ZONE 'America/Sao_Paulo')::time >= p_schedule_start
             OR (now() AT TIME ZONE 'America/Sao_Paulo')::time <= p_schedule_end
           THEN 'active' ELSE 'paused' END
  END
$$;

-- ── Tabela de campanhas do dashboard (getCampaignsSummary) ────────────────────
-- Mesmo contrato de saída de 20260706_dashboard_aggregations.sql (id, name, status,
-- total, pending, answered, contacted); só o cálculo de status muda, e campanhas
-- arquivadas somem do painel "ao vivo" do supervisor.
CREATE OR REPLACE VIEW public.v_campaign_summary
WITH (security_invoker = true) AS
SELECT
  c.id,
  c.name,
  public.campaign_computed_status(
    c.schedule_start, c.schedule_end,
    COALESCE(ca.agent_count, 0),
    COALESCE(vcsc.total, 0),
    COALESCE(vcsc.pending, 0),
    COALESCE(vcsc.dialing, 0)
  ) AS status,
  COALESCE(vcsc.total, 0)    AS total,
  COALESCE(vcsc.pending, 0)  AS pending,
  COALESCE(vcsc.answered, 0) AS answered,
  COALESCE(vcsc.answered, 0) + COALESCE(vcsc.no_answer, 0) + COALESCE(vcsc.busy, 0)
    + COALESCE(vcsc.failed, 0) + COALESCE(vcsc.do_not_call, 0) AS contacted
FROM public.campaigns c
LEFT JOIN public.v_campaign_status_counts vcsc ON vcsc.campaign_id = c.id
LEFT JOIN LATERAL (
  SELECT count(DISTINCT agent_id) AS agent_count
  FROM public.campaign_agents WHERE campaign_id = c.id
) ca ON true
WHERE c.archived_at IS NULL
ORDER BY c.created_at DESC;

-- ── Campanhas com status calculado (getCampaigns / getCampaignsForAgent) ──────
-- Mesmo formato da tabela campaigns (select * anterior), com status calculado no
-- lugar da coluna crua e archived_at exposto pro toggle Ativas/Arquivadas da UI.
CREATE OR REPLACE VIEW public.v_campaigns
WITH (security_invoker = true) AS
SELECT
  c.id,
  c.name,
  public.campaign_computed_status(
    c.schedule_start, c.schedule_end,
    COALESCE(ca.agent_count, 0),
    COALESCE(vcsc.total, 0),
    COALESCE(vcsc.pending, 0),
    COALESCE(vcsc.dialing, 0)
  ) AS status,
  c.department_id,
  c.schedule_start,
  c.schedule_end,
  c.visible_fields,
  c.notify_dispositions,
  c.parallel_lines,
  c.archived_at,
  c.created_at,
  c.updated_at
FROM public.campaigns c
LEFT JOIN public.v_campaign_status_counts vcsc ON vcsc.campaign_id = c.id
LEFT JOIN LATERAL (
  SELECT count(DISTINCT agent_id) AS agent_count
  FROM public.campaign_agents WHERE campaign_id = c.id
) ca ON true;
