-- ============================================================================
-- Leads — fase "Remarketing" + classe "Reaproveitado" (+ guarda de fase nova)
-- ============================================================================
-- Sintoma relatado pelo dono (01/set): a contagem de leads em Empréstimo não bate
-- com o Pipefy. Relatório do pipe no ciclo dava ~165; o painel mostrava ~125.
--
-- DIAGNÓSTICO (conferido card a card contra a API do Pipefy em 01/set/2026):
--   O erro NÃO estava na leitura. Estava no DADO: a fase atual de boa parte da base
--   estava congelada numa fase antiga, porque o poll do Make perdeu movimentações.
--
--     fase                  Pipefy   BlueDesk   diff
--     Remarketing             2284        272  −2012   <-- fase DESCONHECIDA do app
--     1° Acionamento           604       2184  +1580
--     2° Acionamento           502       1054   +552
--     Empréstimo               519        409   −110
--     Sem Finalidade          1223       1164    −59
--     TOTAL                   6620       6618     −2   <-- os cards ESTÃO no banco
--
--   Dos 519 cards que estão hoje em Empréstimo no Pipefy, 109 o banco achava que
--   estavam noutra fase (48 Sem Finalidade, 31 1° Acionamento, 14 2° Acionamento,
--   14 Recebidos, 1 3° Acionamento). Em 93 desses 109, o updated_at no Pipefy é MAIS
--   NOVO que o synced_at do banco — ou seja, o card se moveu e o poll nunca mais
--   passou nele. No ciclo 11/ago–10/set isso dava 191 (Pipefy) × 157 (painel) = 34
--   leads perdidos, que é a diferença relatada.
--
--   A causa raiz é a fase `343865023 · Remarketing`, criada no Pipefy DEPOIS do seed
--   e nunca cadastrada em lead_phases. Sem cadastro, ela é invisível ao modelo:
--   phase_kind/funnel_order ficam NULL, o lead não conta como produtivo NEM como
--   morto, some do funil, e as entradas nela são descartadas por
--   `funnel_order IS NOT NULL` (ver 20260731). Hoje ela é a MAIOR fase do pipe.
--
-- O QUE ESTA MIGRATION FAZ (decisões do dono, 01/set):
--   1. Cadastra Remarketing como fase PRODUTIVA sem degrau no funil (funnel_order
--      NULL). O Pipefy marca ela como done=false e os cards saem dela de volta pro
--      acionamento (dos 523 que entraram, 138 já estão noutra fase) — não é fase
--      morta. Sem funnel_order, a numeração 0..9 do funil fica intacta e nenhum
--      ciclo passado muda de forma.
--   2. Cria a classe REAPROVEITADO: quem passar por Remarketing uma vez fica
--      marcado PRA SEMPRE, mesmo depois de voltar pro acionamento. É uma coluna
--      pegajosa em `leads` (não um cálculo sobre eventos), porque:
--        • "pra sempre" é estado do lead, não da fase atual;
--        • fica imune à RLS de lead_events (a policy só deixa o agente ver eventos
--          onde ele é o agent_id — um lead reaproveitado por OUTRO agente ficaria
--          invisível se o flag fosse derivado de evento);
--        • é uma leitura de coluna, sem subconsulta por linha.
--      Qual fase marca é DADO, não código: o flag `marks_reaproveitado` em
--      lead_phases (espelha o padrão do `is_won`), então uma segunda fase de
--      reaproveitamento no futuro é um UPDATE, não uma migration de lógica.
--   3. Dá ao backfill um caminho para regravar o HISTÓRICO de fases
--      (ingest_lead_phase_history), já que as métricas por ENTRADA de fase (funil da
--      aba Funil, acionamento, dwell time) ficaram furadas pelos mesmos eventos
--      perdidos. Ver scripts/backfill-leads-phases.mjs.
--   4. Cria a guarda `v_leads_unknown_phase`: fase nova no Pipefy nunca mais entra
--      em silêncio. Foi exatamente esse silêncio que segurou o bug por meses.
--
-- Idempotente (ON CONFLICT / IF NOT EXISTS / CREATE OR REPLACE). NÃO apaga dados.
-- COMO USAR: cole no SQL Editor do Supabase e rode uma vez. DEPOIS rode o backfill:
--   npm run backfill:leads-phases
-- ============================================================================

BEGIN;

-- ── 1. Fase que marca reaproveitamento (dado, não código) ────────────────────
ALTER TABLE public.lead_phases
  ADD COLUMN IF NOT EXISTS marks_reaproveitado boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.lead_phases.marks_reaproveitado IS
  'Entrar nesta fase marca o lead como reaproveitado PARA SEMPRE (leads.reaproveitado). '
  'Espelha o padrão de is_won: a regra é dado, não código.';

