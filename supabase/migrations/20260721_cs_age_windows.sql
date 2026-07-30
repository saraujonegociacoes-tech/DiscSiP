-- ============================================================================
-- Painel de Sucesso do Cliente (CS) — Página 1: Matriz Fase × Idade
-- ============================================================================
-- Reformulação 2026-07-21 (ver docs/updates/painel-sucesso-cliente-cs.md): o
-- dashboard de CS virou um painel de 4 abas. Esta migration é a camada de leitura
-- da PÁGINA 1 — uma MATRIZ fase × janela de idade (heatmap) com total e tempo médio
-- por fase, mais o drill-down por célula. Domínio SEPARADO do comercial.
--
-- Substitui o dashboard antigo (Sprint 2: v_cs_progress / get_cs_dashboard — "cards
-- por fase"), ABANDONADO. Dropa esses dois objetos mortos (passo 0). O arquivo
-- 20260716_cs_dashboard.sql fica no repo só como registro histórico (migration é
-- forward-only — não se edita a antiga).
--
-- Peças:
--   1.  cs_phases.is_terminal — classifica "ativo vs inativo" de forma data-driven.
--   1b. cs_cards.current_phase_entered_at + ingest_cs_card estendida — tempo REAL na
--       fase (entrada via phases_history do Pipefy), corrigindo o bug de dwell = tempo
--       desde a última atualização. Requer re-rodar o backfill com a query nova.
--   2.  get_cs_matrix(p_end) — devolve, numa chamada só (jsonb), os cards escopados
--       pelo RLS com idade AS-OF + fase + ordem do funil + tempo na fase (dwell). O
--       bucketing por janela / matriz / filtro ativo-inativo / total / média
--       acontecem no cliente sobre esse array.
-- ============================================================================

-- ── 0. Remover o dashboard antigo (Sprint 2, superado) + a RPC intermediária ──
-- Dropa a FUNÇÃO antes da VIEW (a função lê da view). get_cs_age_windows foi um
-- passo intermediário (pizza) desta mesma reformulação, agora substituído pela
-- matriz. IF EXISTS = idempotente.
DROP FUNCTION IF EXISTS public.get_cs_dashboard();
DROP FUNCTION IF EXISTS public.get_cs_age_windows(timestamptz);
DROP VIEW IF EXISTS public.v_cs_progress;

-- ── 1. Classificação de fase terminal (ativo × inativo) ──────────────────────
-- "Inativo" = card numa fase de saída. Fases terminais vêm da tabela de sinal do
-- doc (Quitados/Distratos = ganho/perda; Arquivado/Concluído/Distribuição =
-- neutro, mas encerrados). Ajustável: basta UPDATE is_terminal numa fase.
ALTER TABLE public.cs_phases
  ADD COLUMN IF NOT EXISTS is_terminal boolean NOT NULL DEFAULT false;

UPDATE public.cs_phases SET is_terminal = true
WHERE id IN (
  '337186300',  -- Quitados
  '338460922',  -- Distratos
  '338563627',  -- Distribuição Processual
  '334667293',  -- Concluído
  '334667294'   -- Arquivado
);

-- ── 1b. Tempo real na fase: entrada na fase atual (phases_history do Pipefy) ──
-- A matriz mede "há quanto tempo o card está PARADO na fase atual". Isso exige saber
-- QUANDO ele entrou na fase — dado que só existe no `phases_history` do Pipefy
-- (lastTimeIn da fase atual). Guardamos numa coluna própria; o dwell da RPC = now −
-- current_phase_entered_at. Antes eu usava o evento sintético do backfill (occurred_at =
-- updated_at), que virava "tempo desde a última atualização" (bug: card no 23° mês
-- atualizado há 15 dias aparecia como 15 dias na fase, sendo 4+ meses de fato).
--
-- ⚠ Requer que o node do Pipefy passe a incluir `phases_history { phase { id } lastTimeIn }`
-- (backfill: scripts/import-cs-cards.mjs; Make: docs/updates/make-integracao-cs.md) e
-- RE-RODAR o backfill pra popular os cards existentes. Sem isso, a coluna fica NULL e a RPC
-- cai no created_at (dwell ~ idade) — melhor que o bug, mas ainda não exato.
ALTER TABLE public.cs_cards
  ADD COLUMN IF NOT EXISTS current_phase_entered_at timestamptz;

-- ingest_cs_card estendida: mesma lógica da 20260715 (assignees, metadata, evento de
-- transição) + extrai a entrada na fase atual do phases_history e grava em
-- current_phase_entered_at. COALESCE no UPDATE pra não zerar um valor bom se um poll vier
-- sem phases_history.
CREATE OR REPLACE FUNCTION public.ingest_cs_card(node jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pipefy_card_id text := node->>'id';
  v_title text := node->>'title';
  v_created_at timestamptz := NULLIF(node->>'created_at', '')::timestamptz;
  v_finished_at timestamptz := NULLIF(node->>'finished_at', '')::timestamptz;
  v_done boolean := (node->>'done')::boolean;
  v_updated_at timestamptz := COALESCE(NULLIF(node->>'updated_at', '')::timestamptz, now());
  v_phase_id text := node->'current_phase'->>'id';
  v_phase_name text := node->'current_phase'->>'name';
  v_phase_entered_at timestamptz := NULLIF((
    SELECT ph->>'lastTimeIn'
    FROM jsonb_array_elements(COALESCE(node->'phases_history', '[]'::jsonb)) ph
    WHERE ph->'phase'->>'id' = v_phase_id
    ORDER BY ph->>'lastTimeIn' DESC
    LIMIT 1
  ), '')::timestamptz;
  v_assignees jsonb := COALESCE(node->'assignees', '[]'::jsonb);
  v_assignee_count int := jsonb_array_length(v_assignees);
  v_agent_id uuid;
  v_duplicate boolean := v_assignee_count > 1;
  v_metadata jsonb;
  v_cs_card_id uuid;
  v_from_phase text;
  v_from_phase_id text;
BEGIN
  INSERT INTO public.cs_agents (pipefy_user_id, pipefy_name, email)
  SELECT a->>'id', a->>'name', a->>'email'
  FROM jsonb_array_elements(v_assignees) AS a
  WHERE a->>'id' IS NOT NULL
  ON CONFLICT (pipefy_user_id) DO UPDATE
    SET pipefy_name = EXCLUDED.pipefy_name, email = EXCLUDED.email;

  IF v_assignee_count > 0 THEN
    SELECT id INTO v_agent_id
    FROM public.cs_agents
    WHERE pipefy_user_id = (v_assignees -> (v_assignee_count - 1))->>'id';
  END IF;

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

  SELECT current_phase, current_phase_id INTO v_from_phase, v_from_phase_id
  FROM public.cs_cards WHERE pipefy_card_id = v_pipefy_card_id;

  INSERT INTO public.cs_cards (
    pipefy_card_id, title, current_phase_id, current_phase, current_phase_entered_at,
    responsible_agent_id, duplicate_responsible, pipefy_created_at, pipefy_finished_at,
    pipefy_done, metadata, synced_at, updated_at
  ) VALUES (
    v_pipefy_card_id, v_title, v_phase_id, v_phase_name, v_phase_entered_at,
    v_agent_id, v_duplicate, v_created_at, v_finished_at,
    v_done, COALESCE(v_metadata, '{}'::jsonb), now(), v_updated_at
  )
  ON CONFLICT (pipefy_card_id) DO UPDATE SET
    title = EXCLUDED.title,
    current_phase_id = EXCLUDED.current_phase_id,
    current_phase = EXCLUDED.current_phase,
    current_phase_entered_at = COALESCE(EXCLUDED.current_phase_entered_at, public.cs_cards.current_phase_entered_at),
    responsible_agent_id = EXCLUDED.responsible_agent_id,
    duplicate_responsible = EXCLUDED.duplicate_responsible,
    pipefy_finished_at = EXCLUDED.pipefy_finished_at,
    pipefy_done = EXCLUDED.pipefy_done,
    metadata = EXCLUDED.metadata,
    synced_at = now(),
    updated_at = EXCLUDED.updated_at
  RETURNING id INTO v_cs_card_id;

  IF v_from_phase_id IS DISTINCT FROM v_phase_id THEN
    PERFORM public.ingest_cs_event(jsonb_build_object(
      'cs_card_id', v_cs_card_id,
      'pipefy_card_id', v_pipefy_card_id,
      'from_phase', v_from_phase,
      'to_phase', v_phase_name,
      'to_phase_id', v_phase_id,
      'agent_id', v_agent_id,
      'occurred_at', v_updated_at
    ));
  END IF;

  RETURN jsonb_build_object('cs_card_id', v_cs_card_id, 'agent_id', v_agent_id, 'duplicate', v_duplicate);
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_cs_card(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_cs_card(jsonb) TO service_role;

-- ── 2. Leitura da Página 1 (matriz fase × idade) ─────────────────────────────
-- SECURITY INVOKER (default): o RLS de cs_cards já escopa por quem está logado
-- (agente = o próprio card, supervisor = o departamento de CS, manager/admin =
-- tudo, quem não é do CS = nada). A função só resume o que o RLS deixou passar.
--
-- STABLE + jsonb numa linha só: mesmo truque de get_leads_dashboard — agrega no
-- Postgres pra não puxar tabela inteira pro Worker (teto de paginação do PostgREST
-- / erro 1102, ver docs/fixes/correcao-cpu-cloudflare-1102.md).
--
-- Idade AS-OF: ref_at = LEAST(p_end, now()). No ciclo corrente cai em now() ("foto
-- de agora"); num ciclo passado, é o fim daquele ciclo. Coorte = cards criados
-- ANTES de ref_at. age_days e dwell_days nunca negativos.
--
-- dwell_days (tempo NA FASE atual): now − cs_cards.current_phase_entered_at (quando o
-- card ENTROU na fase atual, vindo do phases_history do Pipefy — ver passo 1b). Sem esse
-- dado (card ainda não re-ingerido com phases_history), cai pro created_at. NÃO usa mais o
-- evento sintético do backfill (occurred_at = updated_at), que fazia dwell virar "tempo
-- desde a última atualização" — bug reportado pelo dono. O cliente faz a média por fase e
-- mostra "–" nas fases terminais.
CREATE OR REPLACE FUNCTION public.get_cs_matrix(p_end timestamptz)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH ref AS (
    SELECT LEAST(p_end, now()) AS ref_at
  ),
  scoped AS (
    SELECT
      c.pipefy_card_id,
      c.title,
      c.pipefy_created_at,
      c.current_phase_id,
      COALESCE(c.current_phase, 'Sem fase') AS phase_name,
      ph.funnel_order,
      COALESCE(ph.is_terminal, false) AS is_terminal,
      c.responsible_agent_id,
      ag.pipefy_name AS agent_name,
      GREATEST(
        floor(EXTRACT(EPOCH FROM ((SELECT ref_at FROM ref) - c.pipefy_created_at)) / 86400)::int,
        0
      ) AS age_days,
      GREATEST(
        floor(EXTRACT(EPOCH FROM (
          (SELECT ref_at FROM ref) - COALESCE(c.current_phase_entered_at, c.pipefy_created_at)
        )) / 86400)::int,
        0
      ) AS dwell_days
    FROM public.cs_cards c
    LEFT JOIN public.cs_phases ph ON ph.id = c.current_phase_id
    LEFT JOIN public.cs_agents ag ON ag.id = c.responsible_agent_id
    WHERE c.pipefy_created_at IS NOT NULL
      AND c.pipefy_created_at < (SELECT ref_at FROM ref)
  )
  SELECT jsonb_build_object(
    'referenceAt', (SELECT ref_at FROM ref),
    'cards', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'pipefyCardId', s.pipefy_card_id,
          'title', s.title,
          'ageDays', s.age_days,
          'dwellDays', s.dwell_days,
          'agentId', s.responsible_agent_id,
          'agentName', COALESCE(s.agent_name, 'Sem responsável'),
          'active', NOT s.is_terminal,
          'phaseId', s.current_phase_id,
          'phase', s.phase_name,
          'funnelOrder', s.funnel_order
        )
        -- mais antigo primeiro: o drill-down por célula já herda a ordem pedida.
        ORDER BY s.pipefy_created_at ASC
      )
      FROM scoped s
    ), '[]'::jsonb)
  );
$$;

-- Front chama como authenticated; o RLS (invoker) faz o escopo. Sem risco de
-- escalonamento: a função não é SECURITY DEFINER.
GRANT EXECUTE ON FUNCTION public.get_cs_matrix(timestamptz) TO authenticated;

-- ── Conferir depois de aplicar ──────────────────────────────────────────────
-- SELECT count(*) FILTER (WHERE is_terminal) FROM public.cs_phases;  -- esperado: 5
-- SELECT jsonb_array_length(get_cs_matrix(now()) -> 'cards');        -- logado como
--   manager/admin: ~total de cards com created_at (perto de 1484).
