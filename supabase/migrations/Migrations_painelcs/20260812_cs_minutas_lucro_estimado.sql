-- ============================================================================
-- Painel de CS — Página 3 (Minutas): "Lucro Estimado" por card
-- ============================================================================
-- PEDIDO DO DONO (12/ago/2026):
--
--   Lucro Estimado = Valor da Minuta Final − Última Negociação
--
-- Ou seja: o que o cliente paga pela minuta emitida (`valor_resguardados_dos_clientes`)
-- menos o Q.D real fechado na fase de negociação (`q_d_valor_da_quita_o_com_desconto`).
-- O spread entre os dois é o ganho bruto estimado da operação naquele card.
--
-- ── Por que derivar AQUI, e não no cliente ──────────────────────────────────
-- Mesma escolha que a 20260727d já fez pro `descontoPct` (1 − valor/dívida): os dois
-- operandos já viajam no payload, mas a REGRA mora num lugar só — greppável, conferível
-- com um SELECT e igual pra tabela, KPI, insight e CSV. Se a fórmula do lucro mudar,
-- muda aqui e só aqui; nenhum componente recalcula por conta própria.
--
-- ── Quando é NULL (e por que não é zero) ────────────────────────────────────
-- Só existe lucro quando os DOIS lados estão preenchidos e > 0. O Pipefy guarda "0,00"
-- em campo não preenchido — é o mesmo motivo pelo qual o resguardo da 20260727d ignora
-- `valor_de_resguardo_N = 0`, e a mesma guarda que o insight "última negociação abaixo
-- da minuta final" já usa no cliente (`> 0` nos dois lados). Sem essa guarda, um card
-- com negociação vazia viraria "lucro = minuta inteira" e inflaria o KPI da carteira.
-- NULL = "não dá pra estimar"; a tela mostra "—" e a soma simplesmente não conta o card.
--
-- ⚠️ SINAL: o resultado pode ser NEGATIVO (negociação fechada ACIMA da minuta emitida).
-- Isso não é erro de dado, é prejuízo estimado — o cliente pinta em vermelho e levanta
-- um insight próprio. Não usar `GREATEST(..., 0)` aqui: esconderia justamente o caso
-- que o dono precisa enxergar.
--
-- Idempotente (CREATE OR REPLACE). Não altera tabela, coluna nem policy. Nada é gravado:
-- o valor é resolvido NA LEITURA, então trocar a função já muda a aba na próxima chamada
-- — sem backfill, sem reingestão, sem re-rodar o Make.
--
-- ⚠️ ARMADILHA (a mesma da 20260811): a `20260727d_cs_minutas_negociacao.sql` tem um
-- `CREATE OR REPLACE` da MESMA `get_cs_minutas()`, na versão sem o lucro. Reexecutar
-- aquele arquivo DEPOIS deste desfaz esta migration **em silêncio** (sem erro — a coluna
-- só volta a ficar vazia). Esta migration é a ÚLTIMA palavra sobre essa RPC; se precisar
-- reaplicar a 20260727d, rode esta logo em seguida.
--
-- Forward-only: não editar a 20260727d. Auto-contida: redefine a função inteira, não
-- depende de a b/c/d terem rodado (mas depende dos parsers `cs_parse_money`/
-- `cs_parse_date` da 20260727).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_cs_minutas()
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT
      c.pipefy_card_id,
      c.title,
      c.responsible_agent_id,
      ag.pipefy_name AS agent_name,
      c.current_phase_id,
      COALESCE(c.current_phase, 'Sem fase') AS phase_name,
      COALESCE(ph.is_terminal, false) AS is_terminal,
      public.cs_parse_money(c.metadata->'valor_resguardados_dos_clientes'->>'value') AS valor,
      public.cs_parse_money(c.metadata->'d_vida_atual_do_cliente'->>'value') AS divida,
      public.cs_parse_money(c.metadata->'q_d_valor_da_quita_o_com_desconto'->>'value') AS ultima_negociacao,
      public.cs_parse_date(COALESCE(
        NULLIF(c.metadata->'data_da_quita_o'->>'value', ''),
        NULLIF(c.metadata->'data_da_quita_o'->>'datetime_value', '')
      )) AS due_date,
      COALESCE(
        NULLIF(c.metadata->'sele_o_de_etiqueta'->>'value', ''),
        NULLIF(c.metadata->'sele_o_de_etiqueta'->'array_value'->>0, '')
      ) AS etiqueta,
      rg.resguardo,
      rg.resguardo_month
    FROM public.cs_cards c
    LEFT JOIN public.cs_phases ph ON ph.id = c.current_phase_id
    LEFT JOIN public.cs_agents ag ON ag.id = c.responsible_agent_id
    LEFT JOIN LATERAL (
      -- Maior N de `valor_de_resguardo_N` com valor > 0 (ignora "0,00"). UM valor por card.
      SELECT
        public.cs_parse_money(kv.value->>'value') AS resguardo,
        (regexp_replace(kv.key, '\D', '', 'g'))::int AS resguardo_month
      FROM jsonb_each(c.metadata) kv
      WHERE kv.key ~ '^valor_de_resguardo_[0-9]+$'
        AND public.cs_parse_money(kv.value->>'value') > 0
      ORDER BY (regexp_replace(kv.key, '\D', '', 'g'))::int DESC
      LIMIT 1
    ) rg ON true
  )
  SELECT jsonb_build_object(
    'referenceAt', now(),
    'withoutMinuta', (SELECT count(*) FROM base WHERE due_date IS NULL),
    'resguardo', jsonb_build_object(
      'active', jsonb_build_object(
        'total', COALESCE((SELECT sum(resguardo) FROM base WHERE resguardo IS NOT NULL AND NOT is_terminal), 0),
        'count', (SELECT count(*) FROM base WHERE resguardo IS NOT NULL AND NOT is_terminal)
      ),
      'inactive', jsonb_build_object(
        'total', COALESCE((SELECT sum(resguardo) FROM base WHERE resguardo IS NOT NULL AND is_terminal), 0),
        'count', (SELECT count(*) FROM base WHERE resguardo IS NOT NULL AND is_terminal)
      )
    ),
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
          'valor', b.valor,
          'divida', b.divida,
          'ultimaNegociacao', b.ultima_negociacao,
          -- NOVO (20260812): Minuta Final − Última Negociação. Só com os dois lados
          -- preenchidos e > 0 (ver cabeçalho); pode ser negativo = prejuízo estimado.
          -- CASE sem ELSE devolve NULL, e comparação com NULL não é TRUE — logo card
          -- sem um dos lados cai naturalmente em NULL.
          'lucroEstimado', CASE
            WHEN b.valor > 0 AND b.ultima_negociacao > 0
              THEN round(b.valor - b.ultima_negociacao, 2)
          END,
          'descontoPct', CASE
            WHEN b.divida IS NOT NULL AND b.divida > 0 AND b.valor IS NOT NULL
              THEN round((1 - b.valor / b.divida) * 100, 1)
            ELSE NULL
          END,
          'etiqueta', b.etiqueta,
          'resguardo', b.resguardo,
          'resguardoMonth', b.resguardo_month,
          'dueDate', b.due_date,
          'daysToDue', (b.due_date - CURRENT_DATE)
        )
        ORDER BY b.due_date ASC
      )
      FROM base b
      WHERE b.due_date IS NOT NULL
    ), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_cs_minutas() TO authenticated;

