-- ============================================================================
-- Sprint 7b-ii — Cutover de identidade (destrutivo): repontar FKs e dropar agents
-- ============================================================================
-- A identidade do app é `profiles` (id = auth.users.id). Aqui:
--   1. Limpamos referências órfãs aos antigos `agents` (dados de teste).
--   2. Repontamos as FKs *_agent_id para profiles(id).
--   3. Dropamos a tabela `agents`.
--
-- Limpeza é seletiva (só o que NÃO existe em profiles) e idempotente — não apaga
-- contatos/listas/campanhas, apenas desfaz vínculos com agentes que sumiram.
--
-- NB: após rodar, o supervisor precisa re-adicionar os participantes das campanhas
-- (campaign_agents) pela tela de configuração, agora escolhendo entre os profiles.
-- ============================================================================

-- ── 1. Limpeza de referências órfãs ─────────────────────────────────────────

-- call_logs.agent_id pode ficar nulo (histórico preservado, só desatribuído)
ALTER TABLE public.call_logs ALTER COLUMN agent_id DROP NOT NULL;
UPDATE public.call_logs
  SET agent_id = NULL
  WHERE agent_id IS NOT NULL
    AND agent_id NOT IN (SELECT id FROM public.profiles);

-- campaign_agents.agent_id é NOT NULL: removemos os vínculos órfãos
DELETE FROM public.campaign_agents
  WHERE agent_id NOT IN (SELECT id FROM public.profiles);

-- campaign_contacts: desatribui contatos de agentes que sumiram e devolve à fila
-- os que ficaram presos em 'dialing' no momento do cutover
UPDATE public.campaign_contacts
  SET assigned_agent_id = NULL
  WHERE assigned_agent_id IS NOT NULL
    AND assigned_agent_id NOT IN (SELECT id FROM public.profiles);

UPDATE public.campaign_contacts
  SET status = 'pending', assigned_agent_id = NULL
  WHERE status = 'dialing';

-- ── 2. Repontar as FKs para profiles(id) ────────────────────────────────────

-- (idempotente: dropa qualquer FK existente nessas colunas antes de recriar)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT con.conname, rel.relname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
    WHERE con.contype = 'f'
      AND rel.relname IN ('call_logs', 'campaign_agents', 'campaign_contacts')
      AND att.attname IN ('agent_id', 'assigned_agent_id')
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', r.relname, r.conname);
  END LOOP;
END $$;

ALTER TABLE public.call_logs
  ADD CONSTRAINT call_logs_agent_id_fkey FOREIGN KEY (agent_id)
    REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.campaign_agents
  ADD CONSTRAINT campaign_agents_agent_id_fkey FOREIGN KEY (agent_id)
    REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.campaign_contacts
  ADD CONSTRAINT campaign_contacts_assigned_agent_id_fkey FOREIGN KEY (assigned_agent_id)
    REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ── 3. Dropar a tabela antiga de identidade ─────────────────────────────────
DROP TABLE IF EXISTS public.agents CASCADE;
