-- ============================================================================
-- Dashboard de Leads (Pipefy) — correção do TRUNCAMENTO em 1000 linhas
-- ============================================================================
-- Sintoma: as contagens de vários painéis (KPIs, funil, ranking de agentes, canal,
-- motivos de lead morto) travavam em 1000. Causa: o PostgREST corta toda resposta no
-- teto "Max Rows" do projeto (padrão 1000). O getLeadsData puxava v_lead_progress do
-- período e agregava em JavaScript — quando o período tinha > Max Rows leads, o Worker
-- só via as primeiras 1000 linhas e TODA contagem saía truncada.
--
-- Correção: agregar UMA vez no Postgres e devolver 1 linha (um jsonb) — imune ao teto
-- de linhas (que limita a QUANTIDADE de linhas da resposta, não o que uma função conta
-- internamente). Mesma filosofia do get_agent_stuck e do fix do Error 1102: o número é
-- contado no banco, o Worker só lê o resultado pronto (corta egress e CPU também).
--
-- SECURITY INVOKER (default de função SQL): o RLS do chamador vale em v_lead_progress
-- (security_invoker) — agente vê só o próprio, supervisor o do depto, admin tudo. A
-- MESMA função serve às duas visões, sem duplicar permissão. Parametrizada pelo período
-- (p_start/p_end já em UTC, end exclusivo), igual ao get_agent_stuck.
--
-- O front pós-processa só arrays JÁ pequenos (fases ~10, agentes ~8, canais ~dezenas):
-- rótulos limpos das fases, cap "top-12 + Outros" no canal, escada de mortalidade e
-- ordenação do ranking continuam no TypeScript. Nada disso pode truncar.
--
-- NÃO toca em tabelas/dados: cria só a função. Idempotente (CREATE OR REPLACE). O app
-- tem FALLBACK — enquanto esta função não existir, getLeadsData volta a agregar em
-- memória (paginado, então correto, só mais lento). Rode quando puder.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_leads_dashboard(p_start timestamptz, p_end timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
WITH period AS MATERIALIZED (
  -- Só as colunas que as agregações usam. MATERIALIZED garante que v_lead_progress
  -- (view com LATERAL sobre lead_events) seja avaliada UMA vez, não uma por subquery.
  SELECT
    p.responsible_agent_id,
    p.discard_reason,
    p.duplicate_responsible,
    p.channel,
    p.is_dead,
    p.is_open,
    p.is_won,
    p.max_funnel_order,
    p.hours_to_first_contact
  FROM public.v_lead_progress p
  WHERE p.created_at >= p_start AND p.created_at < p_end
)
SELECT jsonb_build_object(
  -- KPIs do período (as taxas conversão/lead-morto são derivadas no front).
  'kpis', (
    SELECT jsonb_build_object(
      'total', count(*),
      'open',  count(*) FILTER (WHERE is_open),
      'won',   count(*) FILTER (WHERE is_won),
      'dead',  count(*) FILTER (WHERE is_dead),
      'avgHoursToFirstContact', round(avg(hours_to_first_contact)::numeric, 1)
    )
    FROM period
  ),

  -- Funil: por ordem produtiva, quantos leads alcançaram aquela ordem ou além. O front
  -- casa cada ordem com o rótulo LIMPO de PRODUCTIVE_PHASES (nomes no banco têm lixo).
  'funnelByOrder', (
    SELECT COALESCE(jsonb_object_agg(ph.funnel_order::text, x.cnt), '{}'::jsonb)
    FROM public.lead_phases ph
    CROSS JOIN LATERAL (
      SELECT count(*) AS cnt
      FROM period pr
      WHERE COALESCE(pr.max_funnel_order, -1) >= ph.funnel_order
    ) x
    WHERE ph.kind = 'produtiva' AND ph.funnel_order IS NOT NULL
  ),

  -- Motivos de descarte (só leads mortos), já ordenados por volume.
  'deadReasons', (
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('reason', reason, 'leads', leads)
                ORDER BY leads DESC, reason), '[]'::jsonb)
    FROM (
      SELECT COALESCE(NULLIF(btrim(discard_reason), ''), 'Não informado') AS reason,
             count(*) AS leads
      FROM period
      WHERE is_dead
      GROUP BY 1
    ) d
  ),

  -- "Em qual tentativa o lead mais morre": mortos por última ordem produtiva alcançada.
  -- O front monta a escada 0..maior-ordem-com-morte a partir deste mapa.
  'deathByOrder', (
    SELECT COALESCE(jsonb_object_agg(ord::text, deaths), '{}'::jsonb)
    FROM (
      SELECT COALESCE(max_funnel_order, -1) AS ord, count(*) AS deaths
      FROM period
      WHERE is_dead AND COALESCE(max_funnel_order, -1) >= 0
      GROUP BY 1
    ) e
  ),

  -- Desempenho por canal (valor cru de capta_o_do_lead; vazio → "Não informado"). O
  -- front aplica o cap top-12 + "Outros". channelFilled alimenta o "% preenchido".
  'channels', (
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object(
        'channel', channel, 'total', total, 'won', won, 'dead', dead)
        ORDER BY total DESC, channel), '[]'::jsonb)
    FROM (
      SELECT COALESCE(NULLIF(btrim(channel), ''), 'Não informado') AS channel,
             count(*)                        AS total,
             count(*) FILTER (WHERE is_won)  AS won,
             count(*) FILTER (WHERE is_dead) AS dead
      FROM period
      GROUP BY 1
    ) c
  ),
  'channelFilled', (SELECT count(*) FROM period WHERE NULLIF(btrim(channel), '') IS NOT NULL),

  -- Ranking por agente. Exclui sem-responsável e responsabilidade duplicada (casa com a
  -- regra do S0). O front computa taxas e a ordenação.
  'ranking', (
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object(
        'agentId', agent_id,
        'name',    COALESCE(la.pipefy_name, 'Sem nome'),
        'total',   total, 'won', won, 'dead', dead,
        'avgHoursToFirstContact', avg_ftc)), '[]'::jsonb)
    FROM (
      SELECT responsible_agent_id                          AS agent_id,
             count(*)                                      AS total,
             count(*) FILTER (WHERE is_won)                AS won,
             count(*) FILTER (WHERE is_dead)               AS dead,
             round(avg(hours_to_first_contact)::numeric, 1) AS avg_ftc
      FROM period
      WHERE responsible_agent_id IS NOT NULL AND NOT duplicate_responsible
      GROUP BY responsible_agent_id
    ) r
    LEFT JOIN public.lead_agents la ON la.id = r.agent_id
  )
);
$$;

GRANT EXECUTE ON FUNCTION public.get_leads_dashboard(timestamptz, timestamptz) TO authenticated;

-- ============================================================================
-- Verificação (rode com um ciclo qualquer; deve devolver UM jsonb com todas as seções,
-- e as contagens NÃO devem mais parar em 1000):
--   SELECT public.get_leads_dashboard('2026-06-11T03:00:00Z', '2026-07-11T03:00:00Z');
-- Como visão-deus (sem RLS) o total do período pode passar de 1000 sem truncar.
-- ============================================================================
