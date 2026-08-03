# Painel de Minutas Processuais (Jurídico)

Área nova do Blue Desk (rota `/minutas`), do departamento **Jurídico**. Controla **minutas
processuais** — obrigações de pagamento ligadas a um número de processo, com parcelas
recorrentes. Ver [`../../links.md`](../../links.md) (índice mestre).

> ⚠️ **Domínio SEPARADO das "Minutas" do CS.** As "Minutas" do painel de CS (aba dentro de
> `/cs`, tabelas `cs_*`) são acordos/quitações de dívida do Customer Success. Estas — minutas
> **processuais** — são outra coisa: prefixo próprio `proc_*`, rota própria `/minutas`, tipos
> próprios. Não misturar.

## Estado (03/ago/2026): NO AR — migration aplicada + carga rodada

Área completa construída em uma leva: migration, RLS, RPCs, 3 abas e script de carga.

- **App-native/CRUD** (não é espelho de pipe). Diferente de CS/Financeiro (read-only, alimentados
  pelo Pipefy via Make), aqui o app **lê e escreve** com RLS aplicada. Molde do módulo Monday.
- **✅ Migration [`20260731b_minutas_processuais.sql`](../../../supabase/migrations/20260731b_minutas_processuais.sql)
  aplicada** pelo dono (03/ago). Precisou de dois fixes durante a aplicação: liberar `juridico` no
  `departments_slug_check` (mesma pegadinha do papel `ceo`/`profiles_role_check`) e trocar `|| 'juridico'`
  por `array_append` (ambiguidade de array literal). Ambos já no arquivo.
- **✅ Carga da planilha rodada** (03/ago): `npm run import:minutas` sobre `Planilha de Minutas
  processuais.xlsx` → **23 acordos / 87 parcelas** (26 pagas + 61 a pagar). Nome da cliente extraído do
  título, datas americanas `M/D/YYYY` normalizadas, "Parcela 02/03" → num/total.
- **Pendente do dono:** atribuir os usuários do time jurídico ao departamento `juridico` no Admin (senão
  o RLS bloqueia a leitura e o `/minutas` aparece vazio).

## Decisões (com o dono, 31/jul)

- **Acesso:** departamento novo `juridico` + `manager`/`admin`. Gate por papel na página
  ([`src/app/minutas/page.tsx`](../../../src/app/minutas/page.tsx)) + RLS por departamento
  (`proc_can_access()`), no molde dos painéis por vertical (não o de membership do Monday).
- **Carga inicial:** script único a partir da planilha existente; depois, cadastro manual no
  painel. Sem UI de import.
- **Recorrência:** modelo **acordo-pai + parcelas-filhas**. Ao cadastrar escolhe-se a recorrência
  (Mensal/30 dias, Bimestral, Trimestral, Semestral, Anual, Avulsa, Personalizada) e o nº de
  parcelas → a RPC `proc_create_acordo` **gera as parcelas** com vencimentos espaçados pelo
  intervalo (mensal = 30 dias, decisão do dono).

## Modelo de dados

Migration [`20260731b_minutas_processuais.sql`](../../../supabase/migrations/20260731b_minutas_processuais.sql):

- **`proc_acordos`** — a minuta em si: `cliente`, `numero_processo`, `titulo`, `recorrencia`,
  `intervalo_dias`, `parcela_total`, `valor_parcela`, `primeiro_vencimento`, `observacoes`.
- **`proc_parcelas`** — 1 linha por parcela: `acordo_id`, `num`, `valor`, `vencimento`,
  `data_pagamento` (preenchida = paga), `observacoes`. `unique (acordo_id, num)`.
- **Status é derivado** na leitura (não gravado): `pago` se `data_pagamento` preenchida; senão
  `vencida` se já passou do vencimento, senão `pendente`. Corte do dia em BRT.
- **RLS:** `proc_can_access()` = `manager`/`admin` **ou** departamento `juridico`. Policies
  `for all` nas duas tabelas.
