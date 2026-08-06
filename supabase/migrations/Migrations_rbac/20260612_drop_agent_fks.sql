-- ============================================================================
-- Sprint 7b-i — Cutover de identidade: soltar as FKs agent_id → agents
-- ============================================================================
-- A identidade do app passa de `agents` para `profiles` (id = auth.users.id).
-- A partir daqui o app grava profile.id nas colunas *_agent_id. Para que esses
-- inserts não violem as FKs antigas (que ainda apontam para `agents`), soltamos
-- essas constraints. A tabela `agents` permanece intacta (vira órfã).
--
-- A migração destrutiva real (limpar dados de teste, repontar FKs → profiles,
-- dropar `agents`) acontece no 7b-ii.
--
-- Idempotente: descobre dinamicamente as FKs que referenciam public.agents nas
-- tabelas com colunas de agente e as remove. Não faz nada se `agents` já sumiu.
-- ============================================================================

DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('public.agents') IS NULL THEN
    RETURN; -- agents já foi dropada (7b-ii já rodou)
  END IF;

  FOR r IN
    SELECT con.conname, rel.relname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE con.contype = 'f'
      AND con.confrelid = 'public.agents'::regclass
      AND rel.relname IN ('call_logs', 'campaign_agents', 'campaign_contacts')
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', r.relname, r.conname);
  END LOOP;
END $$;
