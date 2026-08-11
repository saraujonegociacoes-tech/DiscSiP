-- ============================================================================
-- Painel de CS — Página 4 (Pagamento): projeção SÓ dos cards na fase
-- ============================================================================
-- REGRA DO DONO (11/ago/2026), e ela é regra, não preferência:
--
--   · PROJEÇÃO (o plano de parcelas: valor + vencimento previstos) só conta quando o
--     card ESTÁ na fase "Aguardando Pagamento" (343781769). Card que saiu da fase não
--     projeta mais nada — e não entra na aba só por ter os campos preenchidos.
--   · PAGAMENTO REALIZADO (conexão com o pipe do Financeiro) continua contando SEMPRE,
--     em qualquer fase. Dinheiro que entrou não some do painel porque o card andou no
--     funil.
--
-- ── O que estava errado ─────────────────────────────────────────────────────
-- A `get_cs_pagamento_projecao()` da 20260730b montava a coorte por CAMPO, não por
-- FASE:  `WHERE 1_parcela_valor IS NOT NULL OR EXISTS (pagamento)`  — e lia o plano do
-- metadata sem olhar onde o card está. Os campos do plano ficam gravados no
-- `cs_cards.metadata` para sempre: quando o card sai de "Aguardando Pagamento" pra
-- "1° Mês", "Quitados" ou "Arquivado", eles vão junto. Resultado: card fora da fase
-- continuava aparecendo na carteira com previsto / em aberto / parcela atrasada,
-- inflando o KPI "A receber", o calendário de recebimento e os insights de atraso.
--
-- É o MESMO erro que a `20260805_negociacao_so_campos_da_fase.sql` corrigiu na
-- Negociação do painel do CEO — lá era o campo errado, aqui é a fase errada. Padrão a
-- guardar: **campo de fase é dado de fase; fora dela ele é histórico, não projeção.**
--
-- ── Efeito no número ────────────────────────────────────────────────────────
-- Some da aba todo card que tinha plano no metadata mas já saiu da fase e nunca teve
-- pagamento conectado. Quem tem pagamento conectado CONTINUA na lista (o realizado é o
-- que sustenta a linha), só que sem plano: `plano: []`, previsto 0, em aberto 0 — o
-- cliente marca esses como "Fora da fase". O "Já recebido" não muda.
--
-- ── ✅ NÃO precisa re-rodar backfill nem reingestão ─────────────────────────
-- Diferente da 20260805 (que tinha `proj_*` gravado em `neg_cards` na ingestão e exigiu
-- um UPDATE de recálculo), aqui o plano é resolvido NA LEITURA, direto do `metadata`.
-- Trocar a função já muda a aba na próxima chamada. Nada é gravado, nada fica velho.
--
-- Idempotente (CREATE OR REPLACE). Não altera tabela, coluna nem policy.
-- Forward-only: não editar a 20260730b.
--
-- ⚠️ ARMADILHA: a 20260730b tem um `CREATE OR REPLACE` da MESMA
-- `get_cs_pagamento_projecao` com a versão sem filtro de fase. Reexecutar aquele arquivo
-- DEPOIS deste desfaz esta correção **em silêncio** (sem erro, e os cards fora da fase
-- voltam a somar). Esta migration é sempre a ÚLTIMA palavra sobre essa RPC; se precisar
-- reaplicar a 20260730b, rode esta logo em seguida.
-- ============================================================================

BEGIN;

-- ── 1. A fase, num lugar só ─────────────────────────────────────────────────
-- Espelha `neg_is_waiting_phase` do painel do CEO: a regra "qual fase é a de pagamento"
-- passa a ser greppável e conferível com um SELECT, em vez de literal solto dentro da
-- RPC. Se o id da fase mudar no Pipefy, muda AQUI e só aqui.
CREATE OR REPLACE FUNCTION public.cs_is_pagamento_phase(p_phase_id text)
RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  -- "Aguardando Pagamento" do pipe 3.3 - Customer Success (305801110). Seedada na
  -- 20260722b já com exclude_from_movement = true.
  SELECT p_phase_id = '343781769'
