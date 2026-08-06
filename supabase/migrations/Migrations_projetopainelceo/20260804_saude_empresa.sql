-- ============================================================================
-- Painel do CEO — Sprint 3: Saúde da empresa (get_ceo_saude_empresa)
-- ============================================================================
-- Scorecard executivo compondo CINCO domínios que já existem, cada um com o seu
-- schema isolado. Esta função NÃO cria tabela nenhuma: é camada de LEITURA, o que
-- a Sprint 0 travou como arquitetura do painel (ver
-- docs/projetopainelceo-docs/updates/painel-ceo-sprints.md).
--
--   1. financeiro → fin_entries    (entradas do período)
--   2. comercial  → v_lead_progress(conversão do funil de leads)
--   3. cs         → cs_cards/eventos (carteira, movimento, quitações × distratos)
--   4. ti         → monday_tasks   (ritmo de entrega)
--   5. operacao   → call_logs      (volume do discador)
--
-- ── Três decisões de desenho, e o porquê de cada uma ────────────────────────
--
-- (A) O BLOCO FINANCEIRO DELEGA para get_ceo_financeiro em vez de repetir a regra.
--     A regra de "quanto entrou" tem 3 partes que já morderam (sinal por categoria,
--     fase de cancelado fora, uma linha por PAGAMENTO e não por card). Copiá-la
--     para cá criaria duas fontes de verdade que divergiriam no dia em que uma
--     mudasse — e o sintoma seria a aba Saúde discordando da aba Financeiro do
--     MESMO painel, que é a pior forma de perder a confiança do leitor.
--     Custo: get_ceo_financeiro também calcula série de 12 meses e duplicidades,
--     que aqui não são usadas. É barato (≈5 mil linhas) e vale a garantia.
--
-- (B) SECURITY DEFINER lendo as tabelas base, NUNCA as RPCs de cada domínio.
--     get_leads_dashboard, get_cs_team e afins são SECURITY INVOKER: o RLS do
--     chamador vale. E o papel `ceo` NÃO está em nenhuma policy de leads/cs/monday
--     (decisão da Sprint 0: não espalhar 'ceo' pelo RLS de cada domínio). Chamá-las
--     como CEO devolveria ZERO — não erro, zero. Por isso lemos as tabelas daqui,
--     com a guarda concentrada nesta função.
--
-- (C) TODO BLOCO DEVOLVE `lastActivityAt`. Um KPI zerado é ambíguo: "não aconteceu
--     nada no período" e "a fonte parou de mandar dado" desenham exatamente a mesma
--     tela. A data da última atividade transforma o zero em CAUSA. É a generalização
--     da lição da Sprint 2 (a aba Projeções mostra o total por ORIGEM justamente
--     para o zero do CS aparecer como causa, em vez de virar um número que "parece
--     baixo").
--
--     Isso vale para as cinco fontes o tempo todo, e não porque alguma esteja
--     parada agora: elas ligam e desligam. Prova disso está logo abaixo.
--
-- ⚠️ FOTO DAS CINCO FONTES — leia antes de achar que a aba está quebrada, e leia a
--    DATA junto: isto é medição pontual, não característica do sistema.
--
--    Em 04/ago/2026:
--      · financeiro  5.359 entradas, a última no dia          → saudável
--      · comercial   5.209 leads, 882 criados em 30d          → saudável
--      · cs          1.492 cards, 834 eventos em 30d          → saudável
--      · ti             30 tarefas no total (24 concluídas)   → BAIXO VOLUME
--      · operacao    zero chamadas em 7 dias, a última em 23/jul, 12 campanhas
--                    em `draft`                               → fonte muda
--
--    Em 05/ago/2026, um dia depois: o discador **voltou** — 19 chamadas, todas na
--    tarde de 04/ago (nenhuma atendida), com as campanhas ainda em `draft`. A
--    conferência da véspera dizia "parado há 12 dias"; a do dia seguinte não
--    acusou nenhuma fonte muda.
--
--    A moral, que é o motivo de (C) existir: **o estado das fontes muda de um dia
--    para o outro, e nenhuma delas avisa.** Não escreva "a fonte X está parada" em
--    lugar nenhum como se fosse permanente — quem responde isso é o
--    `lastActivityAt` na hora da leitura. Para saber o estado de hoje, rode
--    `npm run verify:saude-empresa` e olhe a seção FRESCOR DAS FONTES.
--
--    O que continua valendo do que foi medido: o `ti` é o backlog do próprio Blue
--    Desk (nasceu em 27/jul) — o indicador é real, mas com algumas dezenas de
--    tarefas serve para acompanhar ritmo, não para tirar tendência.
--
-- Idempotente (CREATE OR REPLACE). Não toca em dado nem em policy.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_ceo_saude_empresa(p_start timestamptz, p_end timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_len        interval;
  v_prev_start timestamptz;
  v_today      date;        -- "hoje" em BRT: quem corta o dia é o Postgres, não o
                            -- Worker (que roda em UTC na Cloudflare)
  v_fin        jsonb;
  v_result     jsonb;
BEGIN
  -- ⚠️ Guarda: idioma copiado das outras RPCs do painel. Só é seguro porque
  -- ceo_current_role() NUNCA devolve NULL — se devolvesse, `NULL NOT IN (...)` seria
  -- NULL, o IF não entraria e a guarda LIBERARIA. Foi um bug real, corrigido na
  -- origem em 20260731c_ceo_guard_null_safe.sql (docs/.../fixes/correcao-guarda-ceo-null.md).
  IF public.ceo_current_role() NOT IN ('ceo', 'admin') THEN
    RETURN NULL;
  END IF;

  -- Janela anterior = mesmo comprimento, imediatamente antes. Mesma convenção de
  -- get_ceo_financeiro, para os deltas das duas abas significarem a mesma coisa.
  v_len        := p_end - p_start;
  v_prev_start := p_start - v_len;
  v_today      := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  -- ── (A) Financeiro — delegado, ver nota (A) no cabeçalho ───────────────────
  v_fin := public.get_ceo_financeiro(p_start, p_end);

  WITH
  -- ── Dias BRT do período (série dos sparklines, zero-preenchida) ────────────
  -- Mesmo idioma de get_leads_timeseries: `end` é EXCLUSIVO, então o último dia
  -- do eixo é end − 1 dia.
  days AS (
    SELECT gs::date AS day
    FROM generate_series(
      (p_start AT TIME ZONE 'America/Sao_Paulo')::date::timestamp,
      ((p_end   AT TIME ZONE 'America/Sao_Paulo')::date - interval '1 day'),
      interval '1 day'
    ) gs
  ),

  -- ── (1) FINANCEIRO: só a série diária (os totais vêm de v_fin) ─────────────
  -- entry_date é `date`, não timestamptz — comparar com o limite já convertido a
  -- BRT, igual get_ceo_financeiro faz.
  fin_dia AS (
    SELECT e.entry_date AS day,
           SUM(e.entry_value * public.fin_entry_sign(c.category)) AS v
    FROM public.fin_entries e
    JOIN public.fin_cards c ON c.id = e.fin_card_id
    WHERE c.current_phase_id IS DISTINCT FROM '327456661'  -- "Pagamento cancelado" fora
      AND e.entry_date >= (p_start AT TIME ZONE 'America/Sao_Paulo')::date
      AND e.entry_date <  (p_end   AT TIME ZONE 'America/Sao_Paulo')::date
    GROUP BY 1
  ),
  fin_ultimo AS (
    SELECT MAX(e.entry_date) AS d
    FROM public.fin_entries e
    JOIN public.fin_cards c ON c.id = e.fin_card_id
    WHERE c.current_phase_id IS DISTINCT FROM '327456661'
  ),

  -- ── (2) COMERCIAL (Leads) ─────────────────────────────────────────────────
  -- Recebidos por created_at; ganhos/mortos por finalized_at. Essa assimetria é
  -- DE PROPÓSITO e é a mesma de get_leads_won_by_sale_date: um lead criado no
  -- ciclo passado e vendido neste é ganho DESTE período — contar ganho por
  -- created_at faz um dia de vendas reais aparecer como zero (bug corrigido em
  -- 17/jul). Consequência a assumir na leitura: a taxa de conversão que a aba
  -- deriva destes dois números (won ÷ received) NÃO é conversão de coorte —
  -- numerador e denominador são conjuntos diferentes de leads. Por isso a taxa
  -- não sai daqui pronta: é uma divisão que precisa do rótulo junto.
  lead_rec AS (
    SELECT count(*) AS n FROM public.v_lead_progress
    WHERE created_at >= p_start AND created_at < p_end
  ),
  lead_rec_prev AS (
    SELECT count(*) AS n FROM public.v_lead_progress
    WHERE created_at >= v_prev_start AND created_at < p_start
  ),
  lead_fim AS (
    SELECT count(*) FILTER (WHERE is_won)  AS won,
           count(*) FILTER (WHERE is_dead) AS dead
    FROM public.v_lead_progress
    WHERE finalized_at >= p_start AND finalized_at < p_end
      AND (is_won OR is_dead)
  ),
  lead_fim_prev AS (
    SELECT count(*) FILTER (WHERE is_won)  AS won,
           count(*) FILTER (WHERE is_dead) AS dead
    FROM public.v_lead_progress
    WHERE finalized_at >= v_prev_start AND finalized_at < p_start
      AND (is_won OR is_dead)
  ),
  -- Foto do agora (não do período): quantos estão abertos e quantos estouraram a
  -- cadência de acionamento (is_stuck = now() − created_at > sla_hours da fase).
  lead_foto AS (
    SELECT count(*) FILTER (WHERE is_open)                AS abertos,
           count(*) FILTER (WHERE is_open AND is_stuck)   AS parados
    FROM public.v_lead_progress
  ),
  -- Velocidade de resposta dos leads NASCIDOS no período. Só quem já teve 1º
  -- contato entra (os sem contato não têm tempo definido; contar "até agora"
  -- puxaria a média para cima e misturaria backlog com velocidade).
  --
  -- ⚠️ `>= 0` NÃO é paranoia: sem ele a média sai NEGATIVA. Existe lead retroativo
  -- — a vendedora pega um lead antigo, cria o card hoje e preenche o 1º contato com
  -- a data real, anterior à criação. O painel de Leads já tratou isso em 08/jul
  -- (FILTER hours_to_first_contact >= 0 em 20260708_leads_dashboard_fixes.sql) e
  -- aqui tem que ser a MESMA regra, senão as duas telas discordam. Medido em
  -- 04/ago, sem o filtro a média do mês dava −22,0 h.
  lead_1contato AS (
    SELECT ROUND(AVG(hours_to_first_contact)::numeric, 1) AS h
    FROM public.v_lead_progress
    WHERE created_at >= p_start AND created_at < p_end
      AND hours_to_first_contact >= 0
  ),
  lead_dia AS (
    SELECT (created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day, count(*) AS v
    FROM public.v_lead_progress
    WHERE created_at >= p_start AND created_at < p_end
    GROUP BY 1
  ),
  lead_ultimo AS (
    SELECT MAX(occurred_at) AS t FROM public.lead_events
  ),

  -- ── (3) CS (carteira) ─────────────────────────────────────────────────────
  -- "Ativo" = fase não terminal, a mesma classificação data-driven de
  -- cs_phases.is_terminal usada por get_cs_matrix (20260721_cs_age_windows.sql).
  cs_ativos AS (
    SELECT count(*) AS n
    FROM public.cs_cards c
    LEFT JOIN public.cs_phases ph ON ph.id = c.current_phase_id
    WHERE COALESCE(ph.is_terminal, false) = false
  ),
  -- Fases que NÃO contam como movimento — mesma regra de get_cs_team
  -- (20260723_cs_team_v2.sql): entrar ou sair de "Negociação do Cliente" ou de
  -- "Aguardando Pagamento" é etapa administrativa, não movimento de carteira.
  cs_excl AS (
    SELECT id, name FROM public.cs_phases WHERE is_negotiation OR exclude_from_movement
  ),
  -- ⚠️ A origem é conferida por ID **e por NOME**, os dois, exatamente como get_cs_team
  -- faz. Não é redundância defensiva: 1.506 dos 1.617 eventos (93%) têm `from_phase_id`
  -- NULL, e 14 deles trazem só o `from_phase` (o nome). Checar apenas o id deixaria esses
  -- 14 passarem como movimento quando a origem é uma fase administrativa.
  cs_mov AS (
    SELECT count(DISTINCT e.cs_card_id) AS n
    FROM public.cs_card_events e
    WHERE e.occurred_at >= p_start AND e.occurred_at < p_end
      AND e.to_phase_id NOT IN (SELECT id FROM cs_excl)
      AND COALESCE(e.from_phase_id, '') NOT IN (SELECT id FROM cs_excl)
      AND COALESCE(e.from_phase, '')    NOT IN (SELECT name FROM cs_excl)
  ),
  cs_mov_prev AS (
    SELECT count(DISTINCT e.cs_card_id) AS n
    FROM public.cs_card_events e
    WHERE e.occurred_at >= v_prev_start AND e.occurred_at < p_start
      AND e.to_phase_id NOT IN (SELECT id FROM cs_excl)
      AND COALESCE(e.from_phase_id, '') NOT IN (SELECT id FROM cs_excl)
      AND COALESCE(e.from_phase, '')    NOT IN (SELECT name FROM cs_excl)
  ),
  -- Desfecho da carteira. Ids fixos, não nomes: nome de fase do Pipefy já veio com
  -- espaço no fim neste projeto (ver S0 de leads), id é a única chave estável.
  --   337186300 = Quitados   ·   338460922 = Distratos
  -- Os dois juntos são o sinal de saúde mais direto do CS: em 30 dias (medido em
  -- 04/ago) foram 18 quitações contra 70 distratos.
  cs_desfecho AS (
    SELECT count(*) FILTER (WHERE e.to_phase_id = '337186300') AS quitados,
           count(*) FILTER (WHERE e.to_phase_id = '338460922') AS distratos
    FROM public.cs_card_events e
    WHERE e.occurred_at >= p_start AND e.occurred_at < p_end
  ),
  cs_desfecho_prev AS (
    SELECT count(*) FILTER (WHERE e.to_phase_id = '337186300') AS quitados,
           count(*) FILTER (WHERE e.to_phase_id = '338460922') AS distratos
    FROM public.cs_card_events e
    WHERE e.occurred_at >= v_prev_start AND e.occurred_at < p_start
  ),
  -- "Negociação feita" = CARD com snapshot no período em que algum dos 5 campos
  -- mudou de verdade — definição do dono, já travada em get_cs_team
  -- (20260723_cs_team_v2.sql). Duas cópias exatas da regra de lá:
  --   · conta cards DISTINTOS, não snapshots (renegociar o mesmo card 3x no mês é
  --     um card negociado, não três);
  --   · changed_fields é text[] (não jsonb) e vazio = recaptura sem alteração, que
  --     não conta — daí COALESCE(array_length(...,1), 0) > 0.
  cs_negoc AS (
    SELECT count(DISTINCT s.cs_card_id) AS n FROM public.cs_negotiation_snapshots s
    WHERE s.captured_at >= p_start AND s.captured_at < p_end
      AND COALESCE(array_length(s.changed_fields, 1), 0) > 0
  ),
  cs_negoc_prev AS (
    SELECT count(DISTINCT s.cs_card_id) AS n FROM public.cs_negotiation_snapshots s
    WHERE s.captured_at >= v_prev_start AND s.captured_at < p_start
      AND COALESCE(array_length(s.changed_fields, 1), 0) > 0
  ),
  cs_dia AS (
    SELECT (e.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
           count(DISTINCT e.cs_card_id) AS v
    FROM public.cs_card_events e
    WHERE e.occurred_at >= p_start AND e.occurred_at < p_end
      AND e.to_phase_id NOT IN (SELECT id FROM cs_excl)
      AND COALESCE(e.from_phase_id, '') NOT IN (SELECT id FROM cs_excl)
      AND COALESCE(e.from_phase, '')    NOT IN (SELECT name FROM cs_excl)
    GROUP BY 1
  ),
  cs_ultimo AS (
    SELECT MAX(occurred_at) AS t FROM public.cs_card_events
  ),

  -- ── (4) TI (Monday/Projetos) ──────────────────────────────────────────────
  -- Concluída = completed_at dentro do período. Usar completed_at (e não
  -- updated_at) é o que torna "ritmo de entrega" comparável entre períodos.
  -- Não precisa filtrar por status: o trigger monday_sync_task_completed_at
  -- (20260723d_monday.sql) preenche completed_at ao entrar em 'done' e o ZERA ao
  -- sair, então `completed_at IS NOT NULL` ⟺ `status = 'done'`. Mesma leitura que
  -- o burndown das sprints já faz.
  ti_feitas AS (
    SELECT count(*) AS n, COALESCE(SUM(estimate), 0) AS pts
    FROM public.monday_tasks
    WHERE completed_at >= p_start AND completed_at < p_end
  ),
  ti_feitas_prev AS (
    SELECT count(*) AS n, COALESCE(SUM(estimate), 0) AS pts
    FROM public.monday_tasks
    WHERE completed_at >= v_prev_start AND completed_at < p_start
  ),
  -- Foto do agora. Tarefa arquivada sai das duas contas: está fora do fluxo.
  ti_foto AS (
    SELECT count(*) FILTER (WHERE status <> 'done')                             AS abertas,
           count(*) FILTER (WHERE status <> 'done' AND due_date < v_today)      AS atrasadas
    FROM public.monday_tasks
    WHERE NOT archived
  ),
  -- Sprint "ativa" = a janela dela cruza o período pedido (não "status = running":
  -- o status é preenchido à mão e hoje todas as 12 sprints estão como 'planned',
  -- inclusive as já concluídas — a data é o sinal confiável).
  ti_sprints AS (
    SELECT count(*) AS n FROM public.monday_sprints
    WHERE start_date IS NOT NULL AND end_date IS NOT NULL
      AND start_date < (p_end   AT TIME ZONE 'America/Sao_Paulo')::date
      AND end_date  >= (p_start AT TIME ZONE 'America/Sao_Paulo')::date
  ),
  ti_dia AS (
    SELECT (completed_at AT TIME ZONE 'America/Sao_Paulo')::date AS day, count(*) AS v
    FROM public.monday_tasks
    WHERE completed_at >= p_start AND completed_at < p_end
    GROUP BY 1
  ),
  ti_ultimo AS (
    SELECT MAX(completed_at) AS t FROM public.monday_tasks
  ),

  -- ── (5) OPERAÇÃO (Discador) ───────────────────────────────────────────────
  -- status='answered' é a chamada atendida (os outros valores em uso hoje são
  -- 'no_answer' e 'busy'). Tempo falado só de atendida: somar a duração de uma
  -- não-atendida contaria tempo de toque como conversa.
  op_chamadas AS (
    SELECT count(*) AS n,
           count(*) FILTER (WHERE status = 'answered') AS atendidas,
           COALESCE(SUM(duration_seconds) FILTER (WHERE status = 'answered'), 0) AS seg
    FROM public.call_logs
    WHERE started_at >= p_start AND started_at < p_end
  ),
  op_chamadas_prev AS (
    SELECT count(*) AS n,
           count(*) FILTER (WHERE status = 'answered') AS atendidas
    FROM public.call_logs
    WHERE started_at >= v_prev_start AND started_at < p_start
  ),
  op_dia AS (
    SELECT (started_at AT TIME ZONE 'America/Sao_Paulo')::date AS day, count(*) AS v
    FROM public.call_logs
    WHERE started_at >= p_start AND started_at < p_end
    GROUP BY 1
  ),
  op_ultimo AS (
    SELECT MAX(started_at) AS t FROM public.call_logs
  ),

  -- ── Séries diárias, uma por bloco ─────────────────────────────────────────
  -- ⚠️ A ordem tem que ser imposta no jsonb_agg (ORDER BY dentro dele), não numa
  -- CTE ordenada: agregar sobre CTE ordenada NÃO garante a ordem do array, e o
  -- sparkline depende da ordem cronológica. Mesma armadilha comentada em
  -- get_ceo_financeiro.
  series AS (
    SELECT
      COALESCE(jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'),
        'v', ROUND(COALESCE(f.v, 0), 2)) ORDER BY d.day), '[]'::jsonb) AS financeiro,
      COALESCE(jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'),
        'v', COALESCE(l.v, 0)) ORDER BY d.day), '[]'::jsonb) AS comercial,
      COALESCE(jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'),
        'v', COALESCE(cs.v, 0)) ORDER BY d.day), '[]'::jsonb) AS cs,
      COALESCE(jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'),
        'v', COALESCE(t.v, 0)) ORDER BY d.day), '[]'::jsonb) AS ti,
      COALESCE(jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'),
        'v', COALESCE(o.v, 0)) ORDER BY d.day), '[]'::jsonb) AS operacao
    FROM days d
    LEFT JOIN fin_dia  f  ON f.day  = d.day
    LEFT JOIN lead_dia l  ON l.day  = d.day
    LEFT JOIN cs_dia   cs ON cs.day = d.day
    LEFT JOIN ti_dia   t  ON t.day  = d.day
    LEFT JOIN op_dia   o  ON o.day  = d.day
  )

  SELECT jsonb_build_object(
    'periodStart',   to_char((p_start AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD'),
    'periodEnd',     to_char((p_end   AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD'),
    'referenceDate', to_char(v_today, 'YYYY-MM-DD'),

    -- Bloco 1 — dinheiro que ENTROU. Os totais são exatamente os da aba
    -- Financeiro (mesma função), então as duas abas não podem divergir.
    -- v_fin é NULL só se a guarda barrar lá dentro, o que aqui é impossível
    -- (já passamos pela mesma guarda) — mas COALESCE porque um NULL silencioso
    -- viraria "R$ 0,00" na tela, e zero é um número, não um erro.
    'financeiro', jsonb_build_object(
      'total',          COALESCE((v_fin->>'total')::numeric, 0),
      'previousTotal',  COALESCE((v_fin->>'previousTotal')::numeric, 0),
      'count',          COALESCE((v_fin->>'count')::bigint, 0),
      'previousCount',  COALESCE((v_fin->>'previousCount')::bigint, 0),
      'lastActivityAt', (SELECT to_char(d, 'YYYY-MM-DD') FROM fin_ultimo),
      'series',         (SELECT financeiro FROM series)
    ),

    -- Bloco 2 — funil comercial.
    'comercial', jsonb_build_object(
      'received',         (SELECT n FROM lead_rec),
      'previousReceived', (SELECT n FROM lead_rec_prev),
      'won',              (SELECT won FROM lead_fim),
      'previousWon',      (SELECT won FROM lead_fim_prev),
      'dead',             (SELECT dead FROM lead_fim),
      'previousDead',     (SELECT dead FROM lead_fim_prev),
      'open',             (SELECT abertos FROM lead_foto),
      'stuck',            (SELECT parados FROM lead_foto),
      'avgHoursToFirstContact', (SELECT h FROM lead_1contato),
      'lastActivityAt',   (SELECT t FROM lead_ultimo),
      'series',           (SELECT comercial FROM series)
    ),

    -- Bloco 3 — carteira de CS.
    'cs', jsonb_build_object(
      'activeCards',        (SELECT n FROM cs_ativos),
      'moved',              (SELECT n FROM cs_mov),
      'previousMoved',      (SELECT n FROM cs_mov_prev),
      'negotiations',       (SELECT n FROM cs_negoc),
      'previousNegotiations',(SELECT n FROM cs_negoc_prev),
      'settled',            (SELECT quitados FROM cs_desfecho),
      'previousSettled',    (SELECT quitados FROM cs_desfecho_prev),
      'churned',            (SELECT distratos FROM cs_desfecho),
      'previousChurned',    (SELECT distratos FROM cs_desfecho_prev),
      'lastActivityAt',     (SELECT t FROM cs_ultimo),
      'series',             (SELECT cs FROM series)
    ),

    -- Bloco 4 — ritmo de entrega de TI. ⚠️ Base pequena (30 tarefas em 04/ago,
    -- 31 no dia seguinte): serve pra ritmo, não pra tendência.
    'ti', jsonb_build_object(
      'done',           (SELECT n FROM ti_feitas),
      'previousDone',   (SELECT n FROM ti_feitas_prev),
      'points',         (SELECT pts FROM ti_feitas),
      'previousPoints', (SELECT pts FROM ti_feitas_prev),
      'open',           (SELECT abertas FROM ti_foto),
      'overdue',        (SELECT atrasadas FROM ti_foto),
      'sprints',        (SELECT n FROM ti_sprints),
      'lastActivityAt', (SELECT t FROM ti_ultimo),
      'series',         (SELECT ti FROM series)
    ),

    -- Bloco 5 — volume de operação. É a fonte que mais liga e desliga (ficou 12
    -- dias muda até 04/ago e voltou na tarde seguinte, com as campanhas ainda em
    -- `draft`): leia o lastActivityAt junto do número, sempre.
    'operacao', jsonb_build_object(
      'calls',             (SELECT n FROM op_chamadas),
      'previousCalls',     (SELECT n FROM op_chamadas_prev),
      'answered',          (SELECT atendidas FROM op_chamadas),
      'previousAnswered',  (SELECT atendidas FROM op_chamadas_prev),
      'talkMinutes',       ROUND((SELECT seg FROM op_chamadas) / 60.0, 1),
      'lastActivityAt',    (SELECT t FROM op_ultimo),
      'series',            (SELECT operacao FROM series)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_ceo_saude_empresa(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ceo_saude_empresa(timestamptz, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.get_ceo_saude_empresa(timestamptz, timestamptz) IS
  'Scorecard de saúde da empresa para o painel do CEO — 5 domínios (guarda ceo/admin). Ver docs/projetopainelceo-docs/updates/painel-ceo-sprints.md';

COMMIT;

-- ============================================================================
-- Conferir depois de aplicar (SQL Editor)
-- ============================================================================
-- 1) A guarda barra quem não é ceo/admin?
--      SELECT public.get_ceo_saude_empresa(now() - interval '30 days', now());
--    · logado como ceo/admin → jsonb com os 5 blocos
--    · como service_role/outro papel → NULL (não erro, não dado)
--
-- 2) O bloco financeiro é IDÊNTICO ao da aba Financeiro? (não pode divergir —
--    nota (A) do cabeçalho). Os dois números têm que bater dígito a dígito:
--      SELECT public.get_ceo_saude_empresa('2026-07-01T03:00:00Z','2026-08-01T03:00:00Z')
--               -> 'financeiro' ->> 'total',
--             public.get_ceo_financeiro('2026-07-01T03:00:00Z','2026-08-01T03:00:00Z')
--               ->> 'total';
--
-- 3) O comercial bate com o painel de Leads no mesmo período?
--      SELECT public.get_leads_won_by_sale_date('2026-07-01T03:00:00Z','2026-08-01T03:00:00Z');
--    · o 'won' de lá tem que ser o 'won' do bloco comercial daqui.
--
-- 4) A série tem um ponto por dia do período, em ordem, zero-preenchida?
--      SELECT jsonb_array_length(
--        public.get_ceo_saude_empresa('2026-07-01T03:00:00Z','2026-08-01T03:00:00Z')
--          -> 'comercial' -> 'series');   -- esperado: 31
--
-- 5) Toda fonte diz de quando é o dado dela (é o que faz o zero virar causa)?
--      SELECT k, public.get_ceo_saude_empresa(now() - interval '30 days', now())
--                  -> k ->> 'lastActivityAt'
--      FROM unnest(ARRAY['financeiro','comercial','cs','ti','operacao']) k;
--    · as 5 têm que devolver uma data (nunca NULL, a menos que a fonte nunca tenha
--      produzido nada). QUAL data é o estado da operação no dia, não um valor a
--      esperar: o discador ficou 12 dias mudo e voltou de um dia para o outro.
--
-- Conferência automatizada (recomputa tudo do zero e compara):
--      npm run verify:saude-empresa
-- ============================================================================
