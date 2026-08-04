-- ============================================================================
-- CS — fase "Aguardando Pagamento": semear + excluir do movimento
-- ============================================================================
-- Follow-up da 20260722_cs_team.sql (forward-only; não se edita a migration já
-- aplicada). O dono confirmou o id da fase (2026-07-22): 343781769 "Aguardando
-- Pagamento". Ela está vazia, então o row ainda não existe em cs_phases (o upsert
-- defensivo do ingest_cs_card só a criaria quando um card caísse lá). Inserimos
-- agora já com exclude_from_movement = true pra que, quando cards entrarem, nem a
-- ENTRADA nem a SAÍDA dessa fase contem como movimento na Página 2 (Equipe).
--
-- funnel_order/pipefy_index são placeholders (9999): a fase é excluída do movimento
-- e a Matriz (Página 1) só mostra fases COM cards — então a ordem é cosmética até
-- ela ter card. Quando quiser posicioná-la (logicamente entre "Negociação do
-- Cliente" e "1° Mês"), ajuste com:
--   UPDATE public.cs_phases SET funnel_order = <n> WHERE id = '343781769';
-- ============================================================================

INSERT INTO public.cs_phases (id, name, funnel_order, pipefy_index, exclude_from_movement)
VALUES ('343781769', 'Aguardando Pagamento', 9999, 9999, true)
ON CONFLICT (id) DO UPDATE SET exclude_from_movement = true;

-- Conferir:
-- SELECT id, name, exclude_from_movement FROM public.cs_phases WHERE id = '343781769';
