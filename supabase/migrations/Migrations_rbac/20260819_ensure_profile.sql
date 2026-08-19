-- ============================================================================
-- RBAC — rede de segurança contra o "usuário órfão" (auth.users sem profiles)
-- ============================================================================
-- O BUG QUE ISTO CONSERTA (19/ago/2026, caso Kelly Souza):
-- `public.profiles` é 1:1 com `auth.users` e nasce pelo trigger handle_new_user.
-- Se a linha de `profiles` some depois (apagada na mão no Studio, ou trigger que
-- não rodou), a pessoa fica num beco sem saída em TRÊS frentes ao mesmo tempo:
--
--   1. middleware.ts trata `!profile` como pendente → prende em /aguardando;
--   2. /admin lista `profiles` → a pessoa NÃO APARECE para ser aprovada;
--   3. recadastrar não resolve → o e-mail já está em auth.users e o Supabase
--      devolve "já existe uma conta com este email".
--
-- ensure_profile() é o caminho de volta: recria a linha como 'pending' para o
-- usuário LOGADO, devolvendo a pessoa ao fluxo normal de aprovação. É chamada
-- por /aguardando (a rota onde o órfão sempre cai).
--
-- Idempotente. Aditiva: não altera nenhuma política nem nenhuma linha existente.
-- ============================================================================

-- ── Reafirma o trigger de cadastro ──────────────────────────────────────────
-- Mesma definição de 20260615_profiles_email.sql. Repetida aqui de propósito:
-- se o trigger tiver sido perdido em algum ponto, esta migration o traz de volta
-- sem precisar reaplicar a migration antiga.
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── ensure_profile(): recria o perfil do usuário logado, se sumiu ───────────
-- SECURITY DEFINER pelo mesmo motivo do trigger: `profiles` não tem política de
-- INSERT (ver 20260614_rls_policies.sql), então ninguém insere o próprio perfil
-- pelo caminho normal — e não deve mesmo, senão daria para escolher o próprio
-- papel. Aqui o papel é SEMPRE 'pending' e nome/e-mail vêm de auth.users, nunca
-- do cliente: não há nada que o chamador possa forjar.
--
-- ON CONFLICT DO NOTHING: quem já tem perfil não é tocado. Chamar isto num
-- usuário aprovado é um no-op — nunca rebaixa ninguém para 'pending'.
CREATE OR REPLACE FUNCTION public.ensure_profile()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  uid      uuid := auth.uid();
  inserted boolean := false;
BEGIN
  IF uid IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.profiles (id, name, email, role)
  SELECT
    u.id,
    COALESCE(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
    u.email,
    'pending'
  FROM auth.users u
  WHERE u.id = uid
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$$;

-- Só quem tem sessão pode chamar (anon não).
REVOKE ALL     ON FUNCTION public.ensure_profile() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.ensure_profile() TO authenticated;

-- ── Conferência (dono): órfãos restantes. Deve voltar VAZIO. ────────────────
-- Órfão antigo só se conserta quando a pessoa loga (aí /aguardando chama a
-- função). Se aparecer alguém aqui que não vai mais logar, apague o usuário em
-- Authentication → Users, e não a linha de `profiles`.
SELECT u.id, u.email, u.created_at
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ORDER BY u.created_at;
