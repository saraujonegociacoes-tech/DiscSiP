-- ============================================================================
-- Painel do CEO — Saúde da empresa v2: por DEPARTAMENTO e por PESSOA
-- ============================================================================
-- Reformulação da aba (decisões do dono em 05/ago). O conceito da aba passa a ser
-- **quanto cada departamento e cada colaborador coloca para dentro, contra quanto
-- custam** — não mais um scorecard de cinco domínios.
--
-- Sai: bloco de TI (Monday) e bloco de operação (Discador). Nenhum dos dois responde
-- "quanto essa pessoa trouxe", que é a pergunta da aba.
--
-- ── As 3 decisões do dono ───────────────────────────────────────────────────
--   1. Custo = por pessoa, com um CUSTO GERAL padrão para quem não tiver o próprio.
--   2. A "pessoa" é o nome do Pipefy (campo Vendedor), não o usuário do Blue Desk.
--   3. O cartão mostra receita, custo e margem (não múltiplo).
--
-- ── De onde sai a receita por pessoa ────────────────────────────────────────
-- Do campo `respons_vel_pelo_pagamento` do pipe Financeiro (rótulo "Vendedor" no
-- Pipefy), que já está em `fin_cards.metadata` — nada novo a ingerir. O valor é o
-- mesmo `fin_entries` da aba Financeiro, com o mesmo sinal e o mesmo filtro de fase
-- cancelada, para que as duas abas não possam divergir.
--
-- ⚠️ COBERTURA, medida ao vivo em 05/ago — leia antes de confiar no total por pessoa:
--   · 2026 inteiro: 94% do valor tem Vendedor (R$ 1.715.898,67 de R$ 1.833.957,26)
--   · julho/2026:  100%
--   · histórico completo: só 28% dos CARDS têm o campo — os antigos não usavam
-- Ou seja: a soma das pessoas **não fecha** com o total do departamento em períodos
-- antigos. Por isso a RPC devolve `semVendedor` à parte, com o que sobrou sem dono —
-- a diferença aparece na tela como uma linha explícita, em vez de virar um total que
-- "não bate" sem explicação.
--
-- ⚠️ A mesma pessoa aparece em MAIS DE UM departamento (Charles, Larissa, Leonardo,
-- Gustavo). É correto: o departamento é do CARD, não da pessoa. Ela entra na lista
-- dos dois, com a receita de cada um. O custo, esse, é da pessoa — e por isso é
-- rateado entre os departamentos dela na proporção da receita, senão o mesmo salário
-- seria cobrado duas vezes e a margem da empresa sairia menor do que é.
--
-- Idempotente. Cria 2 tabelas e 4 funções; não altera nada do que já existe.
-- ============================================================================

BEGIN;

