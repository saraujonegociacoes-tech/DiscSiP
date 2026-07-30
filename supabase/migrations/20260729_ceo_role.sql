-- ============================================================================
-- Painel do CEO — Sprint 0: papel `ceo` (trava de acesso) + helper de RLS
-- ============================================================================
-- Ver docs/projetopainelceo-docs/updates/painel-ceo-sprints.md (Sprint 0).
--
-- O papel `ceo` NÃO é hierárquico: não é "acima de admin", é uma trava LATERAL.
-- Um CEO não opera o discador nem gere usuários — ele só lê o painel executivo.
-- Por isso `ceo` NÃO entra nas policies `IN ('manager','admin')` dos domínios
-- existentes: o acesso dele é centralizado nas RPCs de leitura do painel
-- (SECURITY DEFINER com guarda interna via `ceo_current_role()`). Decisão
-- registrada no doc de sprints. Consequência prática: esta migration não toca
-- em NENHUM RLS de domínio já em produção — o risco de regressão é zero.
--
-- ⚠️ RODAR EM DUAS ETAPAS, nesta ordem. `ALTER TYPE ... ADD VALUE` não permite
-- que o valor novo seja USADO na mesma transação em que foi criado, e o editor
-- SQL do Supabase envolve o script inteiro numa transação só. Execute a PARTE 1,
-- confirme o NOTICE, e só então rode a PARTE 2.
-- ============================================================================


-- ── PARTE 1 — adicionar 'ceo' ao enum de profiles.role ──────────────────────
-- O tipo do enum vive no setup core, que não é versionado, então o nome dele não
-- aparece em nenhuma migration deste repo. Em vez de chutar ('user_role'?
-- 'app_role'?), descobrimos pela própria coluna via catálogo. Idempotente
-- (ADD VALUE IF NOT EXISTS): reexecutar não quebra nada.

DO $$
DECLARE
  v_typoid  oid;
  v_typname text;
  v_typtype "char";
  v_schema  text;
BEGIN
  SELECT a.atttypid, t.typname, t.typtype, n.nspname
    INTO v_typoid, v_typname, v_typtype, v_schema
  FROM pg_attribute a
  JOIN pg_type t      ON t.oid = a.atttypid
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE a.attrelid = 'public.profiles'::regclass
    AND a.attname  = 'role'
    AND a.attnum   > 0
    AND NOT a.attisdropped;

  IF v_typoid IS NULL THEN
    RAISE EXCEPTION 'coluna public.profiles.role não encontrada — abortando';
  END IF;

  -- Se a coluna for text/varchar em vez de enum, não há enum a alterar: o papel
  -- 'ceo' já é gravável como string e a PARTE 1 é desnecessária.
  IF v_typtype <> 'e' THEN
    RAISE NOTICE 'profiles.role é do tipo "%" (não-enum) — nada a fazer na PARTE 1; siga para a PARTE 2', v_typname;
    RETURN;
  END IF;

  EXECUTE format('ALTER TYPE %I.%I ADD VALUE IF NOT EXISTS %L', v_schema, v_typname, 'ceo');
  RAISE NOTICE 'enum %.%: valor ''ceo'' garantido', v_schema, v_typname;
END $$;


-- ── PARTE 2 — helper de papel do painel do CEO ──────────────────────────────
-- Clone de `cs_current_role()` (20260715_cs_pipeline_schema.sql) no namespace
-- `ceo_`, seguindo a convenção de helper por domínio do repo (cs_/warmup_/...).
-- SECURITY INVOKER de propósito, igual aos irmãos: o próprio RLS de `profiles`
-- já libera o usuário a ler a própria linha.
--
-- Consumidor: as RPCs de leitura do painel, a partir do Sprint 1, com a guarda
--   IF public.ceo_current_role() NOT IN ('ceo','admin') THEN RETURN; END IF;
-- Nasce sem consumidor nesta sprint — é a fundação que o Sprint 1 assume pronta.

CREATE OR REPLACE FUNCTION public.ceo_current_role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT role::text FROM public.profiles WHERE id = auth.uid()
$$;

COMMENT ON FUNCTION public.ceo_current_role() IS
  'Papel do usuário logado, para a guarda das RPCs do painel do CEO. Ver docs/projetopainelceo-docs/updates/painel-ceo-sprints.md';


-- ── Verificação (rodar depois das duas partes) ──────────────────────────────
-- 1) 'ceo' está no enum?
--      SELECT e.enumlabel
--      FROM pg_enum e
--      JOIN pg_attribute a ON a.atttypid = e.enumtypid
--      WHERE a.attrelid = 'public.profiles'::regclass AND a.attname = 'role'
--      ORDER BY e.enumsortorder;
--
-- 2) O helper responde?
--      SELECT public.ceo_current_role();
--
-- 3) Promover o CEO (ou fazer pela UI do /admin, que já aceita o papel):
--      UPDATE public.profiles SET role = 'ceo' WHERE email = '<email-do-ceo>';
