-- ============================================================================
-- Dashboard de Leads (Pipefy) — RPC ingest_lead_card(node)
-- ============================================================================
-- Aceita o NODE cru do Pipefy (um card do allCards) e faz a tradução para o
-- payload no banco, delegando ao ingest_lead_event já testado. Assim o Make não
-- precisa montar payload: depois do Iterator, é um POST com { "node": {{node}} }.
--
-- Idempotente (CREATE OR REPLACE). Rode no SQL Editor. Já consolidado também no
-- leads_dashboard_setup.sql. EXECUTE só para service_role (o Make).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ingest_lead_card(node jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_fields    jsonb := COALESCE(node->'fields', '[]'::jsonb);
  v_assignees jsonb := COALESCE(node->'assignees', '[]'::jsonb);
  v_ids       jsonb;
  v_resp      jsonb;
  v_discard   text;
  v_payload   jsonb;
BEGIN
  -- IDs do responsável vêm do campo respons_vel (array_value)
  SELECT COALESCE(fe->'array_value', '[]'::jsonb) INTO v_ids
  FROM jsonb_array_elements(v_fields) fe
  WHERE fe->'field'->>'id' = 'respons_vel'
  LIMIT 1;
  v_ids := COALESCE(v_ids, '[]'::jsonb);

  IF jsonb_typeof(v_ids) = 'array' AND jsonb_array_length(v_ids) > 0 THEN
    -- responsáveis por id, enriquecendo nome/email do assignees (por id)
    SELECT COALESCE(jsonb_agg(
             jsonb_build_object('id', t.rid, 'name', a.name, 'email', a.email)
             ORDER BY t.ord), '[]'::jsonb)
    INTO v_resp
    FROM jsonb_array_elements_text(v_ids) WITH ORDINALITY AS t(rid, ord)
    LEFT JOIN LATERAL (
      SELECT ae->>'name' AS name, ae->>'email' AS email
      FROM jsonb_array_elements(v_assignees) ae
      WHERE ae->>'id' = t.rid
      LIMIT 1
    ) a ON true;
  ELSE
    -- fallback: assignees do card (quando respons_vel está vazio)
    SELECT COALESCE(jsonb_agg(
             jsonb_build_object('id', ae->>'id', 'name', ae->>'name', 'email', ae->>'email')), '[]'::jsonb)
    INTO v_resp
    FROM jsonb_array_elements(v_assignees) ae;
  END IF;

  -- motivo de descarte: motivo_descarte tem prioridade; senão 1º informe_o_motivo* não vazio
  SELECT val INTO v_discard
  FROM (
    SELECT fe->>'value' AS val, (fe->'field'->>'id') AS id
    FROM jsonb_array_elements(v_fields) fe
    WHERE fe->'field'->>'id' = 'motivo_descarte'
       OR fe->'field'->>'id' LIKE 'informe_o_motivo%'
  ) s
  WHERE COALESCE(trim(val), '') <> ''
  ORDER BY (id = 'motivo_descarte') DESC
  LIMIT 1;

  v_payload := jsonb_build_object(
    'card_id',          node->>'id',
    'title',            COALESCE(
                          (SELECT fe->>'value' FROM jsonb_array_elements(v_fields) fe WHERE fe->'field'->>'id'='nome' LIMIT 1),
                          node->>'title'),
    'to_phase',         node->'current_phase'->>'name',
    'to_phase_id',      node->'current_phase'->>'id',
    'from_phase',       NULL,
    'responsibles',     v_resp,
    'created_at',       node->>'created_at',
    'updated_at',       node->>'updated_at',
    'finalized_at',     node->>'finished_at',
    'first_contact_at', (SELECT fe->>'datetime_value' FROM jsonb_array_elements(v_fields) fe WHERE fe->'field'->>'id'='1_acionamento_hora' LIMIT 1),
    'channel',          (SELECT fe->>'value' FROM jsonb_array_elements(v_fields) fe WHERE fe->'field'->>'id'='capta_o_do_lead' LIMIT 1),
    'discard_reason',   v_discard,
    'occurred_at',      node->>'updated_at',
    'raw',              node
  );

  RETURN public.ingest_lead_event(v_payload);
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_lead_card(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.ingest_lead_card(jsonb) TO service_role;
