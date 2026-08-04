-- Libera o módulo de aquecimento também para SUPERVISOR (antes: só manager/admin).
-- Agente continua sem acesso. Recria as policies de RLS com o papel supervisor
-- incluído. Idempotente (DROP IF EXISTS + CREATE). A navegação (Sidebar), o guard
-- do middleware e a server action (canAccessWarmup) já foram atualizados no código.
--
-- Rodar no SQL Editor do Supabase depois de aplicada a 20260719_warmup_schema.sql.

-- ── Tabelas de CONFIGURAÇÃO: CRUD para supervisor/manager/admin ──────────────
DROP POLICY IF EXISTS warmup_numbers_all ON public.warmup_numbers;
CREATE POLICY warmup_numbers_all ON public.warmup_numbers FOR ALL TO authenticated
  USING (public.warmup_current_role() IN ('supervisor', 'manager', 'admin'))
  WITH CHECK (public.warmup_current_role() IN ('supervisor', 'manager', 'admin'));

DROP POLICY IF EXISTS warmup_settings_all ON public.warmup_settings;
CREATE POLICY warmup_settings_all ON public.warmup_settings FOR ALL TO authenticated
  USING (public.warmup_current_role() IN ('supervisor', 'manager', 'admin'))
  WITH CHECK (public.warmup_current_role() IN ('supervisor', 'manager', 'admin'));

DROP POLICY IF EXISTS warmup_templates_all ON public.warmup_templates;
CREATE POLICY warmup_templates_all ON public.warmup_templates FOR ALL TO authenticated
  USING (public.warmup_current_role() IN ('supervisor', 'manager', 'admin'))
  WITH CHECK (public.warmup_current_role() IN ('supervisor', 'manager', 'admin'));

DROP POLICY IF EXISTS warmup_ramp_stages_select ON public.warmup_ramp_stages;
CREATE POLICY warmup_ramp_stages_select ON public.warmup_ramp_stages FOR SELECT TO authenticated
  USING (public.warmup_current_role() IN ('supervisor', 'manager', 'admin'));

-- ── Tabelas de EXECUÇÃO: leitura para supervisor/manager/admin ───────────────
-- (escrita continua exclusiva do tick/callback via service_role, sem policy)
DROP POLICY IF EXISTS warmup_conversations_select ON public.warmup_conversations;
CREATE POLICY warmup_conversations_select ON public.warmup_conversations FOR SELECT TO authenticated
  USING (public.warmup_current_role() IN ('supervisor', 'manager', 'admin'));

DROP POLICY IF EXISTS warmup_messages_select ON public.warmup_messages;
CREATE POLICY warmup_messages_select ON public.warmup_messages FOR SELECT TO authenticated
  USING (public.warmup_current_role() IN ('supervisor', 'manager', 'admin'));