COMMENT ON FUNCTION public.get_cs_minutas() IS
  'Página 3 do painel de CS (Controle de Minutas). Snapshot dos cards com data de quitação. lucroEstimado = Valor da Minuta Final − Última Negociação, só com os dois lados > 0 (pedido do dono, 2026-08-12); pode ser negativo.';

COMMIT;

-- ============================================================================
-- Conferir depois de aplicar
-- ============================================================================
-- 1) O campo existe e a conta bate (compara o derivado com a subtração crua):
--      SELECT c->>'title'                        AS cliente,
--             (c->>'valor')::numeric             AS minuta_final,
--             (c->>'ultimaNegociacao')::numeric  AS ultima_negociacao,
--             (c->>'lucroEstimado')::numeric     AS lucro
--      FROM jsonb_array_elements(public.get_cs_minutas()->'cards') c
--      WHERE c->>'lucroEstimado' IS NOT NULL
--      ORDER BY 4 DESC
--      LIMIT 10;
--
-- 2) Nenhuma linha pode sair com a conta errada (tem que ser ZERO):
--      SELECT count(*)
--      FROM jsonb_array_elements(public.get_cs_minutas()->'cards') c
--      WHERE c->>'lucroEstimado' IS NOT NULL
--        AND (c->>'lucroEstimado')::numeric
--            <> round((c->>'valor')::numeric - (c->>'ultimaNegociacao')::numeric, 2);
--
-- 3) Nenhum card com um dos lados vazio/zero pode ter lucro (tem que ser ZERO):
--      SELECT count(*)
--      FROM jsonb_array_elements(public.get_cs_minutas()->'cards') c
--      WHERE c->>'lucroEstimado' IS NOT NULL
--        AND (COALESCE((c->>'valor')::numeric, 0) <= 0
--          OR COALESCE((c->>'ultimaNegociacao')::numeric, 0) <= 0);
--
-- 4) Cobertura + carteira (quantos cards estimam lucro, e quanto dá no total):
--      SELECT count(*)                                              AS cards_com_minuta,
--             count(*) FILTER (WHERE c->>'lucroEstimado' IS NOT NULL) AS com_lucro,
--             count(*) FILTER (WHERE (c->>'lucroEstimado')::numeric < 0) AS negativos,
--             sum((c->>'lucroEstimado')::numeric)                   AS lucro_total
--      FROM jsonb_array_elements(public.get_cs_minutas()->'cards') c;
--
-- 5) O resto da P3 não mexeu (resguardo e % desconto seguem iguais):
--      SELECT public.get_cs_minutas()->'resguardo';
-- ============================================================================
