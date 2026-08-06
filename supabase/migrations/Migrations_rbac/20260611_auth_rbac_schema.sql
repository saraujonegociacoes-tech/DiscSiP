-- ============================================================================
-- Sprint 7a — Autenticação e Permissões (RBAC): fundação de schema
-- ============================================================================
-- Aditivo e não-destrutivo: cria departments + profiles (ligado ao auth.users),
-- trigger de criação de perfil no cadastro, funções helper para RLS e
-- campaigns.department_id. NÃO troca o login nem dropa a tabela `agents` ainda
-- (cutover acontece no 7b). Idempotente.
--
-- O RLS real entra no 7c. Aqui apenas DESTRAVAMOS temporariamente as tabelas
-- novas que ficaram com RLS ligado sem política (lists, campaign_agents) para o
-- app seguir utilizável durante o desenvolvimento.
-- ============================================================================

-- ── Departamentos ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.departments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── Perfis (identidade do app, 1:1 com auth.users) ──────────────────────────
-- role 'pending' = cadastrado mas ainda não aprovado por um admin
CREATE TABLE IF NOT EXISTS public.profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name          text NOT NULL,
  role          text NOT NULL DEFAULT 'pending'
                  CHECK (role IN ('pending', 'agent', 'supervisor', 'manager', 'admin')),
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  extension     integer UNIQUE
                  CHECK (extension IS NULL OR (extension >= 5125 AND extension <= 5150)),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_department ON public.profiles (department_id);

-- ── Trigger: cria o perfil automaticamente quando alguém se cadastra ────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    'pending'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── Funções helper para RLS (SECURITY DEFINER evita recursão de política) ───
CREATE OR REPLACE FUNCTION public.current_profile_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_profile_dept()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT department_id FROM public.profiles WHERE id = auth.uid();
$$;

-- ── Campanha pertence a um departamento (supervisor enxerga o seu) ──────────
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;

-- ── RLS temporário (até o 7c instalar as políticas reais) ───────────────────
ALTER TABLE public.profiles        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.lists           DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_agents DISABLE ROW LEVEL SECURITY;
