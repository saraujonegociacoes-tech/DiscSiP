-- ============================================================================
-- Negociação (pipe 3.0 Negociação) — schema, ingestão e projeções do CEO
-- Painel do CEO, Sprint 2. Ver:
--   docs/projetopainelceo-docs/updates/painel-ceo-sprints.md            (roadmap)
--   docs/projetopainelceo-docs/updates/introspeccao-pipefy-negociacao.md (mapeamento)
-- ============================================================================
-- VERTICAL ISOLADA, clone do molde do Financeiro (20260731_financeiro_schema.sql):
-- tabelas/RLS/RPCs próprios, nada compartilhado. Pipe Pipefy: "3.0 Negociação"
-- (id 304370275), mapeado por introspecção ao vivo em 31/jul/2026 (pipe inteiro,
-- 3.342 cards). O candidato 306994213 ("2.1 - Controle de Vendas") foi descartado:
-- 0 cards em todas as 8 fases.
--
-- ⚠️ ESTA VERTICAL SÓ TRAZ **PROJEÇÃO**, NUNCA REALIZADO.
-- O conector `lan_ar_pagamento` da fase "Aguardando pagamento" aponta para o pipe
-- 304386356 — o MESMO pipe do Financeiro, já ingerido no Sprint 1. Verificado
-- seguindo as conexões: os cards ligados estão em "Pagamento finalizado". Ou seja,
-- todo pagamento realizado da Negociação JÁ ESTÁ em `fin_entries`. Somar o realizado
-- daqui contaria o mesmo dinheiro duas vezes entre a aba Financeiro e a aba Projeções.
--
-- ⚠️ POR QUE `o_pagamento_foi_reaizado` É O FILTRO CENTRAL (e não um detalhe)
-- Medido card a card nas duas fases relevantes (24 cards):
--     `o_pagamento_foi_reaizado = 'Sim'`  ⟺  o card TEM conexão "Lançar pagamento"
-- em 24/24, sem exceção. Então o flag diz, de graça (está no metadata), se aquele
-- dinheiro já virou card do Financeiro. Sem esse filtro a projeção da fase é
-- R$ 10.500,00; com ele, R$ 4.000,00 — os outros R$ 6.500,00 já entraram e já estão
-- contados na outra aba. O card fica na fase depois de pago; o flag é que avisa.
-- (O id tem typo de origem: "reaizado", sem o 'l'. É o id que vale.)
--
-- ⚠️ SÃO DUAS FASES DE ESPERA, NÃO UMA (decisão do dono, 31/jul)
--   • 326422800 "Aguardando pagamento ⏳💰" — onde a cobrança ATRASA. 14 cards, mas 6
--     sem valor/data nos campos da própria fase, e 11 dos 14 com 2ª parcela VENCIDA.
--   • 338815768 "Pré - Triagem - 2° Parcela📝" — onde a 2ª parcela EM DIA espera. 10
--     cards, 10/10 preenchidos, todas as datas a vencer, 0 pagos.
-- Só a primeira entregaria uma projeção que é quase toda atraso. As duas juntas dão o
-- quadro real, e a janela de vencimento separa uma coisa da outra.
--
-- ⚠️ NÃO EXISTE TABELA-FILHA AQUI (o Financeiro tem `fin_entries`)
-- Lá um card antigo carregava até 4 pagamentos HISTÓRICOS já ocorridos, em meses
-- diferentes. Aqui a projeção é para frente: um card parado numa fase de espera está
-- esperando UM próximo pagamento. Então é 1 projeção por card, e a regra de qual
-- sinal vale está em `neg_projection` (COALESCE, não soma — ver lá o porquê).
--
-- Não existe `neg_phases`: são 25 fases e a única regra que depende delas é quais duas
-- contam como espera de pagamento. Guardamos id+nome denormalizados no card.
-- ============================================================================


