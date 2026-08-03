# Correção crítica — vencimento da minuta trocando dia/mês (DD/MM ↔ MM/DD)

**Data:** 2026-07-30 · **Migration:** `supabase/migrations/20260730_cs_parse_date_ptbr.sql`
✅ **aplicada** (confirmado por chamada ao vivo em 31/jul: `cs_parse_date('08/04/2026')` →
`2026-04-08`, e não `2026-08-04`) · **Frontend:** nenhuma mudança.

> **A mesma armadilha reapareceu no dia seguinte, em outro domínio.** O pipe do Financeiro
> (Painel do CEO, Sprint 1) também manda `DD/MM/YYYY` com `datetime_value` nulo. Lá o
> `fin_parse_date` já nasceu com `to_date(...,'DD/MM/YYYY')` **porque este fix existia** — foi a
> amostra de valores reais que denunciou, antes de escrever o parser. Ver
> [`introspeccao-pipefy-financeiro.md`](../../projetopainelceo-docs/updates/introspeccao-pipefy-financeiro.md).
> Conclusão pra qualquer pipe novo: **nunca assumir ISO em campo `date` do Pipefy.**

## Sintoma

No painel de CS (Página 3 — Minutas), o vencimento aparecia com dia e mês trocados.
Ex.: minuta com quitação **08/04/2026** (8 de abril) era exibida como **04/08/2026**.
Parecia intermitente porque uma parte das minutas simplesmente não aparecia (ver abaixo).

## Causa-raiz (confirmada com dado real do Pipefy)

A suposição da migration `20260727_cs_minutas.sql` estava errada: o campo
`data_da_quita_o` **não** vem em ISO `YYYY-MM-DD`. Vem em **brasileiro `DD/MM/YYYY`**
(probe 2026-07-30: `value="30/06/2028"`, `"08/04/2026"`, …).

O `cs_parse_date` antigo fazia `left(raw,10)::date`, que castava usando o **DateStyle do
servidor (Postgres = MDY)**. Confirmado **empiricamente** chamando a RPC atual (2026-07-30) e
cruzando com o valor cru do Pipefy:

- **dia ≤ 12** → Postgres lê como MM/DD e **troca dia↔mês** (`08/04/2026` → `2026-08-04`,
  exibido `04/08/2026`; `05/04/2028` → `2028-05-04`). ← o sintoma relatado.
- **dia > 12** → o cast estoura a faixa (mês > 12) → `EXCEPTION` → `NULL`, e a minuta
  **some** da lista (conta só em `withoutMinuta`). Não é intermitente: **todo** card com
  dia > 12 sumia.

**Impacto medido (antes → depois de aplicar):** **680 → 1374** minutas e **813 → 119** em
`withoutMinuta`. Ou seja, ~694 minutas reais (dia > 12) que estavam sendo derrubadas voltaram, e
as de dia ≤ 12 deixaram de aparecer trocadas. Anos presentes ficaram sãos: 2024–2029.

## Correção

Redefinir `cs_parse_date` para converter `DD/MM/YYYY` **explicitamente** com `make_date`
(independe do DateStyle) e continuar tolerando ISO por segurança. Como o valor cru fica em
`cs_cards.metadata` (texto) e o parse roda na **leitura** (`get_cs_minutas`), **só redefinir
a função corrige todos os cards existentes — sem reingestão nem alteração de dados**. As RPCs
que chamam a função pegam a nova definição na hora.

**Guarda de sanidade (v2):** `metadata.value` é texto livre do Pipefy e às vezes tem ano digitado
errado — achado real: card `1156296938` com `value="03/10/0004"` (ano 0004), que virava uma
"vencida" fantasma de ~−738 mil dias. A função passa a devolver `NULL` para ano fora de
`2000..2100` (o card cai em `withoutMinuta`). Faixa folgada — todo dado real está em 2024–2029.
Esse card específico ainda vale corrigir na origem (Pipefy). Se a v1 já foi aplicada, **re-rodar**
a migration (é `CREATE OR REPLACE`).

Verificação: `SELECT cs_parse_date('08/04/2026')` → `2026-04-08`;
`cs_parse_date('30/06/2028')` → `2028-06-30`; `cs_parse_date('03/10/0004')` → `NULL`;
ISO segue funcionando.

## Aplicar

Rodar `20260730_cs_parse_date_ptbr.sql` no Supabase (SQL editor). Sem passo de frontend —
o `fmtDate` do componente já formata ISO → `DD/MM/AAAA` corretamente.