$$;

COMMENT ON FUNCTION public.cs_is_pagamento_phase(text) IS
  'A fase "Aguardando Pagamento" do CS (343781769). Só cards nela geram projeção de pagamento (decisão do dono, 2026-08-11); o realizado conta em qualquer fase.';

GRANT EXECUTE ON FUNCTION public.cs_is_pagamento_phase(text) TO authenticated;

-- ── 2. A leitura da projeção, agora escopada pela fase ──────────────────────
-- Mudou (vs. 20260730b):
--   a) COORTE — plano só entra se o card está NA FASE. O `OR EXISTS (pagamento)`
--      continua, sem filtro de fase: é ele que mantém o realizado visível.
--   b) CAMPOS — os 6 campos do plano são lidos dentro de um CASE pela fase. Card fora
--      da fase devolve `plano: []` mesmo tendo o metadata preenchido.
--   c) `naFase` novo no payload — o cliente usa pra rotular "Fora da fase" e pro CSV,
--      em vez de re-adivinhar a regra no front.
-- Segue SECURITY INVOKER (default): o RLS de cs_cards/cs_card_payments é quem escopa
-- por papel+departamento. A reconciliação prevista×paga, KPIs, calendário e status
-- continuam no cliente (CsPagamento.tsx).
CREATE OR REPLACE FUNCTION public.get_cs_pagamento_projecao()
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT
      c.id AS cs_card_id,
      c.pipefy_card_id,
      c.title,
      c.responsible_agent_id,
      ag.pipefy_name AS agent_name,
      c.current_phase_id,
      COALESCE(c.current_phase, 'Sem fase') AS phase_name,
      COALESCE(ph.is_terminal, false) AS is_terminal,
      COALESCE(public.cs_is_pagamento_phase(c.current_phase_id), false) AS na_fase,
      NULLIF(c.metadata->'forma_de_pagamento'->>'value', '') AS forma,
      -- Plano por parcela (slugs irregulares — o dono duplicou os campos no Pipefy).
      -- Fora da fase: NULL em tudo, e o jsonb_agg abaixo devolve '[]'.
      CASE WHEN public.cs_is_pagamento_phase(c.current_phase_id)
        THEN public.cs_parse_money(c.metadata->'1_parcela_valor'->>'value') END                     AS p1_valor,
      CASE WHEN public.cs_is_pagamento_phase(c.current_phase_id)
        THEN public.cs_parse_date (c.metadata->'1_parcela_data_do_pagamento'->>'value') END         AS p1_data,
      CASE WHEN public.cs_is_pagamento_phase(c.current_phase_id)
        THEN public.cs_parse_money(c.metadata->'copy_of_1_parcela_valor'->>'value') END             AS p2_valor,
      CASE WHEN public.cs_is_pagamento_phase(c.current_phase_id)
        THEN public.cs_parse_date (c.metadata->'copy_of_1_parcela_data_do_pagamento'->>'value') END AS p2_data,
      CASE WHEN public.cs_is_pagamento_phase(c.current_phase_id)
        THEN public.cs_parse_money(c.metadata->'copy_of_2_parcela_valor'->>'value') END             AS p3_valor,
      CASE WHEN public.cs_is_pagamento_phase(c.current_phase_id)
        THEN public.cs_parse_date (c.metadata->'copy_of_2_parcela_data_do_pagamento'->>'value') END AS p3_data
    FROM public.cs_cards c
    LEFT JOIN public.cs_phases ph ON ph.id = c.current_phase_id
    LEFT JOIN public.cs_agents ag ON ag.id = c.responsible_agent_id
    WHERE (
        public.cs_is_pagamento_phase(c.current_phase_id)
        AND NULLIF(c.metadata->'1_parcela_valor'->>'value', '') IS NOT NULL
      )
      OR EXISTS (SELECT 1 FROM public.cs_card_payments p WHERE p.cs_card_id = c.id)
  )
  SELECT jsonb_build_object(
    'referenceAt', now(),
    'cards', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'pipefyCardId', b.pipefy_card_id,
          'title', b.title,
          'agentId', b.responsible_agent_id,
          'agentName', COALESCE(b.agent_name, 'Sem responsável'),
          'active', NOT b.is_terminal,
          'phaseId', b.current_phase_id,
          'phase', b.phase_name,
          'naFase', b.na_fase,
          'forma', b.forma,
          'plano', (
            SELECT COALESCE(jsonb_agg(
              jsonb_build_object('num', pl.n, 'valorPrevisto', pl.vp, 'dataPrevista', pl.dp)
              ORDER BY pl.n
            ), '[]'::jsonb)
            FROM (VALUES
              (1, b.p1_valor, b.p1_data),
              (2, b.p2_valor, b.p2_data),
              (3, b.p3_valor, b.p3_data)
            ) AS pl(n, vp, dp)
            WHERE pl.vp IS NOT NULL OR pl.dp IS NOT NULL
          ),
          'pagamentos', (
            SELECT COALESCE(jsonb_agg(
              jsonb_build_object(
                'parcelaNum', p.parcela_num,
                'valorPago', p.valor_pago,
                'dataPagamento', p.data_pagamento,
                'comprovanteUrl', p.comprovante_url,
                'pagamentoId', p.pagamento_id
              )
              ORDER BY p.parcela_num NULLS LAST, p.data_pagamento
            ), '[]'::jsonb)
            FROM public.cs_card_payments p
            WHERE p.cs_card_id = b.cs_card_id
          )
        )
        ORDER BY b.phase_name, b.title
      )
      FROM base b
    ), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_cs_pagamento_projecao() TO authenticated;

