-- ============================================================================
-- Painel do CEO — Financeiro: META ESPERADA e a DIÁRIA
-- ============================================================================
-- Pedido do dono (02/set/2026). Todo dia a operação manda no grupo, à mão, um bloco
-- assim:
--
--     Projeção de Hoje:
--     Negociação: 1.000,00   SC: 8.000,00   Comercial: 800,00
--     Total: 9.800,00
--
-- …e o CEO responde pedindo "atualiza os números aqui, junto com a diária". Hoje isso
-- sai de TRÊS prints diferentes. A aba Financeiro já tem o realizado do período e a
-- quebra por departamento; o que faltava era **o número que a operação persegue** — e
-- ele não existe em lugar nenhum do banco. É o que esta migration cria.
--
-- ── O que é a meta aqui ─────────────────────────────────────────────────────
-- UM número: quanto se espera entrar num período inteiro (mês civil ou ciclo 11→10 —
-- os dois recortes do seletor da aba valem ~1 mês, então a mesma meta serve aos dois).
-- A conta que a tela faz em cima dele:
--
--     meta_atual   = meta_esperada − realizado_no_período
--     meta_diaria  = meta_atual ÷ dias úteis restantes no período
--
-- ⚠️ A DIVISÃO NÃO ESTÁ AQUI, de propósito. "Dias úteis restantes" depende de HOJE e
-- do período que está selecionado na tela — muda a cada clique no seletor, sem tocar
-- no banco. Fica em `businessDaysLeft()` (src/lib/period.ts), junto com o resto da
-- aritmética de calendário BRT do app. O banco guarda só o número que o dono digita.
--
-- ── Por que uma tabela nova, e não uma coluna em ceo_custo_config ───────────
-- São dois conceitos com donos diferentes: custo é despesa (Saúde da Equipe), meta é
-- objetivo de receita (Financeiro). Colar os dois no mesmo singleton faria a aba
-- Financeiro depender de uma tabela chamada "custo". O padrão é o mesmo — singleton
-- com CHECK no id, RLS sem policy, RPC SECURITY DEFINER com a guarda ceo/admin —, só
-- a tabela é separada.
--
-- Idempotente. Cria 1 tabela e 2 funções NOVAS; não toca em nada que já existe (em
-- especial, NÃO faz CREATE OR REPLACE de `get_ceo_financeiro` — a leitura da meta é
-- uma RPC à parte justamente para não reescrever aquela função de 130 linhas e cair
-- na armadilha do "quem roda por último vence", ver supabase/migrations/README.md §6).
-- ============================================================================

BEGIN;

-- ── PARTE 1 — A meta (singleton) ────────────────────────────────────────────
-- Uma linha só, garantida pelo CHECK em `id` — mesmo idioma de `ceo_custo_config`
-- (20260805b). Padrão 0 = "não cadastrada": a tela mostra o convite para definir em
-- vez de inventar um alvo.
CREATE TABLE IF NOT EXISTS public.ceo_meta_config (
  id          boolean PRIMARY KEY DEFAULT true CHECK (id),
  meta_mensal numeric(12,2) NOT NULL DEFAULT 0 CHECK (meta_mensal >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

INSERT INTO public.ceo_meta_config (id, meta_mensal) VALUES (true, 0)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.ceo_meta_config IS
  'Meta de entradas esperada por período (mês civil ou ciclo 11→10). Painel do CEO, aba Financeiro — card Diária.';

-- ── PARTE 2 — RLS ───────────────────────────────────────────────────────────
-- RLS ligado e NENHUMA policy, igual a ceo_custo_config/fin_cards: ninguém lê nem
-- escreve direto. As duas RPCs abaixo são a única porta, e carregam a guarda.
ALTER TABLE public.ceo_meta_config ENABLE ROW LEVEL SECURITY;

-- ── PARTE 3 — Leitura ───────────────────────────────────────────────────────
-- Mesma guarda das outras 6 RPCs do painel. Papel errado → NULL, e a action degrada
-- para meta 0 (a aba continua de pé, sem o card da diária).
--
-- ⚠️ O idioma `NOT IN` só é seguro porque `ceo_current_role()` nunca devolve NULL —
-- se devolvesse, `NULL NOT IN (...)` seria NULL, o IF não entraria e a guarda
-- LIBERARIA. Foi bug real, corrigido em 20260731c_ceo_guard_null_safe.sql.
CREATE OR REPLACE FUNCTION public.get_ceo_meta()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.ceo_meta_config;
BEGIN
  IF public.ceo_current_role() NOT IN ('ceo', 'admin') THEN RETURN NULL; END IF;

  SELECT * INTO v_row FROM public.ceo_meta_config WHERE id;

  RETURN jsonb_build_object(
    'meta',      COALESCE(v_row.meta_mensal, 0),
    'updatedAt', to_char(COALESCE(v_row.updated_at, now()) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS')
  );
END;
$$;

-- ── PARTE 4 — Gravação ──────────────────────────────────────────────────────
-- Espelha set_ceo_custo_geral (20260805b): guarda, validação e upsert no singleton.
-- Zero é valor VÁLIDO — é como o dono desliga o card da diária sem SQL.
CREATE OR REPLACE FUNCTION public.set_ceo_meta(p_valor numeric)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.ceo_current_role() NOT IN ('ceo', 'admin') THEN RETURN NULL; END IF;
  IF p_valor IS NULL OR p_valor < 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'valor inválido');
  END IF;

  INSERT INTO public.ceo_meta_config (id, meta_mensal, updated_at, updated_by)
  VALUES (true, p_valor, now(), auth.uid())
  ON CONFLICT (id) DO UPDATE
    SET meta_mensal = EXCLUDED.meta_mensal, updated_at = now(), updated_by = auth.uid();

  RETURN jsonb_build_object('ok', true, 'meta', p_valor);
END;
$$;

REVOKE ALL ON FUNCTION public.get_ceo_meta()          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_ceo_meta(numeric)   FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ceo_meta()        TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_ceo_meta(numeric) TO authenticated;

COMMENT ON FUNCTION public.get_ceo_meta() IS
  'Meta esperada do período para o painel do CEO (guarda ceo/admin). A divisão pela quantidade de dias úteis restantes é feita na tela.';
COMMENT ON FUNCTION public.set_ceo_meta(numeric) IS
  'Grava a meta esperada do período (guarda ceo/admin). 0 = sem meta cadastrada.';

COMMIT;

-- ============================================================================
-- Conferir depois de aplicar
-- ============================================================================
-- 1) O singleton nasceu com uma linha só?
--      SELECT * FROM public.ceo_meta_config;        -- 1 linha, id=true, meta_mensal=0
--
-- 2) Assinatura única (a armadilha do parâmetro com DEFAULT — README.md §6)?
--      SELECT proname, pg_get_function_identity_arguments(oid) FROM pg_proc
--      WHERE proname IN ('get_ceo_meta','set_ceo_meta');
--      -- esperado: get_ceo_meta() e set_ceo_meta(numeric) — UMA linha cada
--
-- 3) Guarda: como service_role (papel fora de ceo/admin) as duas devolvem NULL?
--      SELECT public.get_ceo_meta();      -- NULL
--      SELECT public.set_ceo_meta(300000); -- NULL (e NÃO grava)
--      SELECT meta_mensal FROM public.ceo_meta_config;  -- continua 0
--
-- 4) A tabela está mesmo fechada para leitura direta?
--      -- com o anon/authenticated key: SELECT * FROM ceo_meta_config; → 0 linhas (RLS sem policy)
-- ============================================================================