-- ── 2. Cadastro da fase Remarketing ──────────────────────────────────────────
-- kind='produtiva' + funnel_order NULL = lead VIVO, fora do funil de acionamento.
-- sla_hours NULL = nunca fica "parado" (é estacionamento de re-trabalho, não fila).
INSERT INTO public.lead_phases
  (pipefy_phase_id, name, kind, funnel_order, is_won, sla_hours, marks_reaproveitado)
VALUES
  ('343865023', 'Remarketing', 'produtiva', NULL, false, NULL, true)
ON CONFLICT (pipefy_phase_id) DO UPDATE SET
  name                = EXCLUDED.name,
  kind                = EXCLUDED.kind,
  funnel_order        = EXCLUDED.funnel_order,
  is_won              = EXCLUDED.is_won,
  sla_hours           = EXCLUDED.sla_hours,
  marks_reaproveitado = EXCLUDED.marks_reaproveitado;

-- ── 3. Classe "Reaproveitado" no lead (pegajosa) ─────────────────────────────
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS reaproveitado boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.leads.reaproveitado IS
  'TRUE assim que o lead entra numa fase com marks_reaproveitado. NUNCA volta a FALSE '
  '— continua TRUE depois que o lead sai da fase (decisão do dono, 01/set/2026).';

-- Semente a partir do que já dá para saber HOJE: quem está na fase agora + quem tem
-- evento de entrada nela. O histórico completo vem no backfill (passo 6).
UPDATE public.leads l SET reaproveitado = true
WHERE NOT l.reaproveitado
  AND (
    EXISTS (SELECT 1 FROM public.lead_phases p
            WHERE p.pipefy_phase_id = l.current_phase_id AND p.marks_reaproveitado)
    OR EXISTS (SELECT 1 FROM public.lead_events e
               JOIN public.lead_phases p ON p.pipefy_phase_id = e.to_phase_id
               WHERE e.lead_id = l.id AND p.marks_reaproveitado)
  );

-- Índice parcial: os painéis contam "quantos reaproveitados", nunca varrem os falsos.
CREATE INDEX IF NOT EXISTS idx_leads_reaproveitado
  ON public.leads (reaproveitado) WHERE reaproveitado;

-- ── 4. v_lead_progress + is_reaproveitado ────────────────────────────────────
-- CREATE OR REPLACE (não DROP): a coluna nova vai no FIM, senão o Postgres entende
-- como renomeação de coluna existente (erro 42P16) e as views dependentes quebram.
-- Corpo idêntico ao de 20260706_leads_sla.sql + a última coluna.
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
  -- ── novas colunas (S2) ──
  l.title                  AS title,
  cp.sla_hours,
  (
        l.finalized_at IS NULL                                                  -- aberto
    AND cp.kind IS DISTINCT FROM 'morta'                                        -- não morto
    AND GREATEST(COALESCE(cp.funnel_order, -1), COALESCE(ev.reached, -1)) < won.ord  -- não ganho
    AND cp.sla_hours IS NOT NULL                                                -- fase com SLA
    AND l.created_at IS NOT NULL
    AND EXTRACT(EPOCH FROM (now() - l.created_at)) / 3600.0 > cp.sla_hours      -- estourou a cadência
  ) AS is_stuck,
  -- ── nova coluna (01/set) — classe "Reaproveitado", pegajosa ──
  l.reaproveitado          AS is_reaproveitado
FROM public.leads l
LEFT JOIN public.lead_phases cp ON cp.pipefy_phase_id = l.current_phase_id
CROSS JOIN (SELECT funnel_order AS ord FROM public.lead_phases WHERE is_won LIMIT 1) won
LEFT JOIN LATERAL (
  SELECT max(p2.funnel_order) AS reached
  FROM public.lead_events e
  JOIN public.lead_phases p2 ON p2.pipefy_phase_id = e.to_phase_id
  WHERE e.lead_id = l.id
) ev ON true;

