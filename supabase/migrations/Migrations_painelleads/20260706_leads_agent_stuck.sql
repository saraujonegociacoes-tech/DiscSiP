-- ============================================================================
-- Dashboard de Leads (Pipefy) — S4/perf: agregação de "parados agora" no Postgres
-- ============================================================================
-- Motivação: getSupervisorMetrics puxava a base ABERTA inteira (~3,3k linhas de
-- v_lead_progress com is_stuck=true) para o Worker e agregava em memória. Isso gasta
-- egress e CPU do Worker (o mesmo tipo de custo que causou o Error 1102). Esta função
-- faz o GROUP BY no banco e devolve ~1 linha por agente + 1 linha "equipe".
--
-- SECURITY INVOKER (default das funções SQL): o RLS do chamador vale (agente só o próprio;
-- supervisor+ tudo), igual às views security_invoker. Parametrizado por período
-- (p_start/p_end) para o split ciclo × retroativo — o front passa os limites do ciclo já
-- calculados (BRT → UTC, `end` exclusivo).
--
-- NÃO toca em tabelas/dados: cria só a função. Idempotente (CREATE OR REPLACE). O app tem
-- FALLBACK: enquanto esta função não existir, getSupervisorMetrics volta a agregar em
-- memória (mais lento, mas funciona) — dá para rodar esta migration a qualquer momento.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_agent_stuck(p_start timestamptz, p_end timestamptz)
RETURNS TABLE (
  agent_id    uuid,
  pipefy_name text,
  stuck_now   bigint,
  stuck_cycle bigint
)
LANGUAGE sql
STABLE
AS $$
  -- Linha "equipe" (agent_id NULL): TODOS os parados, inclusive duplicados e sem responsável.
  SELECT
    NULL::uuid,
    NULL::text,
    count(*),
    count(*) FILTER (WHERE p.created_at >= p_start AND p.created_at < p_end)
  FROM public.v_lead_progress p
  WHERE p.is_stuck
  UNION ALL
  -- Por agente: exclui responsabilidade duplicada e sem responsável (casa com o ranking).
  SELECT
    p.responsible_agent_id,
    la.pipefy_name,
    count(*),
    count(*) FILTER (WHERE p.created_at >= p_start AND p.created_at < p_end)
  FROM public.v_lead_progress p
  JOIN public.lead_agents la ON la.id = p.responsible_agent_id
  WHERE p.is_stuck
    AND NOT p.duplicate_responsible
    AND p.responsible_agent_id IS NOT NULL
  GROUP BY p.responsible_agent_id, la.pipefy_name;
$$;

GRANT EXECUTE ON FUNCTION public.get_agent_stuck(timestamptz, timestamptz) TO authenticated;

-- ============================================================================
-- Verificação (rode com um ciclo qualquer; a linha de agent_id NULL é o total da equipe):
--   SELECT * FROM public.get_agent_stuck('2026-06-11T03:00:00Z', '2026-07-11T03:00:00Z');
-- ============================================================================
