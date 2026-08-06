-- ============================================================================
-- Sprint 6.4 — Notificação pós-chamada (Make)
-- ============================================================================
-- Quais disposições, por campanha, disparam o webhook de notificação ao Make.
-- Ex: ["interested", "callback"]. Vazio = nenhuma notificação.
-- Idempotente (IF NOT EXISTS).
-- ============================================================================

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS notify_dispositions jsonb NOT NULL DEFAULT '[]'::jsonb;
