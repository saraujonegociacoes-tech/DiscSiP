-- ============================================================================
-- Leads — mapeamento de cards EXCLUÍDOS no Pipefy + exclusão de toda contagem
-- ============================================================================
-- Achado na conferência pós-backfill (02/set): 10 leads no banco não têm mais card
-- correspondente no Pipefy. Todos parados em "Recebidos", nunca trabalhados, todos de
-- julho, e 7 dos 10 têm homônimo ainda vivo no pipe — faxina de duplicata feita à mão.
--
-- A ingestão NÃO tem caminho de delete: o Make só faz upsert do que existe, então card
-- apagado no Pipefy fica no banco para sempre. Eles inflavam "Recebidos" (banco 20 ×
-- Pipefy 5) e o total de recebidos de dois ciclos (1 em 11/jun–10/jul, 9 em 11/jul–10/ago),
-- diluindo conversão e taxa de lead morto por entrarem no denominador.
--
-- DECISÃO (pedido do dono): não APAGAR — MAPEAR e tirar de toda contagem. Assim o
-- histórico continua auditável (dá para responder "cadê o lead do Fulano?") e nenhum
-- gráfico conta o que não existe mais.
--
-- COMO A EXCLUSÃO É GARANTIDA EM TODO GRÁFICO, sem caçar RPC por RPC:
--   `v_lead_progress` é o gargalo de leitura de TODO o painel — as views derivadas
--   (v_agent_kpis, v_funnel, v_dead_reasons, v_phase_distribution) são construídas em
--   cima dela, e as RPCs ou leem dela, ou leem `lead_events` filtrando por
--   `EXISTS (SELECT 1 FROM v_lead_progress ...)`. Um `WHERE deleted_at IS NULL` ali
--   cobre KPIs, funil, distribuição por fase, motivos de descarte, ranking, canal,
--   séries temporais, dwell time, acionamento e todos os drill-downs de uma vez.
--   A ÚNICA leitura que não passa por ela é `v_duplicate_responsibility` (lê `leads`
--   direto, ver 20260709) — filtrada aqui também.
--
-- Idempotente (CREATE OR REPLACE / IF NOT EXISTS). NÃO apaga linha nenhuma.
-- COMO USAR: cole no SQL Editor do Supabase e rode uma vez. Depois rode o backfill,
-- que passa a detectar e marcar os excluídos: npm run backfill:leads-phases
-- ============================================================================

BEGIN;

-- ── 1. A marca ───────────────────────────────────────────────────────────────
-- NULL = card vivo no Pipefy. Preenchido = card não existe mais lá (quando detectamos).
-- É data, não boolean, porque "quando sumiu" é a informação que responde à pergunta
-- "esse número mudou por quê?" meses depois.
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN public.leads.deleted_at IS
  'Momento em que detectamos que o card não existe mais no Pipefy. NULL = vivo. '
  'A linha é PRESERVADA (auditoria); v_lead_progress filtra, então some de toda contagem. '
  'Volta a NULL sozinha se o card reaparecer (ver ingest_lead_event e mark_leads_deleted).';

-- Índice parcial: as contagens varrem os vivos, e os excluídos são punhado.
CREATE INDEX IF NOT EXISTS idx_leads_deleted
  ON public.leads (deleted_at) WHERE deleted_at IS NOT NULL;

