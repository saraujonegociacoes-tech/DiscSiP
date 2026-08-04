-- ============================================================================
-- 20260803_tester_role.sql — libera o papel 'tester' no profiles_role_check
-- ============================================================================
-- `profiles.role` é text + CHECK `profiles_role_check` (não enum) — mesma pegadinha
-- do 'ceo' (20260730_ceo_role_check.sql) e do depto 'juridico'. 'tester' = acesso
-- total + seletor "ver como" no app (troca só a navegação/gates no cliente, não os
-- dados). Reconstrói o CHECK PRESERVANDO os papéis já permitidos (extraídos da própria
-- definição atual) + 'tester'. Idempotente (aplicada à mão no SQL Editor).
-- ============================================================================
do $$
declare
  v_def  text;
  v_vals text[];
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conname = 'profiles_role_check'
    and conrelid = 'public.profiles'::regclass;

  if v_def is not null then
    select array_agg(distinct m[1]) into v_vals
    from regexp_matches(v_def, '''([^'']+)''', 'g') as m;
  end if;

  v_vals := coalesce(v_vals, array['pending', 'agent', 'supervisor', 'manager', 'admin', 'ceo']);
  if not ('tester' = any (v_vals)) then
    v_vals := array_append(v_vals, 'tester');
  end if;

  alter table public.profiles drop constraint if exists profiles_role_check;
  execute format(
    'alter table public.profiles add constraint profiles_role_check check (role = any (%L::text[]))',
    v_vals
  );
end $$;

-- Conferir: SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='profiles_role_check';