COMMIT;

-- ============================================================================
-- Conferir depois de aplicar
-- ============================================================================
-- 1) A fase é a certa? (pega o erro de literal trocado)
--      SELECT public.cs_is_pagamento_phase('343781769');   -- true
--      SELECT public.cs_is_pagamento_phase('305801110');   -- false (isso é o pipe)
--
-- 2) Sobrou projeção de card FORA da fase? (tem que ser ZERO)
--      SELECT count(*)
--      FROM jsonb_array_elements(public.get_cs_pagamento_projecao()->'cards') c
--      WHERE (c->>'naFase')::boolean IS FALSE
--        AND jsonb_array_length(c->'plano') > 0;
--
-- 3) Quem sobra na aba, e por quê:
--      SELECT (c->>'naFase')::boolean AS na_fase,
--             count(*) AS cards,
--             count(*) FILTER (WHERE jsonb_array_length(c->'plano') > 0)      AS com_plano,
--             count(*) FILTER (WHERE jsonb_array_length(c->'pagamentos') > 0) AS com_pagamento
--      FROM jsonb_array_elements(public.get_cs_pagamento_projecao()->'cards') c
--      GROUP BY 1;
--      -- esperado: na_fase=true → com_plano = cards; na_fase=false → com_plano = 0
--      --           e com_pagamento = cards (só o realizado os sustenta).
--
-- 4) Quantos cards têm plano no metadata mas NÃO estão na fase (os que saíram da aba):
--      SELECT count(*) FROM public.cs_cards c
--      WHERE NULLIF(c.metadata->'1_parcela_valor'->>'value', '') IS NOT NULL
--        AND NOT public.cs_is_pagamento_phase(c.current_phase_id);
--
-- 5) O realizado não mexeu (histórico é RPC separada, sem filtro de fase):
--      SELECT public.get_cs_pagamento_historico(now() - interval '90 days', now() + interval '1 day') -> 'count';
--
-- 6) Conferência completa (read-only, sem PII):  node scripts/verify-cs-pagamento.mjs
-- ============================================================================