-- ── 5. Ingestão: marca reaproveitado ao entrar na fase ───────────────────────
-- Mesma função de 20260703, com UMA mudança: o upsert liga `reaproveitado` quando a
-- fase de destino tem marks_reaproveitado, e NUNCA desliga (OR com o valor atual).
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

  v_dup := jsonb_array_length(v_resp) > 1;  -- 2+ responsáveis => alerta, não métrica individual

  -- A fase de destino marca reaproveitamento? (COALESCE: fase desconhecida => false)
  SELECT COALESCE(bool_or(p.marks_reaproveitado), false) INTO v_reaprov
  FROM public.lead_phases p WHERE p.pipefy_phase_id = v_to_phase_id;

  -- Registra TODOS os responsáveis (por user_id), capturando nome+email
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

  -- Responsável "mais recente" = ÚLTIMO do array (ASSUNÇÃO — confirmar com o Pipefy)
  IF jsonb_array_length(v_resp) > 0 THEN
    v_recent_uid := v_resp -> (jsonb_array_length(v_resp) - 1) ->> 'id';
    SELECT id INTO v_agent_id FROM public.lead_agents WHERE pipefy_user_id = v_recent_uid;
  END IF;

  -- Upsert do estado atual do lead
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
    first_contact_at      = COALESCE(leads.first_contact_at, EXCLUDED.first_contact_at), -- 1º contato não regride
    finalized_at          = EXCLUDED.finalized_at,
    updated_at            = EXCLUDED.updated_at,
    metadata              = EXCLUDED.metadata,
    synced_at             = now(),
    reaproveitado         = leads.reaproveitado OR EXCLUDED.reaproveitado -- pegajoso: nunca desliga
  RETURNING id INTO v_lead_id;

  -- Insere o evento (dedup: reenvio do mesmo card+fase+timestamp não duplica)
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