-- ── PARTE 1 — Tabelas ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.neg_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipefy_card_id text UNIQUE NOT NULL,
  title text,                                   -- nome do contratante (dado sensível)
  current_phase_id text,
  current_phase text,
  -- Contexto do card.
  product text,                                 -- sele_o_de_lista ("Produto contratado") — 100% preenchido
  client_name text,                             -- nome_completo
  total_value numeric,                          -- valor_da_cobran_a ("Valor do Pagamento Total")
  payment_method text,                          -- forma_de_pagamento_do_cliente
  -- Projeção JÁ RESOLVIDA na ingestão (ver neg_projection): valor, data e de qual
  -- sinal ela veio. Fica no card porque é 1:1 — não há tabela-filha.
  proj_value numeric,
  proj_date date,
  proj_source text,                             -- 'fase' | 'parcela2'
  -- `true` = o dinheiro já entrou e JÁ ESTÁ em fin_entries. Não projetar.
  paid_flag boolean NOT NULL DEFAULT false,     -- o_pagamento_foi_reaizado = 'Sim'
  pipefy_created_at timestamptz,
  pipefy_done boolean,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,  -- TODOS os campos do card, por field-id (padrão do CS/Financeiro)
  synced_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS neg_cards_phase_idx ON public.neg_cards (current_phase_id);
CREATE INDEX IF NOT EXISTS neg_cards_proj_date_idx ON public.neg_cards (proj_date);
CREATE INDEX IF NOT EXISTS neg_cards_paid_idx ON public.neg_cards (paid_flag);


-- ── PARTE 2 — Parsers e helpers ─────────────────────────────────────────────

-- Dinheiro: clone fiel de fin_parse_money. Este pipe manda formato brasileiro sem
-- símbolo em 100% dos casos ("1.166,66", "374,50"). Confirmado por chamada ao vivo.
CREATE OR REPLACE FUNCTION public.neg_parse_money(raw text)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s text;
BEGIN
  IF raw IS NULL THEN RETURN NULL; END IF;
  s := trim(raw);
  IF s = '' THEN RETURN NULL; END IF;
  IF s ~ ',[0-9]{1,2}$' THEN
    s := replace(replace(s, '.', ''), ',', '.');
  END IF;
  s := regexp_replace(s, '[^0-9.\-]', '', 'g');
  IF s !~ '^-?[0-9]+(\.[0-9]+)?$' THEN RETURN NULL; END IF;
  RETURN s::numeric;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- ⚠️ Data: clone fiel de `fin_parse_date` — e o "fiel" aqui é uma DECISÃO, não preguiça.
-- Este pipe tem um formato a mais que o Financeiro: `DD/MM/YYYY HH:MM` (campos de tipo
-- `datetime`/`due_date`), além do `DD/MM/YYYY` dos campos `date`. O fin_parse_date engole
-- os dois de graça porque a regex NÃO é ancorada no fim e ele faz `left(s,10)`.
-- Confirmado por chamada ao vivo em 31/jul contra o banco:
--     fin_parse_date('06/08/2026 21:00') -> 2026-08-06
--     fin_parse_date('31/07/2026 11:18') -> 2026-07-31
--     fin_parse_date('07/08/2026')       -> 2026-08-07
--
-- ⚠️⚠️ E AQUI ESTÁ A ARMADILHA DESTE PIPE — ela é o INVERSO da do Financeiro.
-- Lá `datetime_value` vinha SEMPRE null, e a regra virou "use `value`, é o que existe".
-- Aqui os campos `datetime`/`due_date` trazem `datetime_value` em 100% dos cards — parece
-- o campo "melhor", já em ISO, pronto pra castar. É armadilha: ele vem em UTC, enquanto o
-- `value` vem em horário local (BRT, −03). Um pagamento agendado pras 21:00 vira O DIA
-- SEGUINTE em UTC:
--     value          = "06/08/2026 21:00"
--     datetime_value = "2026-08-07T00:00:54+00:00"   ← 7 de agosto, não 6
-- Medido: 79 de 968 cards (8,2%) com o DIA divergente. Numa virada de mês isso joga a
-- projeção no mês errado, e o número continua plausível — ninguém percebe.
--
-- ⇒ REGRA: a ingestão abaixo lê SEMPRE `->>'value'`, NUNCA `->>'datetime_value'`.
--   Demonstrado ao vivo: fin_parse_date('2026-08-07T00:00:54+00:00') -> 2026-08-07 (errado).
CREATE OR REPLACE FUNCTION public.neg_parse_date(raw text)
RETURNS date
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s text;
BEGIN
  IF raw IS NULL THEN RETURN NULL; END IF;
  s := trim(raw);
  IF s = '' THEN RETURN NULL; END IF;
  -- Sem `$` no fim de propósito: casa "06/08/2026" E "06/08/2026 21:00".
  IF s ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}' THEN
    RETURN to_date(left(s, 10), 'DD/MM/YYYY');
  END IF;
  RETURN left(s, 10)::date;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- Valor `value` de um field-id dentro do metadata. Note que NÃO existe uma variante que