-- ── PARTE 1 — Custo por pessoa ──────────────────────────────────────────────
-- Chave = nome do Pipefy normalizado (ver fin_vendedor abaixo). Sem FK para
-- `profiles` de propósito: a maioria dessas 34 pessoas não tem login no Blue Desk.
-- `profile_id` fica como ponte OPCIONAL para a Sprint 4, quando a identidade for
-- unificada — preencher depois não quebra nada aqui.
CREATE TABLE IF NOT EXISTS public.ceo_pessoa_custo (
  pessoa       text PRIMARY KEY,
  departamento text,                       -- informativo; a receita manda no agrupamento
  custo_mensal numeric(12,2) NOT NULL CHECK (custo_mensal >= 0),
  profile_id   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ativo        boolean NOT NULL DEFAULT true,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.ceo_pessoa_custo IS
  'Custo mensal por colaborador (chave = nome do Vendedor no Pipefy). Painel do CEO, aba Saúde da Empresa.';

-- ── PARTE 2 — Custo geral (singleton) ───────────────────────────────────────
-- Uma linha só, garantida pelo CHECK em `id`: aplicado a quem não tem custo próprio.
-- Padrão 0 para que a aba nasça sem inventar número — margem = receita até o dono
-- configurar, e a tela diz quantas pessoas estão sem custo definido.
CREATE TABLE IF NOT EXISTS public.ceo_custo_config (
  id          boolean PRIMARY KEY DEFAULT true CHECK (id),
  custo_geral numeric(12,2) NOT NULL DEFAULT 0 CHECK (custo_geral >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

INSERT INTO public.ceo_custo_config (id, custo_geral) VALUES (true, 0)
ON CONFLICT (id) DO NOTHING;

-- ── PARTE 3 — RLS ───────────────────────────────────────────────────────────
-- Custo de pessoa é dado sensível: RLS ligado e NENHUMA policy de SELECT, igual a
-- fin_cards/neg_cards. Ninguém lê direto — só as RPCs SECURITY DEFINER com guarda
-- ceo/admin. Escrita idem, pela RPC de gravação.
ALTER TABLE public.ceo_pessoa_custo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ceo_custo_config ENABLE ROW LEVEL SECURITY;

-- ── PARTE 4 — O nome do Vendedor, normalizado ───────────────────────────────
-- O campo é um assignee_select: o `value` vem como STRING de array JSON
-- (`["Esther Vitoria Caldas Castro"]`), não como array. E os nomes vêm com espaço no
-- fim em vários cards ("Felipe Dylan Dias Da Silva ") — mesma sujeira de nome que o
-- painel de Leads já tinha achado no Pipefy em 2026-07. Sem o trim, a mesma pessoa
-- vira duas linhas na tela.
CREATE OR REPLACE FUNCTION public.fin_vendedor(p_metadata jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(btrim(COALESCE(
    -- caso normal: value é a string '["Nome"]'
    (SELECT btrim(x #>> '{}')
     FROM jsonb_array_elements(
       CASE WHEN left(btrim(p_metadata #>> '{respons_vel_pelo_pagamento,value}'), 1) = '['
            THEN (p_metadata #>> '{respons_vel_pelo_pagamento,value}')::jsonb
            ELSE '[]'::jsonb END
     ) x
     LIMIT 1),
    -- fallback: alguém gravou o nome cru, sem array
    p_metadata #>> '{respons_vel_pelo_pagamento,value}'
  )), '')
$$;

-- ── PARTE 5 — Leitura: saúde por departamento e por pessoa ──────────────────
-- Substitui o corpo de get_ceo_saude_empresa (mesma assinatura, então a action e a
-- aba continuam apontando para cá).
--
-- ⚠️ Isto é um CREATE OR REPLACE de uma função que a 20260804 também define. Vale a
-- regra que já mordeu este projeto duas vezes: **a última migration que rodar vence**.
-- Reexecutar a 20260804 depois desta traz de volta o scorecard de 5 domínios, em
-- silêncio. Conferência barata:
--   SELECT public.get_ceo_saude_empresa(now()-interval '30 days', now()) ? 'departamentos';
--   -- tem que ser TRUE (a versão velha não tem essa chave)
CREATE OR REPLACE FUNCTION public.get_ceo_saude_empresa(p_start timestamptz, p_end timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start   date;
  v_end     date;      -- EXCLUSIVO
  v_fator   numeric;   -- quantos "meses" o período vale, para ratear o custo mensal
  v_geral   numeric;
  v_result  jsonb;
BEGIN
  IF public.ceo_current_role() NOT IN ('ceo', 'admin') THEN
    RETURN NULL;
  END IF;

  v_start := (p_start AT TIME ZONE 'America/Sao_Paulo')::date;
  v_end   := (p_end   AT TIME ZONE 'America/Sao_Paulo')::date;

  -- Rateio do custo: o custo cadastrado é MENSAL e o período é livre. O fator é
  -- (dias do período ÷ dias do mês civil em que ele começa). Escolhido assim porque
  -- dá exatamente 1,0 no caso que o dono mais usa — o mês civil inteiro, que é o
  -- default do seletor. Dividir por 30 fixo daria 1,03 em julho e o custo apareceria
  -- inflado num mês normal.
  v_fator := GREATEST(v_end - v_start, 0)::numeric
             / EXTRACT(DAY FROM (date_trunc('month', v_start) + interval '1 month - 1 day'))::numeric;

  SELECT custo_geral INTO v_geral FROM public.ceo_custo_config WHERE id;
  v_geral := COALESCE(v_geral, 0);

  WITH
  -- Receita por pessoa × departamento. MESMA base da aba Financeiro (fin_entries com
  -- sinal, sem a fase de cancelado) — as duas abas não podem divergir sobre dinheiro.
  base AS (
    SELECT
      public.fin_vendedor(c.metadata)                    AS pessoa,
      COALESCE(c.department, 'Sem departamento')         AS depto,
      e.entry_value * public.fin_entry_sign(c.category)  AS v
    FROM public.fin_entries e
    JOIN public.fin_cards c ON c.id = e.fin_card_id
    WHERE c.current_phase_id IS DISTINCT FROM '327456661'
      AND e.entry_date >= v_start AND e.entry_date < v_end
  ),
  com_dono AS (SELECT * FROM base WHERE pessoa IS NOT NULL),
  sem_dono AS (SELECT * FROM base WHERE pessoa IS NULL),

  -- Receita da pessoa em cada departamento…
  pessoa_depto AS (
    SELECT pessoa, depto, SUM(v) AS receita, COUNT(*) AS pagamentos
    FROM com_dono GROUP BY pessoa, depto
  ),
  -- …e no total, para ratear o custo dela entre os departamentos. Sem isto, quem
  -- atende dois departamentos teria o salário contado duas vezes.
  pessoa_total AS (
    SELECT pessoa, SUM(receita) AS receita_total FROM pessoa_depto GROUP BY pessoa
  ),
  -- Custo mensal de cada pessoa: o próprio, ou o geral.
  custo AS (
    SELECT
      pt.pessoa,
      COALESCE(pc.custo_mensal, v_geral) AS custo_mensal,
      (pc.pessoa IS NOT NULL)            AS custo_proprio,
      pt.receita_total
    FROM pessoa_total pt
    LEFT JOIN public.ceo_pessoa_custo pc
      ON lower(btrim(pc.pessoa)) = lower(pt.pessoa) AND pc.ativo
  ),
  linhas AS (
    SELECT
      pd.depto,
      pd.pessoa,
      pd.receita,
      pd.pagamentos,
      cu.custo_proprio,
      -- Rateio do custo entre os departamentos da pessoa, na proporção da receita.
      -- Receita total zero (ou negativa) não dá proporção: nesse caso o custo inteiro
      -- fica no departamento — não some.
      ROUND(
        cu.custo_mensal * v_fator *
        CASE WHEN cu.receita_total > 0 THEN pd.receita / cu.receita_total ELSE 1 END
      , 2) AS custo
    FROM pessoa_depto pd
    JOIN custo cu ON cu.pessoa = pd.pessoa
  ),
  por_depto AS (
    SELECT
      depto,
      SUM(receita)      AS receita,
      SUM(custo)        AS custo,
      COUNT(*)          AS pessoas,
      SUM(pagamentos)   AS pagamentos,
      jsonb_agg(jsonb_build_object(
        'nome',         pessoa,
        'receita',      receita,
        'custo',        custo,
        'margem',       receita - custo,
        'pagamentos',   pagamentos,
        'custoProprio', custo_proprio
      ) ORDER BY receita DESC) AS people
    FROM linhas GROUP BY depto
  ),
  -- Receita sem Vendedor preenchido, por departamento. É a diferença entre o total do
  -- Financeiro e a soma das pessoas — mostrada, nunca escondida.
  orfa AS (
    SELECT COALESCE(SUM(v), 0) AS receita, COUNT(*) AS pagamentos FROM sem_dono
  )

  SELECT jsonb_build_object(
    'periodStart',   to_char(v_start, 'YYYY-MM-DD'),
    'periodEnd',     to_char(v_end,   'YYYY-MM-DD'),
    'referenceDate', to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD'),
    'fatorMes',      ROUND(v_fator, 3),
    'custoGeral',    v_geral,
    'totais', jsonb_build_object(
      'receita', COALESCE((SELECT SUM(receita) FROM por_depto), 0)
                 + COALESCE((SELECT receita FROM orfa), 0),
      'custo',   COALESCE((SELECT SUM(custo)   FROM por_depto), 0),
      'pessoas', COALESCE((SELECT COUNT(*) FROM pessoa_total), 0),
      'semCusto',(SELECT COUNT(*) FROM custo WHERE NOT custo_proprio)
    ),
    -- ⚠️ ORDER BY dentro do jsonb_agg: agregar sobre CTE ordenada não garante ordem.
    'departamentos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'nome',       depto,
        'receita',    receita,
        'custo',      custo,
        'margem',     receita - custo,
        'pessoas',    pessoas,
        'pagamentos', pagamentos,
        'people',     people
      ) ORDER BY receita DESC) FROM por_depto
    ), '[]'::jsonb),
    'semVendedor', jsonb_build_object(
      'receita',    (SELECT receita    FROM orfa),
      'pagamentos', (SELECT pagamentos FROM orfa)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_ceo_saude_empresa(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ceo_saude_empresa(timestamptz, timestamptz) TO authenticated;

-- ── PARTE 6 — Gravação dos custos ───────────────────────────────────────────
-- Duas RPCs de escrita, com a MESMA guarda das de leitura. São as únicas portas:
-- as tabelas têm RLS sem policy, então o app não escreve direto.
CREATE OR REPLACE FUNCTION public.set_ceo_custo_geral(p_valor numeric)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.ceo_current_role() NOT IN ('ceo', 'admin') THEN RETURN NULL; END IF;
  IF p_valor IS NULL OR p_valor < 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'valor inválido');
  END IF;

  INSERT INTO public.ceo_custo_config (id, custo_geral, updated_at, updated_by)
  VALUES (true, p_valor, now(), auth.uid())
  ON CONFLICT (id) DO UPDATE
    SET custo_geral = EXCLUDED.custo_geral, updated_at = now(), updated_by = auth.uid();

  RETURN jsonb_build_object('ok', true, 'custoGeral', p_valor);
END;
$$;

-- p_valor NULL apaga o custo próprio da pessoa: ela volta a herdar o geral. É o
-- "desfazer" — sem isso, zerar um custo cadastrado só dá para fazer no SQL.
CREATE OR REPLACE FUNCTION public.set_ceo_pessoa_custo(p_pessoa text, p_valor numeric)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pessoa text := btrim(COALESCE(p_pessoa, ''));
BEGIN
  IF public.ceo_current_role() NOT IN ('ceo', 'admin') THEN RETURN NULL; END IF;
  IF v_pessoa = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'pessoa vazia'); END IF;

  IF p_valor IS NULL THEN
    DELETE FROM public.ceo_pessoa_custo WHERE lower(btrim(pessoa)) = lower(v_pessoa);
    RETURN jsonb_build_object('ok', true, 'pessoa', v_pessoa, 'custo', NULL);
  END IF;

  IF p_valor < 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'valor inválido'); END IF;

  INSERT INTO public.ceo_pessoa_custo (pessoa, custo_mensal, updated_at, updated_by)
  VALUES (v_pessoa, p_valor, now(), auth.uid())
  ON CONFLICT (pessoa) DO UPDATE
    SET custo_mensal = EXCLUDED.custo_mensal, ativo = true,
        updated_at = now(), updated_by = auth.uid();

  RETURN jsonb_build_object('ok', true, 'pessoa', v_pessoa, 'custo', p_valor);
END;
$$;

REVOKE ALL ON FUNCTION public.set_ceo_custo_geral(numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_ceo_pessoa_custo(text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_ceo_custo_geral(numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_ceo_pessoa_custo(text, numeric) TO authenticated;

COMMIT;

-- ============================================================================
-- Conferir depois de aplicar
-- ============================================================================
-- 1) A versão NOVA da função está valendo? (a velha não tem 'departamentos')
--      SELECT public.get_ceo_saude_empresa(now()-interval '30 days', now()) ? 'departamentos';
--      -- TRUE. Se vier FALSE, a 20260804 rodou depois desta e desfez — reaplique.
--
-- 2) O nome do Vendedor está saindo limpo (sem colchete, sem aspas, sem espaço)?
--      SELECT DISTINCT public.fin_vendedor(metadata) FROM public.fin_cards
--      WHERE metadata ? 'respons_vel_pelo_pagamento' LIMIT 10;
--      -- esperado: 'Esther Vitoria Caldas Castro', não '["Esther ... "]'
--
-- 3) A soma das pessoas + semVendedor bate com a aba Financeiro no mesmo período?
--      -- (julho/2026 tem 100% de cobertura, então semVendedor deve ser 0)
--      SELECT public.get_ceo_financeiro('2026-07-01T03:00:00Z','2026-08-01T03:00:00Z') ->> 'total';
--
-- 4) Guarda: como service_role as 3 funções novas devolvem NULL?
--      SELECT public.get_ceo_saude_empresa(now()-interval '30 days', now());  -- NULL
--      SELECT public.set_ceo_custo_geral(1000);                               -- NULL (não grava)
--
-- 5) Conferência automatizada:  npm run verify:saude-empresa
-- ============================================================================