-- ── 6. Regravação do HISTÓRICO de fases (usada pelo backfill) ────────────────
-- O poll grava UM evento por passagem, com occurred_at = updated_at do card — e perdeu
-- movimentações inteiras. O `phases_history` do Pipefy é a fonte autoritativa: para cada
-- fase que o card visitou, dá firstTimeIn e lastTimeIn. Esta função recebe essa lista e
-- insere os eventos que faltam.
--
-- ADITIVA, não destrutiva: não apaga o que o poll gravou. Um evento repetido da MESMA fase
-- não estraga a contagem por entrada, porque get_leads_activity detecta transição com LAG
-- (`prev_phase_id IS DISTINCT FROM to_phase_id`) — dois eventos seguidos da mesma fase
-- contam como UMA entrada, e vale a mais antiga, que é justamente a do histórico (mais
-- próxima do momento real da mudança que o updated_at do poll).
--
-- Idempotente: dedup por (card, fase, occurred_at), e firstTimeIn/lastTimeIn são estáveis
-- no Pipefy — re-rodar o backfill não duplica nada.
--
-- Payload:
--   { card_id, entries: [ { phase_id, phase_name, occurred_at }, ... ] }
CREATE OR REPLACE FUNCTION public.ingest_lead_phase_history(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_card_id  text := payload->>'card_id';
  v_lead_id  uuid;
  v_agent_id uuid;
  v_inserted int  := 0;
  v_reaprov  boolean;
BEGIN
  IF v_card_id IS NULL THEN
    RAISE EXCEPTION 'ingest_lead_phase_history: card_id é obrigatório';
  END IF;

  SELECT id, responsible_agent_id INTO v_lead_id, v_agent_id
  FROM public.leads WHERE pipefy_card_id = v_card_id;

  -- Card ainda não ingerido: o backfill chama ingest_lead_event ANTES desta função,
  -- então isto só acontece se aquela chamada falhou. Devolve em vez de estourar.
  IF v_lead_id IS NULL THEN
    RETURN jsonb_build_object('lead_id', NULL, 'inserted', 0, 'skipped', 'lead inexistente');
  END IF;

  WITH ent AS (
    SELECT DISTINCT
      NULLIF(e->>'phase_id', '')          AS to_phase_id,
      NULLIF(trim(e->>'phase_name'), '')  AS to_phase,
      (e->>'occurred_at')::timestamptz    AS occurred_at
    FROM jsonb_array_elements(COALESCE(payload->'entries', '[]'::jsonb)) e
    WHERE NULLIF(e->>'phase_id', '') IS NOT NULL
      AND NULLIF(e->>'occurred_at', '') IS NOT NULL
  ),
  ins AS (
    INSERT INTO public.lead_events
      (lead_id, pipefy_card_id, from_phase, to_phase, to_phase_id, agent_id, occurred_at)
    -- from_phase NULL::text (e não NULL puro): o histórico do Pipefy dá a fase de DESTINO,
    -- não a de origem — igual ao que o poll grava. A transição é derivada com LAG na leitura.
    SELECT v_lead_id, v_card_id, NULL::text, ent.to_phase, ent.to_phase_id, v_agent_id, ent.occurred_at
    FROM ent
    WHERE NOT EXISTS (
      SELECT 1 FROM public.lead_events x
      WHERE x.pipefy_card_id = v_card_id
        AND x.to_phase_id IS NOT DISTINCT FROM ent.to_phase_id
        AND x.occurred_at = ent.occurred_at
    )
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM ins;

  -- O histórico pode revelar uma passagem por Remarketing que o poll perdeu.
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(payload->'entries', '[]'::jsonb)) e
    JOIN public.lead_phases p ON p.pipefy_phase_id = NULLIF(e->>'phase_id', '')
    WHERE p.marks_reaproveitado
  ) INTO v_reaprov;

  IF v_reaprov THEN
    UPDATE public.leads SET reaproveitado = true
    WHERE id = v_lead_id AND NOT reaproveitado;
  END IF;

  RETURN jsonb_build_object('lead_id', v_lead_id, 'inserted', v_inserted, 'reaproveitado', v_reaprov);
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_lead_phase_history(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.ingest_lead_phase_history(jsonb) TO service_role;

-- ── 7. Contagem de reaproveitados no período (KPI) ───────────────────────────
-- Mesmo recorte dos demais KPIs de topo: cohort = recebidos no período (created_at).
-- `total` = quantos desses já passaram por Remarketing; `emAberto` = os que ainda não
-- foram finalizados (é o número acionável: dá pra retrabalhar).
CREATE OR REPLACE FUNCTION public.get_leads_reaproveitados(p_start timestamptz, p_end timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'total',    count(*) FILTER (WHERE p.is_reaproveitado),
    'emAberto', count(*) FILTER (WHERE p.is_reaproveitado AND p.is_open)
  )
  FROM public.v_lead_progress p
  WHERE p.created_at >= p_start AND p.created_at < p_end;
$$;

GRANT EXECUTE ON FUNCTION public.get_leads_reaproveitados(timestamptz, timestamptz) TO authenticated;

-- ── 8. Guarda: fase do Pipefy que o app não conhece ──────────────────────────
-- Foi o silêncio que deixou este bug rodar por meses: uma fase nova entrou no pipe,
-- ficou com kind/funnel_order NULL e nada gritou. Esta view deixa isso visível — se
-- devolver linha, tem fase para cadastrar em lead_phases.
-- security_invoker: só quem já enxerga os leads (manager/admin) enxerga o alerta.
CREATE OR REPLACE VIEW public.v_leads_unknown_phase
WITH (security_invoker = true) AS
SELECT
  l.current_phase_id  AS pipefy_phase_id,
  l.current_phase     AS name,
  count(*)            AS leads,
  max(l.synced_at)    AS ultimo_sync
FROM public.leads l
LEFT JOIN public.lead_phases p ON p.pipefy_phase_id = l.current_phase_id
WHERE l.current_phase_id IS NOT NULL
  AND p.pipefy_phase_id IS NULL
GROUP BY l.current_phase_id, l.current_phase;

COMMIT;

-- ============================================================================
-- Conferir depois de aplicar (rode separado, no SQL Editor)
-- ============================================================================
-- 1) A fase entrou e está marcada:
--   SELECT pipefy_phase_id, name, kind, funnel_order, marks_reaproveitado
--   FROM public.lead_phases WHERE marks_reaproveitado;
--   -- esperado: 1 linha, Remarketing, produtiva, funnel_order NULL.
--
-- 2) Nenhuma fase desconhecida sobrando:
--   SELECT * FROM public.v_leads_unknown_phase;
--   -- esperado: 0 linhas. Se aparecer alguma, cadastre em lead_phases.
--
-- 3) Reaproveitados semeados (antes do backfill; o número cresce depois dele):
--   SELECT count(*) FROM public.leads WHERE reaproveitado;
--
-- 4) O funil 0..9 NÃO mudou de forma (Remarketing não tem degrau):
--   SELECT public.get_leads_reach_funnel('2026-08-11T03:00:00Z','2026-09-11T03:00:00Z')
--          -> 'funnelByOrder';
--
-- 5) DEPOIS de `npm run backfill:leads-phases`, a contagem por fase tem que bater
--    com o Pipefy. Comparativo rápido do que o app enxerga:
--   SELECT current_phase, count(*) FROM public.leads GROUP BY 1 ORDER BY 2 DESC;
--   -- em 01/set/2026 o Pipefy tinha: Remarketing 2284, Sem Finalidade 1223,
--   -- 1° Acionamento 604, Empréstimo 519, 2° Acionamento 502, 3° Acionamento 455,
--   -- Procedimento 499, 4° Acionamento 250, Venda 123, 5° Acionamento 88,
--   -- 6° Acionamento 28, Quitação/Negociação 25, Fechamento 14, Recebidos 6.
-- ============================================================================
