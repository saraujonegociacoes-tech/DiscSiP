-- ============================================================================
-- Correção do Cloudflare Error 1102 (estouro de CPU) — agregações do dashboard
-- ============================================================================
-- Ver docs/fixes/correcao-cpu-cloudflare-1102.md.
--
-- Antes, as Server Actions do dashboard/softphone puxavam tabelas INTEIRAS
-- (campaign_contacts, call_logs) e agregavam em JavaScript dentro do Worker.
-- Na Cloudflare (Pages Free, ~10ms de CPU/invocação) isso desserializa um JSON
-- grande + roda loops O(n) / O(campanhas × contatos) → estoura o limite de CPU.
--
-- Aqui a métrica é calculada UMA vez no Postgres (indexado) e o front só lê o
-- resultado pronto — mesmo padrão das views de leads (20260702_leads_pipefy_views).
--
-- security_invoker = true: a view roda com o RLS do usuário logado (não bypassa
-- segurança). Idempotente (CREATE OR REPLACE). Sem GRANT explícito — o Supabase
-- concede SELECT a `authenticated` por default em objetos novos de `public`
-- (idêntico às views de leads, que funcionam sem grant).
-- ============================================================================

-- Início do dia no fuso de Brasília, como instante UTC (timestamptz). Equivale a
-- brtTodayStartUtcISO() de src/lib/timezone.ts — mantém a mesma fronteira de "hoje".
CREATE OR REPLACE FUNCTION public.brt_today_start() RETURNS timestamptz
LANGUAGE sql STABLE AS $$
  SELECT date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
$$;

-- Listas de status "contactado" idênticas ao código anterior:
--   answered, no_answer, busy, failed, do_not_call

-- ── Cartões do topo do dashboard (getDashboardStats) — sempre 1 linha ─────────
CREATE OR REPLACE VIEW public.v_dashboard_stats
WITH (security_invoker = true) AS
SELECT
  (SELECT count(*) FROM public.campaign_contacts) AS total_contacts,
  (SELECT count(*) FROM public.campaign_contacts
     WHERE status IN ('answered', 'no_answer', 'busy', 'failed', 'do_not_call')) AS contacted,
  (SELECT count(*) FROM public.call_logs
     WHERE created_at >= public.brt_today_start()) AS calls_today,
  (SELECT count(DISTINCT agent_id) FROM public.call_logs
     WHERE created_at >= public.brt_today_start()) AS active_agents;

-- ── Tabela de campanhas do dashboard (getCampaignsSummary) — 1 linha/campanha ──
-- LEFT JOIN: campanha sem contatos aparece com zeros. Substitui o O(campanhas ×
-- contatos) que rodava em JS.
CREATE OR REPLACE VIEW public.v_campaign_summary
WITH (security_invoker = true) AS
SELECT
  c.id,
  c.name,
  c.status,
  count(cc.id)                                                     AS total,
  count(*) FILTER (WHERE cc.status = 'pending')                    AS pending,
  count(*) FILTER (WHERE cc.status = 'answered')                   AS answered,
  count(*) FILTER (WHERE cc.status IN
    ('answered', 'no_answer', 'busy', 'failed', 'do_not_call'))    AS contacted
FROM public.campaigns c
LEFT JOIN public.campaign_contacts cc ON cc.campaign_id = c.id
GROUP BY c.id, c.name, c.status, c.created_at
ORDER BY c.created_at DESC;

-- ── Contagem por status de UMA campanha (getCampaignStats) — 1 linha/campanha ──
-- total conta TODAS as linhas (inclui 'exhausted'); os buckets cobrem só os 9
-- status que o código expõe — paridade exata com a versão anterior em JS.
CREATE OR REPLACE VIEW public.v_campaign_status_counts
WITH (security_invoker = true) AS
SELECT
  campaign_id,
  count(*)                                          AS total,
  count(*) FILTER (WHERE status = 'pending')        AS pending,
  count(*) FILTER (WHERE status = 'dialing')        AS dialing,
  count(*) FILTER (WHERE status = 'answered')       AS answered,
  count(*) FILTER (WHERE status = 'no_answer')      AS no_answer,
  count(*) FILTER (WHERE status = 'busy')           AS busy,
  count(*) FILTER (WHERE status = 'failed')         AS failed,
  count(*) FILTER (WHERE status = 'do_not_call')    AS do_not_call,
  count(*) FILTER (WHERE status = 'abandoned')      AS abandoned
FROM public.campaign_contacts
GROUP BY campaign_id;

-- ── Chamadas por hora, hoje (getCallsByHour) — ≤24 linhas ─────────────────────
-- Hora no fuso de Brasília. O front preenche 0..hora-atual a partir destas linhas.
CREATE OR REPLACE VIEW public.v_calls_by_hour_today
WITH (security_invoker = true) AS
SELECT
  EXTRACT(HOUR FROM (created_at AT TIME ZONE 'America/Sao_Paulo'))::int AS hour,
  count(*)                                                              AS calls
FROM public.call_logs
WHERE created_at >= public.brt_today_start()
GROUP BY 1
ORDER BY 1;

-- ── Atividade por agente (getAgentActivity) — 1 linha/agente com ramal ────────
-- Substitui o O(agentes × call_logs do dia). O LATERAL agrega os logs de hoje do
-- agente (último horário, contagem, último status) sem varrer tudo em JS. A
-- derivação de online (last_seen < 60s) e dialer_status fica no front (trivial).
CREATE OR REPLACE VIEW public.v_agent_activity
WITH (security_invoker = true) AS
SELECT
  pr.id                       AS agent_id,
  pr.name,
  pr.extension,
  la.last_call_at,
  COALESCE(la.calls_today, 0) AS calls_today,
  la.last_status,
  ap.dialer_status,
  ap.last_seen_at
FROM public.profiles pr
LEFT JOIN LATERAL (
  SELECT
    max(cl.created_at)                                    AS last_call_at,
    count(*)                                              AS calls_today,
    (array_agg(cl.status ORDER BY cl.created_at DESC))[1] AS last_status
  FROM public.call_logs cl
  WHERE cl.agent_id = pr.id
    AND cl.created_at >= public.brt_today_start()
) la ON true
LEFT JOIN public.agent_presence ap ON ap.agent_id = pr.id
WHERE pr.extension IS NOT NULL
ORDER BY pr.extension;