- **RPCs:** `proc_create_acordo(...)` (SECURITY INVOKER — gera as parcelas) e
  `proc_ingest_acordo(node jsonb)` (SECURITY DEFINER, só `service_role` — usada pelo script).
- **Departamento:** a migration insere `juridico` em `public.departments` (idempotente).

Tipos no front em [`src/lib/types/database.ts`](../../../src/lib/types/database.ts)
(`ProcAcordo`, `ProcParcela`, `ProcMinutasData`, `Recorrencia`, `CreateMinutaInput`).

## UI — 3 abas

Esqueleto clonado do `CsClient` (abas sincronizadas com `?aba=`). Componentes em
[`src/features/minutas/`](../../../src/features/minutas/); actions em
[`src/app/actions/minutas.ts`](../../../src/app/actions/minutas.ts).

1. **Visão Geral** — KPIs de pago × a pagar na janela (ciclo 11→10 ou mês civil, via
   `CeoPeriodPicker` reusado), buckets por proximidade de vencimento, gráfico mensal
   (pago × a pagar) e insights.
2. **Calendário** — clone do `delivery-calendar` do Monday: um chip por parcela no dia do
   vencimento, cor por situação (pago/pendente/vencida); clicar num dia abre a agenda daquele dia.
3. **Minutas** — tabela/CRUD: filtro por situação, **Nova minuta** (formulário que gera as
   parcelas), marcar paga/estornar, excluir a minuta e export CSV.

## Carga da planilha — `scripts/import-minutas.mjs`

`npm run import:minutas [caminho]` (default `./minutas.csv`). Aceita **CSV e `.xlsx`** (usa a lib
`xlsx`, já dependência). Casa colunas por **nome** (tolerante a acento/caixa), então a ordem não
importa e colunas extras são ignoradas. Mapeia:

| Coluna da planilha | Vira |
|---|---|
| Nome da Cliente / Cliente | `cliente` |
| Número do processo / Processo | `numero_processo` (chave de agrupamento) |
| Título | `titulo` |
| Fase atual (ex.: "Pago") | define parcela paga (`data_pagamento`) |
| Data de Vencimento | `vencimento` |
| Valor da Conta / Valor | `valor` |
| Data de pagamento (se houver) | `data_pagamento` |
| Observações ("Parcela 02/03") | `num`/`total` da parcela |

**Regras da carga:**
- **⚠️ Datas em formato americano** `M/D/YYYY` (ex.: `1/22/2026` = 22/jan). O parser detecta a
  ordem (componente > 12 decide) e, no caso ambíguo, usa `MINUTAS_DATE_ORDER` (default `MDY`).
  Sempre grava ISO. **Confirmar o formato real da planilha ao rodar** (se vier DD/MM, passar
  `MINUTAS_DATE_ORDER=DMY`).
- **Agrupamento:** linhas com o mesmo número de processo viram um acordo; sem processo, agrupa por
  cliente+título. Parcelas sem "Parcela N/M" recebem número sequencial por vencimento.
- **Recorrência inferida** quando ausente: acordo com >1 parcela → `mensal`; senão `avulsa`.
- **Idempotente:** re-rodar é seguro (upsert do acordo + parcelas por `(acordo, num)`).

## Verificação

1. `npm run build` verde.
2. Aplicar a migration; conferir `SELECT slug FROM departments WHERE slug='juridico'` e
   `SELECT public.proc_parse_date('2026-01-22')`.
3. **Acesso:** usuário jurídico vê "Minutas Processuais" na sidebar e abre `/minutas`; agente de
   outro depto não vê e é redirecionado de `/minutas` para `/`.
4. **CRUD:** Nova minuta Mensal (30 dias) + 3 parcelas → 3 parcelas espaçadas 30 dias; marcar a 1ª
   paga → KPIs e calendário refletem; excluir remove acordo + parcelas.
5. **Carga:** `npm run import:minutas amostra.csv` → conferir contagem e que `1/22/2026` virou
   22/01/2026.
