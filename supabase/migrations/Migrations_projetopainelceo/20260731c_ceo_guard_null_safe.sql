-- ============================================================================
-- CORREÇÃO DE SEGURANÇA — a guarda das RPCs do painel do CEO não bloqueava
-- quando `ceo_current_role()` devolvia NULL.
-- Painel do CEO. Ver docs/projetopainelceo-docs/fixes/correcao-guarda-ceo-null.md
-- ============================================================================
-- ⚠️ APLICAR ASSIM QUE POSSÍVEL: afeta `get_ceo_financeiro`, que JÁ ESTÁ EM
-- PRODUÇÃO desde 31/jul, além das 3 RPCs de projeção da mesma data.
--
-- ── O BUG ───────────────────────────────────────────────────────────────────
-- O idioma da guarda, replicado em todas as RPCs do painel, é:
--
--     IF public.ceo_current_role() NOT IN ('ceo', 'admin') THEN RETURN NULL; END IF;
--
-- e `ceo_current_role()` (20260729_ceo_role.sql) é:
--
--     SELECT role::text FROM public.profiles WHERE id = auth.uid()
--
-- Quando NÃO EXISTE linha em `profiles` para o `auth.uid()` da chamada, essa
-- função devolve **NULL** (função SQL escalar sem linhas → NULL). E aí:
--
--     NULL NOT IN ('ceo','admin')   →   NULL      (não TRUE!)
--     IF NULL THEN ... END IF       →   não entra (PL/pgSQL trata NULL como falso)
--
-- ⇒ A guarda **não bloqueia**: a execução cai direto no corpo da função e o
--   painel inteiro é devolvido. O `NOT IN` com NULL é a armadilha clássica de
--   SQL três-valores, e ela passou despercebida porque o caso comum (usuário
--   logado COM profile) funciona certo — `'agent' NOT IN (...)` é TRUE e bloqueia.
--
-- Comprovado ao vivo em 31/jul: chamando via `service_role` (que não tem
-- `auth.uid()`), `ceo_current_role()` devolveu `null` e mesmo assim
-- `get_ceo_projecoes()` retornou o payload completo em vez de NULL.
--
-- ── QUEM CONSEGUIA PASSAR ───────────────────────────────────────────────────
-- Não é buraco aberto pra internet: as RPCs são `REVOKE ... FROM PUBLIC, anon`
-- + `GRANT ... TO authenticated`, então `anon` nem chama. Passava quem estivesse
-- **autenticado mas sem linha em `profiles`** — janela entre o signup e a criação
-- do profile, ou profile removido. Estreito, mas é exatamente o estado em que um
-- usuário NÃO deveria ver o painel executivo.
--
-- ── A CORREÇÃO ──────────────────────────────────────────────────────────────
-- Consertar o HELPER, não cada guarda. Motivos:
--   1. Uma função em vez de quatro — e conserta `get_ceo_financeiro`
--      RETROATIVAMENTE, sem redeclarar o corpo dela (que tem ~140 linhas e está
--      em produção funcionando; mexer nele seria risco sem ganho).
--   2. As RPCs dos Sprints 3 e 4 vão copiar o mesmo idioma da doc. Com o helper
--      não-nulo, elas nascem seguras sem ninguém precisar lembrar disto aqui.
--
-- Sentinela `''`: nenhum papel válido é string vazia, então
-- `'' NOT IN ('ceo','admin')` é TRUE e a guarda bloqueia, como sempre se quis.
--
-- ⚠️ MUDANÇA DE CONTRATO: a partir daqui `ceo_current_role()` NUNCA devolve NULL.
-- Quem quiser distinguir "sem sessão" de "papel X" tem que comparar com `''`, não
-- com NULL. Conferido antes de mudar: os únicos consumidores são as 4 RPCs do
-- painel, e todas usam o `NOT IN` — nenhuma testa `IS NULL`.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ceo_current_role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT role::text FROM public.profiles WHERE id = auth.uid()),
    ''  -- sem sessão ou sem profile: string vazia, nunca NULL (ver o cabeçalho)
  )
$$;

COMMENT ON FUNCTION public.ceo_current_role() IS
  'Papel do usuário logado, para a guarda das RPCs do painel do CEO. NUNCA devolve NULL — sem sessão/profile devolve string vazia, senão `NOT IN` vira NULL e a guarda não bloqueia (corrigido em 20260731c). Ver docs/projetopainelceo-docs/fixes/correcao-guarda-ceo-null.md';


-- ── Conferir depois de aplicar ──────────────────────────────────────────────
-- 1) O helper não devolve mais NULL (rodando no SQL editor, sem auth.uid()):
--      SELECT public.ceo_current_role() IS NULL;   -- esperado: false
--      SELECT public.ceo_current_role() = '';      -- esperado: true
--
-- 2) A guarda agora bloqueia de verdade. Chamando por `service_role` (sem
--    auth.uid()), as quatro RPCs têm que devolver NULL:
--      SELECT public.get_ceo_financeiro(now() - interval '30 days', now()) IS NULL;  -- true
--      SELECT public.get_ceo_projecoes() IS NULL;                                    -- true
--      SELECT public.get_ceo_projecoes_negociacao() IS NULL;                         -- true
--      SELECT public.get_ceo_projecoes_cs() IS NULL;                                 -- true
--    (Antes desta migration, as quatro devolviam o payload completo.)
--
-- 3) O caminho feliz continua: logado como `ceo` ou `admin`, o painel abre normal.
--    Esse é o teste que só dá pra fazer na tela, com sessão de verdade.
