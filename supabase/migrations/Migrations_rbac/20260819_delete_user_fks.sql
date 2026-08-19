-- ============================================================================
-- 20260819_delete_user_fks.sql — destravar a exclusão de usuário PRESERVANDO
-- o histórico
-- ----------------------------------------------------------------------------
-- Contexto: o /admin ganhou o botão "Excluir" (auth.admin.deleteUser), e apagar
-- de auth.users propaga por TODA a árvore de FKs que aponta pra auth.users e
-- pra public.profiles (que é `id ... REFERENCES auth.users ON DELETE CASCADE`).
-- Varremos essa árvore inteira antes de ligar o botão. O resultado:
--
--   SET NULL — histórico sobrevive, só perde o autor. Nada a fazer:
--     call_logs.agent_id, campaign_contacts.assigned_agent_id, leads.profile_id,
--     cs_custos/*.profile_id + updated_by, monday_tasks.assignee_id/created_by,
--     monday_task_comments.author_id, monday_quick_tasks.assignee_id,
--     notifications.actor_id, minutas.created_by.
--
--   CASCADE aceitável — dado pessoal/efêmero ou vínculo, não histórico. Também
--   nada a fazer: profiles (é o ponto da exclusão), agent_presence,
--   campaign_agents, monday_project_members, notifications.user_id,
--   monday_quick_tasks.owner_id (lista pessoal — a UI avisa a contagem antes).
--
--   OS DOIS PROBLEMAS que esta migration conserta:
--
--     1. cs_agents.profile_id nasceu SEM cláusula ON DELETE, ou seja NO ACTION.
--        Um usuário vinculado a um agente do painel CS faria o delete ABORTAR
--        com violação de FK — erro opaco vindo do GoTrue, sem dizer o motivo.
--        → vira ON DELETE SET NULL (o vínculo some, o agente e os cards do CS
--          ficam; é exatamente o que os outros painéis já fazem).
--
--     2. monday_projects.owner_id é CASCADE. Excluir o dono APAGARIA O PROJETO
--        INTEIRO junto — e, em cascata a partir dele, boards, tarefas, sprints e
--        comentários de TODO MUNDO que trabalha nele. É a pior perda de dado do
--        schema e acontece calada.
--        → vira ON DELETE RESTRICT: o banco recusa a exclusão enquanto o usuário
--          ainda for dono de algum projeto. O admin transfere primeiro (o botão
--          "Transferir" já existe) e só então exclui. A Server Action checa isso
--          antes e devolve a mensagem em português; o RESTRICT é a rede de baixo,
--          pra ninguém contornar a checagem por outro caminho.
--
-- IDEMPOTENTE: pode ser reaplicada com segurança. Os nomes das constraints são
-- resolvidos via pg_constraint em vez de chutados, porque estas duas nasceram
-- com nome automático do Postgres e podem divergir entre ambientes.
-- ============================================================================

-- ── 1. cs_agents.profile_id: NO ACTION → SET NULL ───────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  -- A tabela só existe onde o painel CS foi aplicado; sem ela, não há o que fazer.
  IF to_regclass('public.cs_agents') IS NULL THEN
    RAISE NOTICE 'cs_agents não existe neste banco — pulando.';
    RETURN;
  END IF;

  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
    WHERE con.contype = 'f'
      AND rel.relname = 'cs_agents'
      AND att.attname = 'profile_id'
  LOOP
    EXECUTE format('ALTER TABLE public.cs_agents DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;

  ALTER TABLE public.cs_agents
    ADD CONSTRAINT cs_agents_profile_id_fkey FOREIGN KEY (profile_id)
      REFERENCES public.profiles(id) ON DELETE SET NULL;
END $$;

-- ── 2. monday_projects.owner_id: CASCADE → RESTRICT ─────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('public.monday_projects') IS NULL THEN
    RAISE NOTICE 'monday_projects não existe neste banco — pulando.';
    RETURN;
  END IF;

  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
    WHERE con.contype = 'f'
      AND rel.relname = 'monday_projects'
      AND att.attname = 'owner_id'
  LOOP
    EXECUTE format('ALTER TABLE public.monday_projects DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;

  ALTER TABLE public.monday_projects
    ADD CONSTRAINT monday_projects_owner_id_fkey FOREIGN KEY (owner_id)
      REFERENCES auth.users(id) ON DELETE RESTRICT;
END $$;
