-- ============================================================================
-- Painel de Sucesso do Cliente (CS) — Página 3: Controle de Minutas
-- ============================================================================
-- Reformulação 2026-07-21 (ver docs/updates/painel-sucesso-cliente-cs.md): 3ª aba
-- do painel de 4 páginas. SNAPSHOT de estado ATUAL (como a P1) — sem filtro de
-- período. Domínio SEPARADO do comercial.
--
-- Mapeamento confirmado pelo dono (2026-07-27, pendência #4 resolvida): NÃO existe
-- URL de minuta (a minuta fica anexada no card → a UI usa a URL do próprio card).
--   • valor da minuta (Q.D, com desconto) = `valor_resguardados_dos_clientes` (currency)
--   • dívida original de entrada (fixa)    = `d_vida_atual_do_cliente`         (currency)
--   • vencimento da minuta                 = `data_da_quita_o`                 (date)
--   • etiqueta de desconto (candidato)     = `sele_o_de_etiqueta`
-- Todos vivem em cs_cards.metadata (jsonb keyed por field-id; valor `value` texto —
-- ver a RPC ingest_cs_card na migration 20260715). O % de desconto é mostrado de duas
-- formas na UI: DERIVADO (1 − Q.D/dívida) e a etiqueta marcada.
--
-- Peças:
--   1. cs_parse_money / cs_parse_date — parsers tolerantes (nunca lançam: exceção → NULL),
--      porque `metadata.value` é texto livre do Pipefy.
--   2. get_cs_minutas() — devolve, numa chamada só (jsonb), os cards escopados pelo RLS
--      que TÊM minuta (data de quitação preenchida), com valor/dívida/desconto/etiqueta/
--      vencimento/dias-até-vencer. Os buckets (Vencidas/Mensal/Trimestral/Semestral/180+),
--      as somas e o drill acontecem no cliente (src/features/cs/components/CsMinutas.tsx).
-- ============================================================================

-- ── 1. Parsers tolerantes de campo (metadata.value é texto) ──────────────────
-- Currency do Pipefy vem como decimal com ponto ("12345.67"); tratamos também o
-- formato brasileiro ("12.345,67") por segurança. Qualquer coisa inesperada → NULL,
-- pra a RPG nunca quebrar num card com valor sujo.
CREATE OR REPLACE FUNCTION public.cs_parse_money(raw text)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s text;
BEGIN
  IF raw IS NULL THEN RETURN NULL; END IF;
  s := trim(raw);
  IF s = '' THEN RETURN NULL; END IF;
  -- Formato br "1.234,56": tira separador de milhar e troca a vírgula decimal por ponto.
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

-- Date do Pipefy vem "YYYY-MM-DD" (campo type=date). Pega os 10 primeiros chars pra
-- tolerar um datetime ("YYYY-MM-DDThh:mm"). Qualquer coisa inesperada → NULL.
CREATE OR REPLACE FUNCTION public.cs_parse_date(raw text)
RETURNS date
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF raw IS NULL OR trim(raw) = '' THEN RETURN NULL; END IF;
  RETURN left(trim(raw), 10)::date;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- ── 2. Leitura da Página 3 (controle de minutas) ─────────────────────────────
-- SECURITY INVOKER (default): o RLS de cs_cards já escopa por papel+departamento
-- (agente = o próprio card, supervisor = o departamento de CS, manager/admin = tudo,
-- quem não é do CS = nada). A função só resume o que o RLS deixou passar.
--
-- STABLE + jsonb numa linha só: mesmo truque da get_cs_matrix — agrega no Postgres pra
-- não puxar tabela inteira pro Worker (teto do PostgREST / erro 1102, ver
-- docs/fixes/correcao-cpu-cloudflare-1102.md).
--
-- "Tem minuta" = tem data de quitação (vencimento). Cards sem essa data entram só na
-- contagem `withoutMinuta` (contexto: negociações ainda sem minuta emitida), não na lista.
-- daysToDue = vencimento − hoje (negativo = vencida). descontoPct = (1 − Q.D/dívida)·100.
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
      public.cs_parse_date(COALESCE(
        NULLIF(c.metadata->'data_da_quita_o'->>'value', ''),
        NULLIF(c.metadata->'data_da_quita_o'->>'datetime_value', '')
      )) AS due_date,
      COALESCE(
        NULLIF(c.metadata->'sele_o_de_etiqueta'->>'value', ''),
        NULLIF(c.metadata->'sele_o_de_etiqueta'->'array_value'->>0, '')
      ) AS etiqueta
    FROM public.cs_cards c
    LEFT JOIN public.cs_phases ph ON ph.id = c.current_phase_id
    LEFT JOIN public.cs_agents ag ON ag.id = c.responsible_agent_id
  )
  SELECT jsonb_build_object(
    'referenceAt', now(),
    'withoutMinuta', (SELECT count(*) FROM base WHERE due_date IS NULL),
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
          'descontoPct', CASE
            WHEN b.divida IS NOT NULL AND b.divida > 0 AND b.valor IS NOT NULL
              THEN round((1 - b.valor / b.divida) * 100, 1)
            ELSE NULL
          END,
          'etiqueta', b.etiqueta,
          'dueDate', b.due_date,
          'daysToDue', (b.due_date - CURRENT_DATE)
        )
        -- vencidas / mais próximas primeiro: a lista já herda a ordem útil.
        ORDER BY b.due_date ASC
      )
      FROM base b
      WHERE b.due_date IS NOT NULL
    ), '[]'::jsonb)
  );
$$;

-- Front chama como authenticated; o RLS (invoker) faz o escopo. Não é SECURITY DEFINER,
-- então não há risco de escalonamento.
GRANT EXECUTE ON FUNCTION public.get_cs_minutas() TO authenticated;

-- ── Conferir depois de aplicar ──────────────────────────────────────────────
-- SELECT jsonb_array_length(get_cs_minutas() -> 'cards');            -- nº de minutas visíveis
-- SELECT get_cs_minutas() -> 'withoutMinuta';                        -- cards sem data de quitação
-- SELECT get_cs_minutas() -> 'cards' -> 0;                           -- espiar um card (valor/venc/desconto)
