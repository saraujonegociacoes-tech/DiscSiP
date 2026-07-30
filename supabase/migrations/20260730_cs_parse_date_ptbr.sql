-- ============================================================================
-- Painel de CS — CORREÇÃO CRÍTICA de data: cs_parse_date lê DD/MM/YYYY (pt-BR)
-- ============================================================================
-- Bug (confirmado com dado real do Pipefy em 2026-07-30): o campo `data_da_quita_o`
-- (vencimento da minuta) NÃO vem em ISO "YYYY-MM-DD" como a 20260727 assumiu — vem em
-- BRASILEIRO "DD/MM/YYYY" (ex.: value="30/06/2028", "08/04/2026").
--
-- O cs_parse_date antigo fazia `left(raw,10)::date`, que casta usando o DateStyle do
-- servidor (Postgres = MDY). Efeito (confirmado empiricamente chamando a RPC atual, 2026-07-30):
--   • dia ≤ 12 → dia e mês TROCAVAM: 08/04/2026 (8 abr) virava 2026-08-04 → a tela
--     mostrava 04/08/2026. (era o sintoma relatado)
--   • dia > 12 → o cast estourava o range (mês > 12) → EXCEPTION → NULL, e a minuta SUMIA
--     da lista (caía em `withoutMinuta`). Não é "às vezes": TODO card com dia > 12 sumia.
-- Impacto medido: a RPG devolvia 680 minutas e contava 813 em `withoutMinuta` — boa parte
-- dessas 813 são minutas reais (dia > 12) que foram DERRUBADAS. O fix reergue todas e
-- desfaz a troca das demais.
--
-- Correção: converter DD/MM/YYYY EXPLICITAMENTE com make_date (independe do DateStyle).
-- Continua tolerando ISO "YYYY-MM-DD"/datetime por segurança. Como o valor cru fica em
-- cs_cards.metadata (texto) e o parse roda na LEITURA (get_cs_minutas), só redefinir a
-- função já corrige TODOS os cards existentes — sem reingestão, sem tocar em dado.
-- Resultado medido depois de aplicar: 680 → 1374 minutas · 813 → 119 `withoutMinuta`.
--
-- Guarda de sanidade (v2, 2026-07-30): metadata.value é texto LIVRE do Pipefy e às vezes tem
-- ano digitado errado (achado real: card 1156296938 = "03/10/0004"). Ano fora de 2000..2100 →
-- NULL, senão o card virava uma "vencida" fantasma de ~−738 mil dias. Faixa folgada: todo dado
-- real está em 2024..2029. Se você JÁ rodou a v1 desta migration, RE-RODE (é CREATE OR REPLACE).
--
-- Migration forward-only: apenas CREATE OR REPLACE de cs_parse_date. As RPCs
-- (get_cs_minutas etc.) chamam a função por nome e pegam a nova definição na hora.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cs_parse_date(raw text)
RETURNS date
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  s text;
  m text[];
  d date;
BEGIN
  IF raw IS NULL THEN RETURN NULL; END IF;
  s := trim(raw);
  IF s = '' THEN RETURN NULL; END IF;

  -- (1) BRASILEIRO "DD/MM/YYYY" — formato REAL do Pipefy (data_da_quita_o). Extrai os 3
  --     grupos e monta com make_date(ano, mês, dia): NÃO depende do DateStyle, então nunca
  --     troca dia/mês. Data fora de faixa (mês>12 etc.) → EXCEPTION → NULL (tolerante).
  m := regexp_match(s, '^([0-9]{1,2})/([0-9]{1,2})/([0-9]{4})');
  IF m IS NOT NULL THEN
    d := make_date(m[3]::int, m[2]::int, m[1]::int);
  ELSE
    -- (2) ISO "YYYY-MM-DD" (ou datetime "YYYY-MM-DDThh:mm…"): os 10 primeiros chars.
    --     Mantido por tolerância (se o Pipefy mudar a config do campo ou vier outro campo ISO).
    d := left(s, 10)::date;
  END IF;

  -- (3) Guarda de sanidade: ano implausível = lixo de digitação → NULL (vira "sem minuta",
  --     não uma vencida fantasma). Nenhum dado real chega perto dos limites (2024..2029).
  IF d < DATE '2000-01-01' OR d > DATE '2100-12-31' THEN
    RETURN NULL;
  END IF;
  RETURN d;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- ── Conferir depois de aplicar ──────────────────────────────────────────────
-- SELECT public.cs_parse_date('08/04/2026');   -- espera 2026-04-08 (8 de abril)
-- SELECT public.cs_parse_date('30/06/2028');   -- espera 2028-06-30
-- SELECT public.cs_parse_date('2026-04-08');    -- ISO ainda funciona → 2026-04-08
-- SELECT public.cs_parse_date('03/10/0004');    -- → NULL (ano lixo, guarda de sanidade)
-- SELECT public.cs_parse_date('lixo');          -- → NULL (tolerante)
-- SELECT (get_cs_minutas() -> 'cards' -> 0);    -- espiar 1 card: dueDate agora correto
