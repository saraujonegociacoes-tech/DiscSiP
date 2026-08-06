-- ============================================================================
-- Painel do CEO — Negociação: projeção SÓ dos campos da fase "Aguardando Pagamento"
-- ============================================================================
-- REGRA DO DONO (05/ago/2026), e ela é regra, não preferência:
--
--   Só geram métrica de projeção da Negociação:
--     · os CARDS que estão na fase "Aguardando pagamento ⏳💰" (326422800), e
--     · os CAMPOS DAQUELA FASE — `informe_o_valor_do_pagamento` e
--       `informe_a_data_agendada_para_o_pagamento_1`.
--
--   Campos de pré-venda (2ª parcela e afins) ficam FORA, mesmo em card que esteja
--   na fase certa.
--
-- O filtro de CARD já existia (`neg_is_waiting_phase`, corrigido na 20260803 para
-- uma fase só). O que faltava era o filtro de CAMPO: `neg_projection` tinha um
-- fallback para a 2ª parcela da venda quando os campos da fase estavam vazios. Esta
-- migration remove esse fallback.
--
-- ── Por que o fallback existia, e por que estava errado ─────────────────────
-- Ele veio da decisão #3 do Sprint 2 ("2ª parcela vencida É projeção, em janela
-- própria"), tomada quando 6 dos 14 cards da fase não tinham os campos dela
-- preenchidos — a 2ª parcela parecia ser "o que sobrava de sinal". **Era escopo do
-- COMERCIAL entrando pela porta dos fundos**, o mesmo erro que a 20260803 já tinha
-- corrigido do lado do CARD (a fase 338815768, "Pré - Triagem - 2° Parcela", é do
-- Comercial). Corrigir só o card e deixar o campo foi correção pela metade.
--
-- ── E os campos da 2ª parcela nem eram data de pagamento ────────────────────
-- Conferido card a card em 05/ago, nos 6 cards que caíam no fallback: o campo lido
-- primeiro, `data_do_pagamento_da_2_parcela`, é um **carimbo de quando alguém
-- preencheu o formulário**, não a data da parcela. Nos casos em que os dois campos
-- existem, eles discordam — e o horário denuncia:
--
--   card #1373709872  data_do_pagamento_da_2_parcela = "03/07/2026 09:16"
--                     data_do_pagamento_da_parcela_2 = "22/06/2026"
--   card #1348129801  data_do_pagamento_da_2_parcela = "10/06/2026 17:21"
--                     data_do_pagamento_da_parcela_2 = "28/05/2026"
--   card #1383165735  data_do_pagamento_da_2_parcela = "03/07/2026 09:01"
--                     data_do_pagamento_da_parcela_2 = "16/06/2026"
--
-- Três cards diferentes com carimbo em "10/06/2026 17:2x" é edição em lote, não
-- vencimento. Ou seja: a aba vinha mostrando, para esses cards, uma data que nunca
-- foi data de pagamento de nada. Some junto com o fallback.
--
-- ⚠️ NÃO é problema de parsing. Os quatro parsers do repo foram chamados ao vivo em
-- 05/ago com data ambígua e todos acertaram (`06/05/2026` → `2026-05-06`), e nos 14
-- cards da fase o `value` bate com o `datetime_value` em 100% dos casos quando lido
-- como DD/MM. O que estava errado era QUAL CAMPO era lido, não como.
--
-- ── Efeito no número ────────────────────────────────────────────────────────
-- Dos 14 cards da fase: 8 têm os campos da fase preenchidos, 6 não têm (esses 6
-- saem da projeção). Descontando os já pagos, a projeção cai de 8 cards para 3.
--
-- Idempotente (CREATE OR REPLACE). Não altera tabela nem policy.
--
-- 🔴 A PARTE 2 (fim do arquivo) É OBRIGATÓRIA E **NÃO RODA SOZINHA**. Ela está dentro
-- de comentários `--`, então executar este arquivo inteiro NÃO a executa. `proj_*` é
-- resolvido NA INGESTÃO e fica gravado em `neg_cards`: trocar a função não reescreve as
-- 3.344 linhas já gravadas, e a aba continua mostrando as 2ªs parcelas como se nada
-- tivesse mudado — sem erro nenhum.
--
-- Aconteceu de verdade: em 05/ago o dono aplicou as 3 migrations e a conferência ao vivo
-- ainda achou **285 cards com `proj_source = 'parcela2'`** e 8 cards na aba em vez de 3.
-- Conferência que pega: `SELECT count(*) FROM neg_cards WHERE proj_source = 'parcela2';`
-- → tem que ser **0**.
-- ============================================================================

BEGIN;

