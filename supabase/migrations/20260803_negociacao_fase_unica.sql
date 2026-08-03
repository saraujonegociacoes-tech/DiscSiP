-- ============================================================================
-- Negociação — a projeção sai SÓ da fase "Aguardando pagamento" (326422800)
-- Painel do CEO, Sprint 2. Corrige a decisão #1 da 20260731b.
-- ============================================================================
-- ⚠️ CORREÇÃO DE REGRA DE NEGÓCIO, decidida pelo dono em 2026-08-03.
--
-- A 20260731b incluía DUAS fases como "espera de pagamento":
--   • 326422800 "Aguardando pagamento ⏳💰"
--   • 338815768 "Pré - Triagem - 2° Parcela📝"
--
-- A segunda foi um erro de leitura MEU, não do dado. Eu vi que ela estava cheia
-- (10/10 cards com valor e data, todos a vencer) e que a primeira estava meio
-- vazia, e concluí que as duas juntas davam "o quadro real". O que os números não
-- mostravam é a que ÁREA cada fase pertence: **338815768 é do Comercial**, não da
-- Negociação. Os cards que estão lá são acompanhamento de 2ª parcela de venda,
-- não cobrança em negociação — não são projeção deste painel.
--
-- Lição: densidade de preenchimento não é sinal de pertencimento. A fase mais bem
-- preenchida das duas era a que não era pra estar aqui, e nenhuma query ia dizer
-- isso — só quem conhece o processo.
--
-- ── O QUE MUDA NO NÚMERO ────────────────────────────────────────────────────
-- Medido em 2026-08-03, com neg_cards carregado (3.343 cards):
--   antes (2 fases): R$ 16.260,50 em 17 cards
--   agora (1 fase):  R$ 10.000,00 em  8 cards
-- Os R$ 6.260,50 de 338815768 (9 cards) saem inteiros.
--
-- ── NÃO PRECISA RE-RODAR O BACKFILL ─────────────────────────────────────────
-- `ingest_negociacao_card` grava proj_value/proj_date/proj_source em TODO card,
-- independente da fase; quem filtra é a RPC de leitura, no momento da consulta.
-- Trocar esta função já muda a aba na próxima chamada. (Foi de propósito: fase é
-- a coisa que mais muda num pipe, e recarregar 3.343 cards pra mudar um filtro
-- seria caro e frágil.)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.neg_is_waiting_phase(p_phase_id text)
RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  -- UMA fase só. "Aguardando pagamento ⏳💰" é a única de cobrança da Negociação.
  -- Não reintroduzir 338815768 ("Pré - Triagem - 2° Parcela") — é do Comercial.
  SELECT p_phase_id = '326422800'
$$;

COMMENT ON FUNCTION public.neg_is_waiting_phase(text) IS
  'A fase de espera de pagamento da Negociação (326422800). Só ela — 338815768 é do Comercial e não entra na projeção do CEO (decisão do dono, 2026-08-03).';


-- ── ⚠️ ORDEM IMPORTA ────────────────────────────────────────────────────────
-- A 20260731b tem um `CREATE OR REPLACE` da MESMA função com a versão de duas
-- fases. Se aquele arquivo for reexecutado DEPOIS deste, ele desfaz esta correção
-- **em silêncio** — sem erro, e a aba volta a somar o dinheiro do Comercial.
-- Já aconteceu uma vez (03/ago). Esta migration é sempre a ÚLTIMA palavra sobre
-- `neg_is_waiting_phase`; se reaplicar a 20260731b, rode esta logo em seguida.
--
-- ── Conferir depois de aplicar (FAÇA ESTA — é a que pega o erro acima) ───────
--   SELECT public.neg_is_waiting_phase('326422800');  -- esperado: true
--   SELECT public.neg_is_waiting_phase('338815768');  -- esperado: FALSE (era true)
--
--   SELECT count(*), sum(proj_value)
--   FROM public.neg_cards
--   WHERE public.neg_is_waiting_phase(current_phase_id)
--     AND NOT paid_flag AND proj_value IS NOT NULL AND proj_date IS NOT NULL;
--   -- esperado em 03/ago: 8 cards, R$ 10.000,00
--
-- Depois: `npm run verify:negociacao` tem que voltar 0 divergências.