-- leia `datetime_value` — é intencional, ver o comentário de neg_parse_date.
CREATE OR REPLACE FUNCTION public.neg_field(p_metadata jsonb, p_field_id text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(p_metadata->p_field_id->>'value', '')
$$;

-- ⚠️⚠️ ESTA VERSÃO ESTÁ OBSOLETA — SUPERSEDIDA POR 20260803_negociacao_fase_unica.sql
--
-- A definição abaixo inclui DUAS fases. Está errada: `338815768` ("Pré - Triagem - 2°
-- Parcela") é do COMERCIAL, não da Negociação, e não é projeção do painel do CEO
-- (correção do dono em 2026-08-03). A versão válida tem SÓ `326422800`.
--
-- 🚨 ARMADILHA: se você reexecutar ESTE ARQUIVO depois da 20260803, este
-- `CREATE OR REPLACE` **desfaz a correção em silêncio** — nenhum erro, e a aba
-- Projeções volta a somar o dinheiro do Comercial (R$ 16.260,50 em vez de
-- R$ 10.000,00, medido em 03/ago). Já aconteceu uma vez.
--
-- Se precisar reaplicar esta migration, rode a 20260803 LOGO EM SEGUIDA. Conferência
-- rápida: `SELECT public.neg_is_waiting_phase('338815768');` tem que dar **false**.
CREATE OR REPLACE FUNCTION public.neg_is_waiting_phase(p_phase_id text)
RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_phase_id IN (
    '326422800',  -- "Aguardando pagamento ⏳💰"  — onde a cobrança atrasa
    '338815768'   -- ❌ OBSOLETO: é do Comercial. Ver 20260803.
  )
$$;

-- Resolve QUAL é a projeção do card, a partir dos dois sinais possíveis.
--
-- ⚠️ É COALESCE (o mais específico vence), NÃO soma. Motivo: um card pode ter os dois
-- preenchidos e eles NÃO são dívidas somáveis — o campo da fase é o pagamento
-- (re)combinado agora, e a 2ª parcela é o que a venda original previa. Exemplo real
-- (#1348129801): venda total 890,00, 2ª parcela 590,00 vencida em 28/05, e agora um
-- pagamento agendado de 1.500,00 pra 09/08. Somar daria 2.090,00 de "a receber" num
-- contrato de 890,00. O agendamento da fase SUPERSEDE a parcela antiga.
--
-- Prioridade:
--   1. campo da própria fase (`informe_o_valor_do_pagamento` + data agendada) — é o
--      sinal mais recente e mais específico. 8 dos 14 cards de 326422800.
--   2. 2ª parcela da venda — é o que sobra nos outros 6, e é o ÚNICO sinal em
--      338815768 (onde o campo da fase nunca é preenchido: 0 de 10).
--
-- Valor 0 não é projeção: descartado (mesma regra do Financeiro). Medido: 78 valores
-- "0,00" no campo da fase, todos em fases mortas (Distratos/Reversão/Falta de contato).
CREATE OR REPLACE FUNCTION public.neg_projection(p_metadata jsonb)
RETURNS TABLE (proj_value numeric, proj_date date, proj_source text)
LANGUAGE sql IMMUTABLE AS $$
  WITH sinais AS (
    SELECT
      1 AS prio,
      'fase'::text AS src,
      public.neg_parse_money(public.neg_field(p_metadata, 'informe_o_valor_do_pagamento')) AS v,
      public.neg_parse_date (public.neg_field(p_metadata, 'informe_a_data_agendada_para_o_pagamento_1')) AS d
    UNION ALL
    SELECT
      2,
      'parcela2',
      public.neg_parse_money(public.neg_field(p_metadata, 'valor_do_pagamento_da_2_parcela')),
      -- Duas fontes para a mesma data e elas concordam no dado real: o campo da fase
      -- 338815768 (`due_date`, "DD/MM/YYYY HH:MM") e o do start form (`date`,
      -- "DD/MM/YYYY"). O da fase vem primeiro por ser o que um reagendamento mexe.
      COALESCE(
        public.neg_parse_date(public.neg_field(p_metadata, 'data_do_pagamento_da_2_parcela')),
        public.neg_parse_date(public.neg_field(p_metadata, 'data_do_pagamento_da_parcela_2'))
      )
  )
  SELECT v, d, src
  FROM sinais
  WHERE v IS NOT NULL AND v <> 0 AND d IS NOT NULL
  ORDER BY prio
  LIMIT 1
$$;


-- ── PARTE 3 — RLS ───────────────────────────────────────────────────────────
-- Mesma estratégia do Financeiro: RLS ligado SEM policy de SELECT = nega tudo para
-- `authenticated`. O acesso acontece só pela RPC de leitura (SECURITY DEFINER +
-- guarda ceo_current_role()), que é a decisão do Sprint 0 — centralizar o CEO nas
-- RPCs em vez de espalhar 'ceo' pelo RLS de cada domínio. Escrita: só service_role.
-- Consequência: um `SELECT * FROM neg_cards` pelo app volta VAZIO de propósito.

ALTER TABLE public.neg_cards ENABLE ROW LEVEL SECURITY;


-- ── PARTE 4 — Ingestão ──────────────────────────────────────────────────────
-- Recebe o node CRU do Pipefy — mesmo formato que o Make e o backfill mandam
-- (scripts/import-negociacao.mjs). O mapeamento de field-ids vive SÓ aqui.
--
-- Ingere TODOS os cards do pipe, não só os das fases de espera: assim, quando um card
-- entra numa fase de espera, ele já está na tabela e o poll por delta do Make só
-- atualiza `current_phase_id`. Quem filtra fase é a RPC de leitura.
--
-- Idempotente: upsert por pipefy_card_id.
CREATE OR REPLACE FUNCTION public.ingest_negociacao_card(node jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pipefy_card_id text := node->>'id';
  v_metadata jsonb;
  v_neg_card_id uuid;
  v_paid boolean;
  -- Escalares, não `record`: `SELECT * INTO rec` de uma função que devolve ZERO linhas
  -- deixa o record em estado que é fácil de ler errado. Card sem projeção é o caso
  -- COMUM aqui (a grande maioria dos 3.342 cards), não a exceção.
  v_proj_value numeric;
  v_proj_date date;
  v_proj_source text;
BEGIN
  IF v_pipefy_card_id IS NULL THEN
    RAISE EXCEPTION 'ingest_negociacao_card: node sem id';
  END IF;

  -- metadata = todos os campos por field-id (mesma forma do cs_cards/fin_cards).
  SELECT jsonb_object_agg(
    f->'field'->>'id',
    jsonb_build_object(
      'name', f->>'name',
      'value', f->>'value',
      'array_value', f->'array_value',
      'datetime_value', f->>'datetime_value'
    )
  ) INTO v_metadata
  FROM jsonb_array_elements(COALESCE(node->'fields', '[]'::jsonb)) AS f
  WHERE f->'field'->>'id' IS NOT NULL;

  v_metadata := COALESCE(v_metadata, '{}'::jsonb);

  -- Só 'Sim' marca pago. Vazio e 'Não' são iguais aqui (5 dos 14 cards da fase estão
  -- com o campo vazio) — e o default seguro é PROJETAR, não sumir com o valor.
  v_paid := COALESCE(public.neg_field(v_metadata, 'o_pagamento_foi_reaizado'), '') = 'Sim';

  SELECT p.proj_value, p.proj_date, p.proj_source
    INTO v_proj_value, v_proj_date, v_proj_source
  FROM public.neg_projection(v_metadata) p;

  INSERT INTO public.neg_cards (
    pipefy_card_id, title, current_phase_id, current_phase,
    product, client_name, total_value, payment_method,
    proj_value, proj_date, proj_source, paid_flag,
    pipefy_created_at, pipefy_done, metadata, synced_at, updated_at
  ) VALUES (
    v_pipefy_card_id,
    node->>'title',
    node->'current_phase'->>'id',
    node->'current_phase'->>'name',
    public.neg_field(v_metadata, 'sele_o_de_lista'),
    public.neg_field(v_metadata, 'nome_completo'),
    public.neg_parse_money(public.neg_field(v_metadata, 'valor_da_cobran_a')),
    public.neg_field(v_metadata, 'forma_de_pagamento_do_cliente'),
    v_proj_value,
    v_proj_date,
    v_proj_source,
    v_paid,
    NULLIF(node->>'created_at', '')::timestamptz,
    (node->>'done')::boolean,
    v_metadata,
    now(),
    COALESCE(NULLIF(node->>'updated_at', '')::timestamptz, now())
  )
  ON CONFLICT (pipefy_card_id) DO UPDATE SET
    title = EXCLUDED.title,
    current_phase_id = EXCLUDED.current_phase_id,
    current_phase = EXCLUDED.current_phase,
    product = EXCLUDED.product,
    client_name = EXCLUDED.client_name,
    total_value = EXCLUDED.total_value,
    payment_method = EXCLUDED.payment_method,
    proj_value = EXCLUDED.proj_value,
    proj_date = EXCLUDED.proj_date,
    proj_source = EXCLUDED.proj_source,
    paid_flag = EXCLUDED.paid_flag,
    pipefy_done = EXCLUDED.pipefy_done,
    metadata = EXCLUDED.metadata,
    synced_at = now(),
    updated_at = EXCLUDED.updated_at
  RETURNING id INTO v_neg_card_id;

  RETURN jsonb_build_object(
    'neg_card_id', v_neg_card_id,
    'projected', COALESCE(v_proj_value IS NOT NULL AND NOT v_paid
                          AND public.neg_is_waiting_phase(node->'current_phase'->>'id'), false),
    'proj_source', v_proj_source,
    'paid', v_paid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_negociacao_card(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_negociacao_card(jsonb) TO service_role;


-- ── PARTE 5 — Leitura: projeções da NEGOCIAÇÃO ──────────────────────────────
-- SECURITY DEFINER + guarda ceo_current_role() (Sprint 0). Sem o papel certo devolve
-- NULL — a action degrada pra painel vazio.
--
-- Snapshot, não série: "quem deve, quanto e quando", olhando o presente. Por isso não
-- recebe p_start/p_end como o Financeiro — a janela aqui é de VENCIMENTO, calculada
-- contra hoje (em BRT, pelo mesmo motivo de src/lib/period.ts: o app roda em UTC no
-- Cloudflare e o corte do dia tem que ser o corte de Brasília).
CREATE OR REPLACE FUNCTION public.get_ceo_projecoes_negociacao()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date;
  v_result jsonb;
BEGIN
  IF public.ceo_current_role() NOT IN ('ceo', 'admin') THEN
    RETURN NULL;
  END IF;

  v_today := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  WITH base AS (
    SELECT
      c.pipefy_card_id,
      COALESCE(NULLIF(c.client_name, ''), c.title, 'Sem nome') AS client,
      COALESCE(c.product, 'Sem produto') AS product,
      c.current_phase_id,
      COALESCE(c.current_phase, 'Sem fase') AS phase,
      c.proj_value,
      c.proj_date,
      c.proj_source,
      c.total_value,
      -- Janela de vencimento. "vencida" é projeção também (decisão do dono): é
      -- dinheiro a receber, mas o CEO precisa ver que está atrasado.
      CASE
        WHEN c.proj_date <  v_today                       THEN 'vencida'
        WHEN c.proj_date <= v_today + 30                  THEN 'ate30'
        WHEN c.proj_date <= v_today + 90                  THEN 'd31a90'
        ELSE                                                   'mais90'
      END AS window_key
    FROM public.neg_cards c
    WHERE public.neg_is_waiting_phase(c.current_phase_id)
      -- pago = já está em fin_entries (conector "Lançar pagamento" → pipe do
      -- Financeiro). Projetar de novo contaria o mesmo dinheiro duas vezes.
      AND c.paid_flag = false
      AND c.proj_value IS NOT NULL
      AND c.proj_value <> 0
      AND c.proj_date IS NOT NULL
  )
  SELECT jsonb_build_object(
    'referenceDate', v_today,
    'total', COALESCE((SELECT SUM(proj_value) FROM base), 0),
    'count', (SELECT COUNT(*) FROM base),
    'byWindow', COALESCE((
      SELECT jsonb_object_agg(w.window_key, jsonb_build_object('total', w.total, 'count', w.count))
      FROM (
        SELECT window_key, SUM(proj_value) AS total, COUNT(*) AS count
        FROM base GROUP BY window_key
      ) w
    ), '{}'::jsonb),
    'byProduct', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', p.key, 'total', p.total, 'count', p.count)
                       ORDER BY p.total DESC)
      FROM (SELECT product AS key, SUM(proj_value) AS total, COUNT(*) AS count
            FROM base GROUP BY product) p
    ), '[]'::jsonb),
    -- ⚠️ A ordem tem que ser imposta no jsonb_agg, não num ORDER BY dentro da CTE:
    -- agregar sobre CTE ordenada NÃO garante a ordem do array (mesma lição do
    -- get_ceo_financeiro). A timeline depende da ordem cronológica.
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'source', 'negociacao',
        'pipefyCardId', pipefy_card_id,
        'client', client,
        'product', product,
        'phase', phase,
        'value', proj_value,
        'dueDate', proj_date,
        'window', window_key,
        'signal', proj_source,
        'totalValue', total_value
      ) ORDER BY proj_date, proj_value DESC)
      FROM base
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_ceo_projecoes_negociacao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ceo_projecoes_negociacao() TO authenticated;


-- ── PARTE 6 — Leitura: projeções do CS (reuso, sem schema novo) ─────────────
-- O CS já é ingerido (20260715_cs_pipeline_schema.sql) e a P4 já construiu o plano de
-- pagamento (20260730b_cs_pagamento.sql). Aqui só há uma RPC de LEITURA com a guarda
-- do CEO por cima dos mesmos dados — nenhuma tabela nova.
--
-- ⚠️ Os slugs são IRREGULARES (o dono duplicou os campos no Pipefy e viraram "copy_of"),
-- teto de 3 parcelas. NÃO são `valor_da_parcela`/`data_de_vencimento_da_parcela_do_cliente`
-- — esses são os campos das MINUTAS, outra coisa. Os certos, confirmados na
-- 20260730b_cs_pagamento.sql:
--     parcela 1: 1_parcela_valor          / 1_parcela_data_do_pagamento
--     parcela 2: copy_of_1_parcela_valor  / copy_of_1_parcela_data_do_pagamento
--     parcela 3: copy_of_2_parcela_valor  / copy_of_2_parcela_data_do_pagamento
--
-- ⚠️ MESMA DISCIPLINA ANTI-DUPLA-CONTAGEM DA NEGOCIAÇÃO. Os pagamentos realizados do CS
-- também viram card no pipe do Financeiro (relação "Subir pagamento") e portanto já
-- estão em `fin_entries`. Uma parcela que já tem pagamento correspondente em
-- `cs_card_payments` é REALIZADO, não projeção — sai daqui.
--
-- ⚠️ HOJE ESTA RPC VOLTA VAZIA, E ISSO É ESPERADO. Conferido ao vivo em 31/jul: a fase
-- "Aguardando Pagamento" (343781769) e o plano de pagamento não são usados pela operação
-- ainda (o dono apagou o card de teste que era a única linha). O bloqueio é de ADOÇÃO,
-- não de código: no dia em que a operação preencher o plano, esta RPC acende sozinha.
-- Reusa cs_parse_money/cs_parse_date (que já tratam DD/MM/YYYY desde a 20260730).
CREATE OR REPLACE FUNCTION public.get_ceo_projecoes_cs()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date;
  v_result jsonb;
BEGIN
  IF public.ceo_current_role() NOT IN ('ceo', 'admin') THEN
    RETURN NULL;
  END IF;

  v_today := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  WITH plano AS (
    SELECT
      c.id AS cs_card_id,
      c.pipefy_card_id,
      COALESCE(c.title, 'Sem nome') AS client,
      COALESCE(c.current_phase, 'Sem fase') AS phase,
      pl.n AS parcela_num,
      public.cs_parse_money(c.metadata->pl.value_field->>'value') AS valor,
      public.cs_parse_date (c.metadata->pl.date_field->>'value')  AS venc
    FROM public.cs_cards c
    LEFT JOIN public.cs_phases ph ON ph.id = c.current_phase_id
    -- CROSS JOIN simples (não LATERAL): a lista de parcelas é constante, não depende do card.
    CROSS JOIN (VALUES
      (1, '1_parcela_valor',         '1_parcela_data_do_pagamento'),
      (2, 'copy_of_1_parcela_valor', 'copy_of_1_parcela_data_do_pagamento'),
      (3, 'copy_of_2_parcela_valor', 'copy_of_2_parcela_data_do_pagamento')
    ) AS pl(n, value_field, date_field)
    -- Card em fase terminal não projeta nada: o contrato acabou.
    WHERE COALESCE(ph.is_terminal, false) = false
  ),
  base AS (
    SELECT
      p.pipefy_card_id,
      p.client,
      p.phase,
      p.parcela_num,
      p.valor,
      p.venc,
      CASE
        WHEN p.venc <  v_today      THEN 'vencida'
        WHEN p.venc <= v_today + 30 THEN 'ate30'
        WHEN p.venc <= v_today + 90 THEN 'd31a90'
        ELSE                             'mais90'
      END AS window_key
    FROM plano p
    WHERE p.valor IS NOT NULL AND p.valor <> 0 AND p.venc IS NOT NULL
      -- Parcela já paga = já virou card do Financeiro. Não é projeção.
      AND NOT EXISTS (
        SELECT 1 FROM public.cs_card_payments pay
        WHERE pay.cs_card_id = p.cs_card_id
          AND pay.parcela_num = p.parcela_num
      )
  )
  SELECT jsonb_build_object(
    'referenceDate', v_today,
    'total', COALESCE((SELECT SUM(valor) FROM base), 0),
    'count', (SELECT COUNT(*) FROM base),
    'byWindow', COALESCE((
      SELECT jsonb_object_agg(w.window_key, jsonb_build_object('total', w.total, 'count', w.count))
      FROM (
        SELECT window_key, SUM(valor) AS total, COUNT(*) AS count
        FROM base GROUP BY window_key
      ) w
    ), '{}'::jsonb),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'source', 'cs',
        'pipefyCardId', pipefy_card_id,
        'client', client,
        'product', 'Parcela ' || parcela_num,
        'phase', phase,
        'value', valor,
        'dueDate', venc,
        'window', window_key,
        'signal', 'plano',
        'totalValue', NULL
      ) ORDER BY venc, valor DESC)
      FROM base
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_ceo_projecoes_cs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ceo_projecoes_cs() TO authenticated;


-- ── PARTE 7 — Leitura combinada (o que a aba consome) ───────────────────────
-- Junta as duas fontes numa chamada só. O Worker faz 1 round-trip em vez de 2, e a
-- soma "CS + Negociação" acontece no Postgres, junto com a consolidação por janela.
-- Mantém os totais por fonte à parte — o CEO precisa saber de onde vem o dinheiro, e
-- enquanto o CS estiver zerado isso deixa a causa explícita na tela em vez de virar
-- um número que "parece baixo".
CREATE OR REPLACE FUNCTION public.get_ceo_projecoes()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_neg jsonb;
  v_cs jsonb;
  v_items jsonb;
  v_today date;
BEGIN
  IF public.ceo_current_role() NOT IN ('ceo', 'admin') THEN
    RETURN NULL;
  END IF;

  v_today := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_neg := COALESCE(public.get_ceo_projecoes_negociacao(), '{}'::jsonb);
  v_cs  := COALESCE(public.get_ceo_projecoes_cs(), '{}'::jsonb);

  v_items := COALESCE(v_neg->'items', '[]'::jsonb) || COALESCE(v_cs->'items', '[]'::jsonb);

  RETURN jsonb_build_object(
    'referenceDate', v_today,
    'total', COALESCE((v_neg->>'total')::numeric, 0) + COALESCE((v_cs->>'total')::numeric, 0),
    'count', COALESCE((v_neg->>'count')::int, 0) + COALESCE((v_cs->>'count')::int, 0),
    'negociacao', jsonb_build_object(
      'total', COALESCE((v_neg->>'total')::numeric, 0),
      'count', COALESCE((v_neg->>'count')::int, 0)
    ),
    'cs', jsonb_build_object(
      'total', COALESCE((v_cs->>'total')::numeric, 0),
      'count', COALESCE((v_cs->>'count')::int, 0)
    ),
    'byProduct', COALESCE(v_neg->'byProduct', '[]'::jsonb),
    -- Consolida as janelas das duas fontes somando chave a chave.
    'byWindow', COALESCE((
      SELECT jsonb_object_agg(k, jsonb_build_object(
        'total', COALESCE((v_neg->'byWindow'->k->>'total')::numeric, 0)
               + COALESCE((v_cs ->'byWindow'->k->>'total')::numeric, 0),
        'count', COALESCE((v_neg->'byWindow'->k->>'count')::int, 0)
               + COALESCE((v_cs ->'byWindow'->k->>'count')::int, 0)
      ))
      FROM unnest(ARRAY['vencida', 'ate30', 'd31a90', 'mais90']) AS k
    ), '{}'::jsonb),
    'items', v_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_ceo_projecoes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ceo_projecoes() TO authenticated;

COMMENT ON FUNCTION public.get_ceo_projecoes() IS
  'Projeções de pagamento (CS + Negociação) para o painel do CEO (guarda ceo/admin). Só dinheiro NÃO recebido — o realizado já está em fin_entries. Ver docs/projetopainelceo-docs/updates/introspeccao-pipefy-negociacao.md';


-- ── Conferir depois de aplicar ──────────────────────────────────────────────
-- 1) Parsers e helpers nasceram? (o de data é o que mais importa aqui)
--      SELECT public.neg_parse_date('06/08/2026 21:00');  -- esperado: 2026-08-06 (NÃO 08-07)
--      SELECT public.neg_parse_date('07/08/2026');        -- esperado: 2026-08-07
--      SELECT public.neg_parse_money('1.166,66');         -- esperado: 1166.66
--      SELECT public.neg_is_waiting_phase('326422800');   -- esperado: true
--      SELECT public.neg_is_waiting_phase('328305421');   -- esperado: false (Distratos)
--
-- 2) Depois do backfill (npm run import:negociacao):
--      SELECT count(*) FROM public.neg_cards;                    -- esperado: ~3342
--      SELECT proj_source, count(*) FROM public.neg_cards
--        WHERE public.neg_is_waiting_phase(current_phase_id) AND NOT paid_flag
--        GROUP BY proj_source;
--      -- esperado: as duas origens presentes ('fase' e 'parcela2')
--
-- 3) O número que prova que o filtro de pago está funcionando:
--      SELECT paid_flag, count(*), sum(proj_value)
--      FROM public.neg_cards WHERE current_phase_id = '326422800' GROUP BY paid_flag;
--      -- esperado: paid_flag=true somando ~6.500 (já em fin_entries, NÃO projetar)
--      --           paid_flag=false somando ~4.000 (a projeção de verdade)