-- ── PARTE 1 — a função, agora com um sinal só ───────────────────────────────
-- Deixa de ser COALESCE por prioridade e vira leitura direta dos campos da fase.
-- Mantém a assinatura e as colunas (proj_source continua existindo e volta sempre
-- 'fase') para não quebrar `ingest_negociacao_card` nem as RPCs de leitura.
--
-- Valor 0 não é projeção — mesma regra do Financeiro. Medido: 78 valores "0,00" no
-- campo da fase, todos em fases mortas (Distratos/Reversão/Falta de contato).
CREATE OR REPLACE FUNCTION public.neg_projection(p_metadata jsonb)
RETURNS TABLE (proj_value numeric, proj_date date, proj_source text)
LANGUAGE sql IMMUTABLE AS $$
  SELECT v, d, 'fase'::text
  FROM (
    SELECT
      public.neg_parse_money(public.neg_field(p_metadata, 'informe_o_valor_do_pagamento')) AS v,
      public.neg_parse_date (public.neg_field(p_metadata, 'informe_a_data_agendada_para_o_pagamento_1')) AS d
  ) s
  WHERE v IS NOT NULL AND v <> 0 AND d IS NOT NULL
$$;

COMMIT;

-- ============================================================================
-- PARTE 2 — RE-CÁLCULO (rode DEPOIS, como comando separado)
-- ============================================================================
-- Obrigatório: `proj_value`/`proj_date`/`proj_source` são gravados na ingestão, então
-- as linhas antigas continuam com a projeção da regra velha até serem reescritas.
-- Sem isto, a aba segue mostrando as 2ªs parcelas.
--
-- Idempotente e barato (3.344 linhas). Não chama o Pipefy: recalcula do `metadata`
-- que já está no banco.
--
--   UPDATE public.neg_cards c
--   SET    proj_value = p.proj_value,
--          proj_date  = p.proj_date,
--          proj_source = p.proj_source
--   FROM   LATERAL public.neg_projection(c.metadata) p
--   WHERE  c.proj_value IS DISTINCT FROM p.proj_value
--       OR c.proj_date  IS DISTINCT FROM p.proj_date
--       OR c.proj_source IS DISTINCT FROM p.proj_source;
--
-- ⚠️ `neg_projection` agora pode não devolver LINHA nenhuma (quando os campos da
-- fase estão vazios), e um JOIN LATERAL sem linha ELIMINA o card do UPDATE — o
-- card ficaria com a projeção velha, que é exatamente o que queremos apagar. Por
-- isso é LEFT JOIN LATERAL ... ON true, que devolve NULL nesses casos.
--
-- 👉 ESTE É O COMANDO. Copie da linha do UPDATE até o `;` e rode no SQL Editor:
--
--   UPDATE public.neg_cards c
--   SET    proj_value  = p.proj_value,
--          proj_date   = p.proj_date,
--          proj_source = p.proj_source
--   FROM   (SELECT c2.id, p2.proj_value, p2.proj_date, p2.proj_source
--           FROM public.neg_cards c2
--           LEFT JOIN LATERAL public.neg_projection(c2.metadata) p2 ON true) p
--   WHERE  c.id = p.id
--     AND (c.proj_value  IS DISTINCT FROM p.proj_value
--       OR c.proj_date   IS DISTINCT FROM p.proj_date
--       OR c.proj_source IS DISTINCT FROM p.proj_source);
--
-- Esperado em 05/ago: ~285 linhas atualizadas (UPDATE 285, mais ou menos conforme o
-- Make tiver rodado). Rodar de novo depois disso atualiza 0 linhas — é idempotente.

-- ============================================================================
-- Conferir depois de aplicar as duas partes
-- ============================================================================
-- 1) Sobrou alguma projeção vinda da 2ª parcela? (tem que ser ZERO)
--      SELECT count(*) FROM public.neg_cards WHERE proj_source = 'parcela2';
--
-- 2) Os cards da fase que perderam a projeção são os 6 sem campo da fase?
--      SELECT pipefy_card_id, title, proj_value, proj_date, proj_source
--      FROM public.neg_cards
--      WHERE current_phase_id = '326422800'
--      ORDER BY proj_date NULLS LAST;
--      -- esperado: 8 com projeção ('fase'), 6 com NULL.
--
-- 3) O que a aba passa a mostrar (fase certa + não pago + com projeção):
--      SELECT count(*), sum(proj_value)
--      FROM public.neg_cards
--      WHERE current_phase_id = '326422800' AND NOT paid_flag AND proj_value IS NOT NULL;
--      -- esperado em 05/ago: 3 cards.
--
-- 4) A fase do Comercial continua fora? (regressão da 20260803)
--      SELECT public.neg_is_waiting_phase('338815768');   -- tem que ser false
--
-- 5) Conferência completa, recomputando do Pipefy cru:
--      npm run verify:negociacao
-- ============================================================================
