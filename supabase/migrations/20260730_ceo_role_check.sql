-- ============================================================================
-- Painel do CEO — Sprint 0 (correção): liberar 'ceo' no CHECK de profiles.role
-- ============================================================================
-- Complementa 20260729_ceo_role.sql. Aquela migration tratou o caso de
-- `profiles.role` ser ENUM (`ALTER TYPE ... ADD VALUE`). A introspecção na base
-- ao vivo (2026-07-30) mostrou que NÃO é enum: é `text` (typtype=b) com um CHECK
--
--   profiles_role_check
--     CHECK (role = ANY (ARRAY['pending','agent','supervisor','manager','admin']))
--
-- que rejeita 'ceo' exatamente como um enum sem o valor rejeitaria. A PARTE 1 da
-- migration anterior detectou o não-enum e retornou sem fazer nada — correto
-- quanto ao enum, incompleto quanto ao CHECK. É esse buraco que esta fecha.
--
-- Seguro: só ALARGA o domínio permitido (adiciona um valor), então nenhuma linha
-- existente pode violar o constraint novo — não há risco de a validação falhar.
-- DROP + ADD na mesma transação para não existir janela sem constraint.
--
-- Idempotente: reexecutar é inofensivo (DROP IF EXISTS + ADD com a lista final).
-- Roda em bloco único — pode colar inteira no editor SQL do Supabase.
-- ============================================================================

BEGIN;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY['pending', 'agent', 'supervisor', 'manager', 'admin', 'ceo']::text[]));

COMMIT;


-- ── Verificação ─────────────────────────────────────────────────────────────
-- 1) O CHECK agora aceita 'ceo'?
--      SELECT pg_get_constraintdef(oid) FROM pg_constraint
--      WHERE conrelid = 'public.profiles'::regclass AND conname = 'profiles_role_check';
--
-- 2) Promover o CEO — ou pela UI do /admin, que já lista o papel no select:
--      UPDATE public.profiles SET role = 'ceo' WHERE email = '<email-do-ceo>';
--
-- 3) Conferir:
--      SELECT email, role FROM public.profiles WHERE role = 'ceo';
