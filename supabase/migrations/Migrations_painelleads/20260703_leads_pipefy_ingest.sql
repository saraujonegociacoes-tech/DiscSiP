-- ============================================================================
-- Dashboard de Leads (Pipefy) — S0: função de ingestão (Make chama isto)
-- ============================================================================
-- Em vez de o Make orquestrar N escritas, ele faz UMA chamada RPC com o payload
-- do card. A função registra os responsáveis, faz upsert do lead, insere o evento
-- e marca responsabilidade duplicada — de forma atômica e idempotente. Lógica
-- versionada no repo (testável); o cenário do Make vira um módulo HTTP só.
--
-- Chaves por ID do Pipefy: agente por pipefy_user_id, fase por pipefy_phase_id
-- (o teste da API mostrou nomes/fases com espaço no fim — id é a única chave segura).
--
-- Segurança: SECURITY DEFINER (escreve livre, ignora RLS), mas EXECUTE é REVOGADO
-- do público e concedido só ao service_role. Um usuário logado do app NÃO pode
-- chamar isto para forjar leads — só o Make (service_role key) chama.
--
-- Idempotência: upsert do lead por pipefy_card_id + dedup de evento por
-- (card_id, to_phase_id, occurred_at), então reenvio do Make não duplica.
--
-- Contrato do payload:
--   { card_id, title, to_phase, to_phase_id, from_phase,
--     responsibles: [ { id, name, email }, ... ],   // ordem: último = mais recente
--     created_at, first_contact_at, finalized_at, updated_at,
--     channel, discard_reason, occurred_at, raw }
-- ============================================================================

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
BEGIN
  IF v_card_id IS NULL THEN
    RAISE EXCEPTION 'ingest_lead_event: card_id é obrigatório';
  END IF;

  v_dup := jsonb_array_length(v_resp) > 1;  -- 2+ responsáveis => alerta, não métrica individual

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
    created_at, first_contact_at, finalized_at, updated_at, metadata, synced_at
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
    now()
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
    synced_at             = now()
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

-- Só o Make (service_role) chama; ninguém do app pode forjar leads
REVOKE ALL ON FUNCTION public.ingest_lead_event(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.ingest_lead_event(jsonb) TO service_role;