-- ── 2. v_lead_progress: o gargalo que tira os excluídos de TODO gráfico ──────
-- Mesmo corpo da 20260901 (22 colunas, mesma ordem) + WHERE. CREATE OR REPLACE não
-- aceita mudar a lista de colunas, e não estamos mudando — só filtrando linhas.
CREATE OR REPLACE VIEW public.v_lead_progress
WITH (security_invoker = true) AS
SELECT
  l.id                     AS lead_id,
  l.responsible_agent_id,
  l.current_phase,
  cp.kind                  AS phase_kind,
  cp.funnel_order          AS current_funnel_order,
  l.created_at,
  l.first_contact_at,
  l.finalized_at,
  l.updated_at,
  l.discard_reason,
  l.channel,
  l.duplicate_responsible,
  (cp.kind = 'morta')      AS is_dead,
  (l.finalized_at IS NULL) AS is_open,
  GREATEST(COALESCE(cp.funnel_order, -1), COALESCE(ev.reached, -1)) AS max_funnel_order,
  (GREATEST(COALESCE(cp.funnel_order, -1), COALESCE(ev.reached, -1)) >= won.ord) AS is_won,
  CASE WHEN l.first_contact_at IS NOT NULL AND l.created_at IS NOT NULL
       THEN EXTRACT(EPOCH FROM (l.first_contact_at - l.created_at)) / 3600.0
  END AS hours_to_first_contact,
  CASE WHEN l.updated_at IS NOT NULL
       THEN EXTRACT(EPOCH FROM (now() - l.updated_at)) / 3600.0
  END AS hours_since_update,
  l.title                  AS title,
  cp.sla_hours,
  (
        l.finalized_at IS NULL
    AND cp.kind IS DISTINCT FROM 'morta'
    AND GREATEST(COALESCE(cp.funnel_order, -1), COALESCE(ev.reached, -1)) < won.ord
    AND cp.sla_hours IS NOT NULL
    AND l.created_at IS NOT NULL
    AND EXTRACT(EPOCH FROM (now() - l.created_at)) / 3600.0 > cp.sla_hours
  ) AS is_stuck,
  l.reaproveitado          AS is_reaproveitado
FROM public.leads l
LEFT JOIN public.lead_phases cp ON cp.pipefy_phase_id = l.current_phase_id
CROSS JOIN (SELECT funnel_order AS ord FROM public.lead_phases WHERE is_won LIMIT 1) won
LEFT JOIN LATERAL (
  SELECT max(p2.funnel_order) AS reached
  FROM public.lead_events e
  JOIN public.lead_phases p2 ON p2.pipefy_phase_id = e.to_phase_id
  WHERE e.lead_id = l.id
) ev ON true
WHERE l.deleted_at IS NULL;   -- ← card excluído no Pipefy some de toda contagem

-- ── 3. v_duplicate_responsibility: a única leitura fora do gargalo ───────────
-- Corpo idêntico ao da 20260709 + o filtro. Sem isto, o alerta de responsabilidade
-- duplicada continuaria apontando card que não existe mais — e 7 dos 10 excluídos são
-- justamente duplicata, então seria o alerta mais errado do painel.
CREATE OR REPLACE VIEW public.v_duplicate_responsibility
WITH (security_invoker = true) AS
SELECT
  l.id            AS lead_id,
  l.title,
  l.current_phase,
  la.pipefy_name  AS responsible,
  l.updated_at,
  l.pipefy_card_id
FROM public.leads l
LEFT JOIN public.lead_agents la ON la.id = l.responsible_agent_id
WHERE l.duplicate_responsible
  AND l.deleted_at IS NULL;

-- ── 4. O MAPEAMENTO ─────────────────────────────────────────────────────────
-- Lê `leads` direto de propósito: v_lead_progress agora esconde exatamente estas linhas.
-- security_invoker → só quem já enxerga os leads enxerga o mapa.
CREATE OR REPLACE VIEW public.v_leads_deleted
WITH (security_invoker = true) AS
SELECT
  l.pipefy_card_id,
  l.title,
  l.current_phase                       AS ultima_fase,
  la.pipefy_name                        AS responsavel,
  l.channel                             AS canal,
  l.created_at,
  l.synced_at                           AS ultimo_sync,
  l.deleted_at                          AS detectado_em,
  l.reaproveitado,
  'https://app.pipefy.com/open-cards/' || l.pipefy_card_id AS pipefy_url
FROM public.leads l
LEFT JOIN public.lead_agents la ON la.id = l.responsible_agent_id
WHERE l.deleted_at IS NOT NULL;

