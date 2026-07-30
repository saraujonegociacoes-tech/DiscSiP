-- ============================================================================
-- Painel de Sucesso do Cliente (CS) — visão geral (Sprint 2)
-- ============================================================================
-- Camada de leitura pro painel `/cs`: view base por card (`v_cs_progress`) + 1 RPC
-- agregada (`get_cs_dashboard`), mesmo truque do leads (`get_leads_dashboard`) de
-- devolver tudo numa chamada só, agregado no Postgres, pra não esbarrar no teto de
-- paginação do PostgREST nem repetir o erro 1102 (nunca puxar tabela inteira pro
-- Worker) — ver docs/fixes/correcao-cpu-cloudflare-1102.md.
--
-- SEM parâmetro de período: "quantos cards tem por fase" e "responsável" são
-- perguntas de ESTADO ATUAL (quantos clientes estão em cada mês de acompanhamento
-- agora), não de janela de tempo — diferente do dashboard de leads, que tem um ciclo
-- de meta comercial. Pode ganhar filtro de período depois, se fizer falta.
--
-- security_invoker (view) / SECURITY INVOKER (função, é o default — não precisa
-- declarar) — o RLS de cs_cards já filtra por quem está logado (agente=o próprio,
-- supervisor=o departamento, manager/admin=tudo); a função só resume o que o RLS já
-- deixou passar, não amplia acesso.
--
-- Classificação de fase (o que é "sucesso" vs "encerrado sem sucesso", o que
-- significa "Arquivado") ainda NÃO está aqui — pendente de definição do dono, não
-- bloqueia esta camada (cards por fase / tempo na fase / responsável não precisam
-- dela).
-- ============================================================================

CREATE OR REPLACE VIEW public.v_cs_progress
WITH (security_invoker = true) AS
SELECT
  c.id,
  c.pipefy_card_id,
  c.title,
  c.current_phase_id,
  c.current_phase,
  ph.funnel_order,
  c.responsible_agent_id,
  ag.pipefy_name AS responsible_name,
  c.duplicate_responsible,
  c.pipefy_created_at,
  c.pipefy_finished_at,
  c.pipefy_done,
  c.updated_at,
  c.synced_at,
  -- Tempo na fase atual: desde o último evento registrado pra essa fase (poll do
  -- Make/backfill); sem evento ainda, cai pro created_at do card, e por último pro
  -- synced_at (nunca fica sem número). GREATEST(...,0) evita negativo por relógio.
  GREATEST(
    EXTRACT(EPOCH FROM (now() - COALESCE(le.last_event_at, c.pipefy_created_at, c.synced_at))) / 86400,
    0
  ) AS days_in_current_phase
FROM public.cs_cards c
LEFT JOIN public.cs_phases ph ON ph.id = c.current_phase_id
LEFT JOIN public.cs_agents ag ON ag.id = c.responsible_agent_id
LEFT JOIN LATERAL (
  SELECT max(e.occurred_at) AS last_event_at
  FROM public.cs_card_events e
  WHERE e.cs_card_id = c.id AND e.to_phase_id = c.current_phase_id
) le ON true;

CREATE OR REPLACE FUNCTION public.get_cs_dashboard()
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT * FROM public.v_cs_progress
  ),
  phase_stats AS (
    SELECT
      ph.id AS phase_id,
      ph.name,
      ph.funnel_order,
      count(b.id) AS card_count,
      round(avg(b.days_in_current_phase)::numeric, 1) AS avg_days_in_phase
    FROM public.cs_phases ph
    LEFT JOIN base b ON b.current_phase_id = ph.id
    GROUP BY ph.id, ph.name, ph.funnel_order
  ),
  responsible_by_phase AS (
    SELECT
      COALESCE(b.current_phase, 'Sem fase') AS phase_name,
      COALESCE(b.responsible_agent_id::text, 'orphan') AS agent_key,
      COALESCE(b.responsible_name, 'Sem responsável') AS agent_name,
      count(*) AS card_count
    FROM base b
    GROUP BY 1, 2, 3
  ),
  kpis AS (
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE responsible_agent_id IS NULL) AS without_responsible,
      count(DISTINCT responsible_agent_id) AS distinct_responsible,
      round(avg(days_in_current_phase)::numeric, 1) AS avg_days_in_current_phase
    FROM base
  )
  SELECT jsonb_build_object(
    'kpis', (SELECT to_jsonb(k) FROM kpis k),
    'phaseDistribution', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'phaseId', phase_id, 'name', name, 'funnelOrder', funnel_order,
          'count', card_count, 'avgDaysInPhase', avg_days_in_phase
        ) ORDER BY funnel_order
      ) FROM phase_stats
    ), '[]'::jsonb),
    'byResponsible', COALESCE((
      SELECT jsonb_object_agg(grouped.phase_name, grouped.agents)
      FROM (
        SELECT
          phase_name,
          jsonb_agg(
            jsonb_build_object('agentId', NULLIF(agent_key, 'orphan'), 'name', agent_name, 'count', card_count)
            ORDER BY card_count DESC
          ) AS agents
        FROM responsible_by_phase
        GROUP BY phase_name
      ) grouped
    ), '{}'::jsonb)
  )
$$;

-- ── Conferir depois de aplicar ──────────────────────────────────────────────
-- SELECT get_cs_dashboard();  -- logado como manager/admin: kpis.total deve bater
-- com o total importado (1484, se nada mudou no Pipefy desde o backfill).
