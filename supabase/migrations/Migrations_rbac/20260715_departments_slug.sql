-- ============================================================================
-- departments.slug — identificador estável de área de negócio
-- ============================================================================
-- Contexto: o painel de Sucesso do Cliente (CS) é um domínio novo, separado do
-- painel de Leads (comercial). Ambos, mais o futuro painel de Negociação, são
-- departamentos DIFERENTES (não uma subdivisão de um departamento maior) —
-- "Departamento Comercial", "Departamento de CS" e "Departamento de Negociação"
-- já existem como linhas separadas em `departments`.
--
-- Precisamos de uma forma ESTÁVEL de identificar qual linha é qual pra escopar
-- menu lateral e RLS (Sidebar.tsx, RLS de cs_* na Sprint 1) — sem depender do
-- texto de `name`, que é editável pelo admin a qualquer momento.
--
-- slug é opcional (departamentos que não são nenhuma das 3 verticais atuais
-- ficam com slug NULL e simplesmente não aparecem em nenhum grupo do menu).
-- ============================================================================

ALTER TABLE public.departments
  ADD COLUMN IF NOT EXISTS slug text NULL;

ALTER TABLE public.departments
  DROP CONSTRAINT IF EXISTS departments_slug_check;

ALTER TABLE public.departments
  ADD CONSTRAINT departments_slug_check
  CHECK (slug IS NULL OR slug IN ('comercial', 'cs', 'negociacao'));

-- Um único departamento por slug (evita 2 linhas "comercial" competindo pelo
-- mesmo grupo do menu).
CREATE UNIQUE INDEX IF NOT EXISTS departments_slug_unique_idx
  ON public.departments (slug)
  WHERE slug IS NOT NULL;

-- ── Backfill best-effort por nome ──────────────────────────────────────────
-- ATENÇÃO (dono): os nomes reais das linhas de `departments` não estão
-- disponíveis localmente (schema vive só no Supabase). Os padrões abaixo
-- tentam cobrir variações razoáveis de nome, mas CONFIRME o resultado com o
-- SELECT no final antes de seguir — se alguma linha não bater, rode um UPDATE
-- manual avulso (ex.: UPDATE departments SET slug = 'cs' WHERE id = '...').
UPDATE public.departments
  SET slug = 'comercial'
  WHERE slug IS NULL AND name ILIKE '%comercial%';

UPDATE public.departments
  SET slug = 'cs'
  WHERE slug IS NULL
    AND (name ILIKE '%sucesso do cliente%' OR name ILIKE '% cs%' OR name ILIKE 'cs%' OR name ILIKE '%customer success%');

UPDATE public.departments
  SET slug = 'negociacao'
  WHERE slug IS NULL AND name ILIKE '%negocia%';

-- Conferir antes de seguir: cada uma das 3 verticais deve ter exatamente 1 linha.
SELECT slug, count(*) AS departamentos, array_agg(name) AS nomes
FROM public.departments
GROUP BY slug
ORDER BY slug NULLS LAST;
