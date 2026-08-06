-- ============================================================================
-- Sprint 7d — Área do admin: email no profile (para listar usuários)
-- ============================================================================
-- O email vive em auth.users (inacessível por RLS). Para o admin listar/gerenciar
-- usuários sem service_role, espelhamos o email em public.profiles: preenchido
-- pelo trigger no cadastro + backfill dos já existentes. Idempotente.
-- ============================================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;

-- Backfill dos perfis já criados
UPDATE public.profiles p
  SET email = u.email
  FROM auth.users u
  WHERE u.id = p.id AND p.email IS DISTINCT FROM u.email;

-- Trigger passa a capturar o email no cadastro
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    'pending'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
