-- ============================================================================
-- CS — Página 2 (Equipe): ATUALIZAÇÃO por QUEM COMENTOU + fim do bloco MOVIMENTO
-- ============================================================================
-- Decisão do dono (2026-08-19), em dois tempos na mesma sessão.
--
-- 1) O painel creditava "atualização" ao DONO do card (`responsible_agent_id`), não a
--    quem agiu: o Charles fez 52 comentários em 34 cards em ago/26 e a tela mostrava 3
--    — dos 34 cards, a maioria é da Mayara, da Larissa, ou não tem responsável nenhum.
--
-- 2) Vendo o resultado, o dono cortou o bloco de MOVIMENTO inteiro: "não vamos mais
--    trabalhar com movido / com atualização e etc. Apenas atualizado." A tabela de
--    movimento (recebidos + os 4 buckets moveu×comentou) SAI, e o que dela interessa
--    (cards recebidos + tamanho da carteira) sobe pra tabela de atualizações.
--
-- Resultado: `get_cs_team` passa a devolver DUAS seções, não três.
--   · `activity`   — NOVA. Uma linha por PESSOA: atualizações, cards tocados,
--                    recebidos no período e carteira atual.
--   · `negotiations` — INALTERADA (idêntica à 20260731b). É a única que continua com
--                    a lógica de completa/parcial/incompleta, por decisão explícita.
-- As chaves `movement` e `movementTotals` DEIXAM DE EXISTIR no jsonb.
--
-- ⚠ Migration de LEITURA pura: não toca em ingestão, não pede nada do Make, e vale
--   RETROATIVO sobre todo o histórico já gravado.
--
-- Por que dá pra fazer só na leitura: `ingest_cs_card` já grava o autor de cada
-- comentário desde a 20260722 (`cs_card_comments.author_pipefy_id` + `author_name`,
-- vindos de `comments { author { id name } author_name }` na GraphQL). Cobertura
-- medida em 2026-08-19: 16.295 comentários, ZERO sem author_pipefy_id, ZERO sem
-- author_name, de 29/abr/2025 até hoje. O dado sempre esteve lá; a RPC é que o
-- descartava ao fazer `SELECT DISTINCT cs_card_id`.
--
-- ── Granularidade (requisito explícito do dono) ─────────────────────────────
-- 1 COMENTÁRIO = 1 ATUALIZAÇÃO. Não é "cards tocados" nem "último comentário do
-- card": o drill tem que mostrar EXATAMENTE os comentários que compuseram o número,
-- porque pode haver comentário de outra pessoa depois no mesmo card. Por isso o
-- jsonb desce em três níveis — autor -> card -> os comentários DAQUELE autor naquele
-- card no período, cada um com id/data/texto. Quem clica sempre chega no comentário
-- contabilizado, nunca num "mais recente" que é de outra pessoa.
--
-- Volume medido (2026-08-19), que é o que torna seguro mandar tudo de uma vez em
-- vez de um drill preguiçoso: pior ciclo = 884 comentários; texto com média de 100
-- chars, p95 251, máx 985 -> ~68 KB. Se um dia isso crescer uma ordem de grandeza,
-- o caminho é cortar `text` daqui e buscar sob demanda — NÃO paginar a pessoa.
--
-- ── A chave da tabela é o ID DO USUÁRIO NO PIPEFY ──────────────────────────
-- Não o nome (muda, e quebraria a série) e não `cs_agents.id`. Isso importa porque a
-- linha agora mistura DOIS mundos que antes eram tabelas separadas:
--   · atualizações vêm de `cs_card_comments.author_pipefy_id`;
--   · recebidos/carteira vêm de `cs_cards.responsible_agent_id` -> `cs_agents.id`.
-- O ponto de encontro é `cs_agents.pipefy_user_id` = `author_pipefy_id`. O join é
-- LEFT dos dois lados de propósito:
--   · quem COMENTA mas nunca é assignee (Laura Siqueira, Gustavo Farias = 91 dos
--     1000 comentários mais recentes) não tem linha em `cs_agents` e sumiria se o
--     join fosse interno — aparece com recebidos/carteira = 0;
--   · quem TEM CARTEIRA mas não comentou no período aparece com atualizações = 0.
--     Essa linha é o que sobrou de útil do antigo bucket "Sem mover/atualizar":
--     mostra quem está sentado em cima de cards sem tocar neles.
--
-- Carteira = cards NÃO-TERMINAIS (mesma coorte que o movimento usava). Card em
-- Quitados/Distratos/Concluído/Arquivado/Distribuição não é mais responsabilidade
-- viva de ninguém; contá-lo inflaria a coluna com trabalho já encerrado.
--
-- RLS: `get_cs_team` é SECURITY INVOKER (default). `cs_card_comments` e `cs_cards` já
-- têm policy de SELECT escopada (20260715/20260722), então a seção nova herda o mesmo
-- recorte por papel/departamento. Nada a fazer aqui.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_cs_team(p_start timestamptz, p_end timestamptz)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH
  -- ── ATIVIDADE no período, por QUEM COMENTOU ────────────────────────────────
  -- Independe de responsabilidade: o card pode ser de qualquer um (ou de ninguém).
  act_raw AS (
    SELECT k.id, k.cs_card_id, k.author_pipefy_id, k.author_name, k.text, k.created_at
    FROM public.cs_card_comments k
    WHERE k.created_at >= p_start AND k.created_at < p_end
  ),
  -- Nível 1: autor × card. `comments` guarda os comentários DAQUELE autor naquele
  -- card — é o que garante que o drill nunca caia no "último comentário do card".
  act_by_card AS (
    SELECT
      r.author_pipefy_id,
      r.cs_card_id,
      count(*) AS updates,
      max(r.created_at) AS last_at,
      jsonb_agg(jsonb_build_object(
        'commentId', r.id,
        'createdAt', r.created_at,
        'text', r.text
      ) ORDER BY r.created_at DESC) AS comments
    FROM act_raw r
    GROUP BY r.author_pipefy_id, r.cs_card_id
  ),
  -- Nível 2: autor. O nome vem do comentário mais recente do autor no período
  -- (a chave é o id; o nome é só rótulo e pode ter mudado ao longo do tempo).
  act_names AS (
    SELECT
      r.author_pipefy_id,
      (array_agg(r.author_name ORDER BY r.created_at DESC))[1] AS author_name
    FROM act_raw r
    GROUP BY r.author_pipefy_id
  ),
  act_agent AS (
    SELECT
      b.author_pipefy_id,
      sum(b.updates)::bigint AS updates,
      count(*)::bigint       AS cards,
      jsonb_agg(jsonb_build_object(
        'pipefyCardId', c.pipefy_card_id,
        'title', c.title,
        'currentPhase', c.current_phase,
        'responsibleName', COALESCE(ag.pipefy_name, 'Sem responsável'),
        'updates', b.updates,
        'comments', b.comments
      ) ORDER BY b.updates DESC, b.last_at DESC) AS cards_json
    FROM act_by_card b
    JOIN public.cs_cards c ON c.id = b.cs_card_id
    LEFT JOIN public.cs_agents ag ON ag.id = c.responsible_agent_id
    GROUP BY b.author_pipefy_id
  ),

  -- ── Recebidos e carteira: vêm do eixo do ASSIGNEE, remapeados pro id do Pipefy ──
  received AS (
    SELECT ag.pipefy_user_id, count(*)::bigint AS n
    FROM public.cs_card_assignee_events a
    JOIN public.cs_agents ag ON ag.id = a.to_agent_id
    WHERE a.occurred_at >= p_start AND a.occurred_at < p_end
    GROUP BY ag.pipefy_user_id
  ),
  portfolio AS (
    SELECT ag.pipefy_user_id, count(*)::bigint AS n
    FROM public.cs_cards c
    JOIN public.cs_agents ag ON ag.id = c.responsible_agent_id
    LEFT JOIN public.cs_phases ph ON ph.id = c.current_phase_id
    WHERE COALESCE(ph.is_terminal, false) = false
    GROUP BY ag.pipefy_user_id
  ),

  -- União das três origens: quem comentou, quem recebeu, quem tem carteira. UNION
  -- (não ALL) já deduplica — inclusive o NULL, se um dia aparecer comentário sem
  -- autor, pra soma da coluna nunca divergir do total cru.
  people AS (
    SELECT author_pipefy_id AS pipefy_user_id FROM act_raw
    UNION
    SELECT pipefy_user_id FROM received
    UNION
    SELECT pipefy_user_id FROM portfolio
  ),
  person_name AS (
    SELECT
      p.pipefy_user_id,
      COALESCE(n.author_name, ag.pipefy_name, 'Autor não identificado') AS name
    FROM people p
    LEFT JOIN act_names n ON n.author_pipefy_id IS NOT DISTINCT FROM p.pipefy_user_id
    LEFT JOIN public.cs_agents ag ON ag.pipefy_user_id = p.pipefy_user_id
  ),
  activity AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'authorId', pn.pipefy_user_id,
        'authorName', pn.name,
        'updates', COALESCE(a.updates, 0),
        'cards', COALESCE(a.cards, 0),
        'received', COALESCE(rc.n, 0),
        'portfolio', COALESCE(pf.n, 0),
        'cardsList', COALESCE(a.cards_json, '[]'::jsonb)
      )
      ORDER BY COALESCE(a.updates, 0) DESC, COALESCE(pf.n, 0) DESC, pn.name ASC
    ), '[]'::jsonb) AS arr
    FROM person_name pn
    LEFT JOIN act_agent a ON a.author_pipefy_id IS NOT DISTINCT FROM pn.pipefy_user_id
    LEFT JOIN received  rc ON rc.pipefy_user_id = pn.pipefy_user_id
    LEFT JOIN portfolio pf ON pf.pipefy_user_id = pn.pipefy_user_id
  ),
  act_totals AS (
    SELECT jsonb_build_object(
      -- `cards` é DISTINCT no período inteiro: dois autores no mesmo card contam 1.
      -- Por isso NÃO é a soma da coluna `cards` da tabela — e tem que ser assim,
      -- senão o KPI do topo não bateria com a realidade.
      'updates', (SELECT count(*) FROM act_raw),
      'cards',   (SELECT count(DISTINCT cs_card_id) FROM act_raw),
      'people',  (SELECT count(DISTINCT author_pipefy_id) FROM act_raw),
      'received', (SELECT COALESCE(sum(n), 0) FROM received),
      'portfolio', (SELECT COALESCE(sum(n), 0) FROM portfolio)
    ) AS obj
  ),

  -- ── Negociações feitas NO PERÍODO — INALTERADO (idêntico à 20260731b) ──────
  -- Única seção que segue com completa/parcial/incompleta, por decisão do dono.
  neg_snap AS (
    SELECT DISTINCT ON (s.cs_card_id) s.cs_card_id, s.negotiator
    FROM public.cs_negotiation_snapshots s
    WHERE s.captured_at >= p_start AND s.captured_at < p_end
      AND COALESCE(array_length(s.changed_fields, 1), 0) > 0
    ORDER BY s.cs_card_id, s.captured_at DESC
  ),
  neg_cards AS (
    SELECT
      c.pipefy_card_id, c.title,
      NULLIF(btrim(COALESCE(
        ns.negotiator,
        NULLIF(c.metadata->'quem_realizou_a_negocia_o'->>'value', ''),
        NULLIF(c.metadata->'quem_realizou_a_negocia_o'->'array_value'->>0, ''),
        ''
      )), '') AS negotiator,
      public.cs_field_filled(c.metadata, 'q_d_valor_da_quita_o_com_desconto')            AS f_qd,
      public.cs_field_filled(c.metadata, 'q_a_valor_da_quita_o_atualizada_sem_desconto') AS f_qa,
      public.cs_field_filled(c.metadata, 'p_a_parcelas_em_atraso')                       AS f_pa,
      public.cs_field_filled(c.metadata, 'p_p_parcelas_a_pagar')                         AS f_pp,
      public.cs_field_filled(c.metadata, 'p_v_parcelas_vencer')                          AS f_pv
    FROM public.cs_cards c
    JOIN neg_snap ns ON ns.cs_card_id = c.id
  ),
  neg_final AS (
    SELECT
      pipefy_card_id, title, negotiator,
      array_remove(ARRAY[
        CASE WHEN f_qd = 0 THEN 'Q.D' END,
        CASE WHEN f_qa = 0 THEN 'Q.A' END,
        CASE WHEN f_pa = 0 THEN 'P.A' END,
        CASE WHEN f_pp = 0 THEN 'P.P' END,
        CASE WHEN f_pv = 0 THEN 'P.V' END
      ]::text[], NULL) AS missing,
      CASE
        WHEN (f_qd + f_qa + f_pa + f_pp + f_pv) = 5 THEN 'completa'
        WHEN (f_qd + f_qa + f_pa + f_pp + f_pv) BETWEEN 3 AND 4 AND f_qd = 1 THEN 'parcial'
        ELSE 'incompleta'
      END AS cls
    FROM neg_cards
  ),
  neg_agent AS (
    SELECT
      nf.negotiator,
      count(*) AS total,
      count(*) FILTER (WHERE cls = 'completa')   AS completa,
      count(*) FILTER (WHERE cls = 'parcial')    AS parcial,
      count(*) FILTER (WHERE cls = 'incompleta') AS incompleta,
      jsonb_agg(jsonb_build_object(
        'pipefyCardId', nf.pipefy_card_id,
        'title', nf.title,
        'cls', nf.cls,
        'missing', to_jsonb(nf.missing)
      ) ORDER BY nf.cls, nf.title) AS cards
    FROM neg_final nf
    GROUP BY nf.negotiator
  ),
  negotiations AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'negotiator', na.negotiator,
        'negotiatorName', COALESCE(na.negotiator, 'Sem responsável pela negociação'),
        'total', na.total,
        'completa', na.completa,
        'parcial', na.parcial,
        'incompleta', na.incompleta,
        'cards', na.cards
      )
      ORDER BY na.total DESC, na.negotiator ASC NULLS LAST
    ), '[]'::jsonb) AS arr
    FROM neg_agent na
  ),
  neg_totals AS (
    SELECT jsonb_build_object(
      'total', COALESCE(sum(total), 0),
      'completa', COALESCE(sum(completa), 0),
      'parcial', COALESCE(sum(parcial), 0),
      'incompleta', COALESCE(sum(incompleta), 0)
    ) AS obj
    FROM neg_agent
  )
  SELECT jsonb_build_object(
    'periodStart', p_start,
    'periodEnd', p_end,
    'activity', (SELECT arr FROM activity),
    'activityTotals', (SELECT obj FROM act_totals),
    'negotiations', (SELECT arr FROM negotiations),
    'negotiationTotals', (SELECT obj FROM neg_totals)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_cs_team(timestamptz, timestamptz) TO authenticated;

-- ── Índice de apoio ─────────────────────────────────────────────────────────
-- A seção nova filtra por created_at (já indexado na 20260722) e agrupa por autor.
-- Este composto cobre o agrupamento sem varrer as 16k linhas por autor.
CREATE INDEX IF NOT EXISTS cs_card_comments_author_created_idx
  ON public.cs_card_comments (author_pipefy_id, created_at);

-- ── Conferir depois de aplicar ──────────────────────────────────────────────
-- 1) A tabela nova credita por AUTOR e traz recebidos/carteira na mesma linha
--    (esperado em ago/26: Charles com 52 atualizações em 34 cards, não 3 — e
--    Laura/Gustavo aparecendo mesmo sem serem assignee de nada):
--    SELECT x->>'authorName' AS nome, x->'updates' AS atualizacoes,
--           x->'cards' AS cards, x->'received' AS recebidos, x->'portfolio' AS carteira
--    FROM jsonb_array_elements(
--      get_cs_team('2026-08-01T03:00:00Z', '2026-09-01T03:00:00Z') -> 'activity'
--    ) x;
--
-- 2) A soma da coluna bate com a contagem crua (prova que ninguém se perdeu no
--    agrupamento em 3 níveis nem na união das três origens de pessoa):
--    SELECT get_cs_team('2026-08-01T03:00:00Z','2026-09-01T03:00:00Z') -> 'activityTotals';
--    SELECT count(*) FROM cs_card_comments
--     WHERE created_at >= '2026-08-01T03:00:00Z' AND created_at < '2026-09-01T03:00:00Z';
--
-- 3) As chaves de movimento SUMIRAM e negociações continua igual:
--    SELECT get_cs_team('2026-08-01T03:00:00Z','2026-09-01T03:00:00Z') ? 'movement';  -- false
--    SELECT get_cs_team('2026-08-01T03:00:00Z','2026-09-01T03:00:00Z') -> 'negotiationTotals';
