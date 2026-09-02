-- ============================================================================
-- Leads — KPI "Reaproveitados" contado por ENTRADA no período (corrige a 20260901)
-- ============================================================================
-- A 20260901 entregou a classe "Reaproveitado" certa (a marca pegajosa em
-- leads.reaproveitado está correta e não muda aqui), mas o KPI que a expunha foi
-- ancorado no MESMO cohort dos outros KPIs de topo: "recebidos no período"
-- (created_at). Para reaproveitamento isso está errado por construção.
--
-- Conferido no banco depois do backfill (02/set), ciclo 11/ago–10/set:
--   reaproveitados por mês de CRIAÇÃO do lead:
--     2026-04: 443 | 2026-05: 1387 | 2026-06: 721 | 2026-07: 445 | 2026-08: 2
--   → "criados no ciclo E reaproveitados" = 2       (o que o KPI mostrava)
--   → "ENTRARAM em Remarketing dentro do ciclo"  = 2832
--
-- Reaproveitamento é, por definição, re-trabalho de base ANTIGA: o lead que entra em
-- Remarketing quase nunca nasceu no ciclo corrente. Medir por created_at devolve ~0
-- todo ciclo e o card some da tela — número tecnicamente correto e inútil.
--
-- Regra nova: o KPI conta quem ENTROU numa fase `marks_reaproveitado` DENTRO do
-- período, com o split ciclo × retroativo que o painel já usa nos Ganhos (WonCard) —
-- e aqui o split é justamente a leitura interessante, porque escancara que o volume é
-- retroativo.
--
-- Entrada é TRANSIÇÃO, detectada com LAG sobre o histórico do lead — mesma regra da
-- 20260731. Isso importa mais ainda depois do backfill: o histórico do Pipefy e o
-- evento do poll podem descrever a MESMA passagem com timestamps diferentes; sem o
-- LAG, uma passagem só viraria duas e o número inflaria.
--
-- Idempotente (CREATE OR REPLACE). Não toca em dados nem na coluna pegajosa.
-- COMO USAR: cole no SQL Editor do Supabase e rode uma vez.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_leads_reaproveitados(p_start timestamptz, p_end timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH ev AS (
    -- histórico COMPLETO do lead (inclui fases mortas e pings de mesma fase), senão a
    -- detecção de "a fase mudou" fica errada. Escopo por papel via v_lead_progress,
    -- mesmo padrão da 20260731 (lead_events não tem policy própria de RLS aqui).
    SELECT e.lead_id, e.to_phase_id, e.occurred_at,
      LAG(e.to_phase_id) OVER (PARTITION BY e.lead_id ORDER BY e.occurred_at) AS prev_phase_id
    FROM public.lead_events e
    WHERE EXISTS (SELECT 1 FROM public.v_lead_progress p WHERE p.lead_id = e.lead_id)
  ),
  entrou AS (
    -- 1 lead = 1 vez, mesmo que tenha entrado em Remarketing duas vezes no período.
    SELECT DISTINCT ev.lead_id
    FROM ev
    JOIN public.lead_phases ph ON ph.pipefy_phase_id = ev.to_phase_id
    WHERE ev.prev_phase_id IS DISTINCT FROM ev.to_phase_id   -- transição real
      AND ph.marks_reaproveitado
      AND ev.occurred_at >= p_start AND ev.occurred_at < p_end
  )
  SELECT jsonb_build_object(
    'total', count(*),
    'cycle', count(*) FILTER (WHERE p.created_at >= p_start AND p.created_at < p_end),
    -- retro por subtração: `NOT (NULL >= x)` é NULL e não entra em FILTER, então lead
    -- sem created_at sumiria dos dois lados e o split não fecharia com o total.
    'retro', count(*) - count(*) FILTER (WHERE p.created_at >= p_start AND p.created_at < p_end)
  )
  FROM entrou e
  JOIN public.v_lead_progress p ON p.lead_id = e.lead_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_leads_reaproveitados(timestamptz, timestamptz) TO authenticated;

-- ============================================================================
-- Conferir depois de aplicar (SQL Editor)
-- ============================================================================
-- 1) Ciclo 11/ago–10/set — esperado ~2832 no total, quase tudo retroativo:
--   SELECT public.get_leads_reaproveitados('2026-08-11T03:00:00Z','2026-09-11T03:00:00Z');
--
-- 2) cycle + retro == total (o split tem que fechar):
--   WITH r AS (SELECT public.get_leads_reaproveitados('2026-08-11T03:00:00Z','2026-09-11T03:00:00Z') j)
--   SELECT (j->>'total')::int = (j->>'cycle')::int + (j->>'retro')::int AS fecha FROM r;
--
-- 3) A marca pegajosa continua intacta (não é o que esta migration mexe):
--   SELECT count(*) FROM public.leads WHERE reaproveitado;                      -- ~2998
--   SELECT count(*) FROM public.leads
--   WHERE reaproveitado AND current_phase_id <> '343865023';                    -- ~746 já saíram
-- ============================================================================