-- ── 5. Detecção: quem não está na lista de vivos do Pipefy está excluído ─────
-- Recebe TODOS os card_ids que o Pipefy devolveu numa varredura completa e concilia nos
-- dois sentidos: marca o que sumiu, DESMARCA o que voltou (card restaurado, ou uma leitura
-- anterior que errou). Chamada pelo backfill, uma vez por varredura.
--
-- TRAVA DE SEGURANÇA: uma varredura parcial (rate limit, token expirado, queda de rede no
-- meio da paginação) marcaria metade da base como excluída — e isso zeraria gráfico de
-- ciclo inteiro. Por isso a função RECUSA lista vazia ou menor que 90% dos leads ativos.
-- Se recusar de verdade, o certo é rodar o backfill de novo, não afrouxar o limite.
CREATE OR REPLACE FUNCTION public.mark_leads_deleted(p_live_card_ids text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_live     int := COALESCE(array_length(p_live_card_ids, 1), 0);
  v_ativos   int;
  v_marcados int;
  v_restaurados int;
BEGIN
  SELECT count(*) INTO v_ativos FROM public.leads WHERE deleted_at IS NULL;

  IF v_live = 0 THEN
    RAISE EXCEPTION 'mark_leads_deleted: lista de cards vivos VAZIA — recusado (marcaria a base inteira como excluída)';
  END IF;
  IF v_ativos > 0 AND v_live < (v_ativos * 0.9) THEN
    RAISE EXCEPTION 'mark_leads_deleted: recebi % cards vivos para % leads ativos (menos de 90%%) — recusado, parece varredura parcial do Pipefy', v_live, v_ativos;
  END IF;

  -- anti-join com hash (NOT ... = ANY(array) faria varredura linear por linha)
  WITH vivos AS (SELECT unnest(p_live_card_ids) AS card_id)
  UPDATE public.leads l SET deleted_at = now()
  WHERE l.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM vivos v WHERE v.card_id = l.pipefy_card_id);
  GET DIAGNOSTICS v_marcados = ROW_COUNT;

  WITH vivos AS (SELECT unnest(p_live_card_ids) AS card_id)
  UPDATE public.leads l SET deleted_at = NULL
  WHERE l.deleted_at IS NOT NULL
    AND EXISTS (SELECT 1 FROM vivos v WHERE v.card_id = l.pipefy_card_id);
  GET DIAGNOSTICS v_restaurados = ROW_COUNT;

  RETURN jsonb_build_object(
    'vivos', v_live, 'marcados', v_marcados, 'restaurados', v_restaurados,
    'total_excluidos', (SELECT count(*) FROM public.leads WHERE deleted_at IS NOT NULL)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_leads_deleted(text[]) FROM public;
GRANT EXECUTE ON FUNCTION public.mark_leads_deleted(text[]) TO service_role;

-- ── 6. Ingestão: card que reaparece deixa de ser excluído ───────────────────
-- Se o Make manda o card, ele existe. Mesma função da 20260901 com UMA linha a mais no
-- ON CONFLICT (`deleted_at = NULL`), para o estado se auto-corrigir sem esperar backfill.
CREATE OR REPLACE FUNCTION public.ingest_lead_event(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_card_id      text        := payload->>'card_id';
  v_resp         jsonb       := COALESCE(payload->'responsibles', '[]'::jsonb);
  v_elem         jsonb;
  v_recent_uid   text;
  v_dup          boolean;
  v_agent_id     uuid;
  v_lead_id      uuid;
  v_to_phase     text        := NULLIF(trim(payload->>'to_phase'), '');
  v_to_phase_id  text        := NULLIF(payload->>'to_phase_id', '');
  v_occurred_at  timestamptz := COALESCE((payload->>'occurred_at')::timestamptz, now());
  v_reaprov      boolean;
BEGIN
  IF v_card_id IS NULL THEN
    RAISE EXCEPTION 'ingest_lead_event: card_id é obrigatório';
  END IF;

  v_dup := jsonb_array_length(v_resp) > 1;

  SELECT COALESCE(bool_or(p.marks_reaproveitado), false) INTO v_reaprov
  FROM public.lead_phases p WHERE p.pipefy_phase_id = v_to_phase_id;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(v_resp)
  LOOP
    IF NULLIF(v_elem->>'id', '') IS NOT NULL THEN
      INSERT INTO public.lead_agents (pipefy_user_id, pipefy_name, email)
      VALUES (
        v_elem->>'id',
        NULLIF(trim(v_elem->>'name'), ''),
        NULLIF(trim(v_elem->>'email'), '')
      )
      ON CONFLICT (pipefy_user_id) DO UPDATE SET
        pipefy_name = COALESCE(EXCLUDED.pipefy_name, lead_agents.pipefy_name),
        email       = COALESCE(EXCLUDED.email, lead_agents.email);
    END IF;
  END LOOP;

  IF jsonb_array_length(v_resp) > 0 THEN
    v_recent_uid := v_resp -> (jsonb_array_length(v_resp) - 1) ->> 'id';
    SELECT id INTO v_agent_id FROM public.lead_agents WHERE pipefy_user_id = v_recent_uid;
  END IF;

  INSERT INTO public.leads (
    pipefy_card_id, title, current_phase_id, current_phase, responsible_agent_id,
    duplicate_responsible, channel, discard_reason,
    created_at, first_contact_at, finalized_at, updated_at, metadata, synced_at,
    reaproveitado
  ) VALUES (
    v_card_id,
    payload->>'title',
    v_to_phase_id,
    v_to_phase,
    v_agent_id,
    v_dup,
    NULLIF(payload->>'channel', ''),
    NULLIF(payload->>'discard_reason', ''),
    (payload->>'created_at')::timestamptz,
    (payload->>'first_contact_at')::timestamptz,
    (payload->>'finalized_at')::timestamptz,
    COALESCE((payload->>'updated_at')::timestamptz, v_occurred_at),
    COALESCE(payload->'raw', '{}'::jsonb),
    now(),
    v_reaprov
  )
  ON CONFLICT (pipefy_card_id) DO UPDATE SET
    title                 = COALESCE(EXCLUDED.title, leads.title),
    current_phase_id      = EXCLUDED.current_phase_id,
    current_phase         = EXCLUDED.current_phase,
    responsible_agent_id  = COALESCE(EXCLUDED.responsible_agent_id, leads.responsible_agent_id),
    duplicate_responsible = EXCLUDED.duplicate_responsible,
    channel               = COALESCE(EXCLUDED.channel, leads.channel),
    discard_reason        = COALESCE(EXCLUDED.discard_reason, leads.discard_reason),
    first_contact_at      = COALESCE(leads.first_contact_at, EXCLUDED.first_contact_at),
    finalized_at          = EXCLUDED.finalized_at,
    updated_at            = EXCLUDED.updated_at,
    metadata              = EXCLUDED.metadata,
    synced_at             = now(),
    reaproveitado         = leads.reaproveitado OR EXCLUDED.reaproveitado, -- pegajoso
    deleted_at            = NULL                                          -- o card existe: revive
  RETURNING id INTO v_lead_id;

  INSERT INTO public.lead_events (lead_id, pipefy_card_id, from_phase, to_phase, to_phase_id, agent_id, occurred_at)
  SELECT v_lead_id, v_card_id, NULLIF(trim(payload->>'from_phase'), ''), v_to_phase, v_to_phase_id, v_agent_id, v_occurred_at
  WHERE NOT EXISTS (
    SELECT 1 FROM public.lead_events
    WHERE pipefy_card_id = v_card_id
      AND to_phase_id IS NOT DISTINCT FROM v_to_phase_id
      AND occurred_at = v_occurred_at
  );

  RETURN jsonb_build_object('lead_id', v_lead_id, 'agent_id', v_agent_id, 'duplicate', v_dup);
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_lead_event(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.ingest_lead_event(jsonb) TO service_role;

COMMIT;

-- ============================================================================
-- Conferir depois de aplicar (rode separado, no SQL Editor)
-- ============================================================================
-- 1) Antes do backfill o mapa está vazio (nada foi detectado ainda):
--   SELECT count(*) FROM public.v_leads_deleted;        -- 0
--
-- 2) DEPOIS de `npm run backfill:leads-phases`, o mapa (esperado: 10 em 02/set):
--   SELECT pipefy_card_id, title, ultima_fase, responsavel, created_at, pipefy_url
--   FROM public.v_leads_deleted ORDER BY created_at;
--
-- 3) Saíram das contagens — o total da view tem que cair pelo mesmo tanto:
--   SELECT (SELECT count(*) FROM public.leads)            AS linhas_na_tabela,
--          (SELECT count(*) FROM public.v_lead_progress)  AS contadas_nos_graficos,
--          (SELECT count(*) FROM public.v_leads_deleted)  AS excluidas;
--   -- linhas_na_tabela = contadas_nos_graficos + excluidas
--
-- 4) "Recebidos" tem que bater com o Pipefy (era 20 no banco × 5 no pipe):
--   SELECT current_phase, count(*) FROM public.v_lead_progress
--   GROUP BY 1 ORDER BY 2 DESC;
--
-- 5) A trava de segurança funciona (tem que ESTOURAR, não executar):
--   SELECT public.mark_leads_deleted(ARRAY['123']::text[]);
--   -- esperado: ERRO "parece varredura parcial do Pipefy"
-- ============================================================================
