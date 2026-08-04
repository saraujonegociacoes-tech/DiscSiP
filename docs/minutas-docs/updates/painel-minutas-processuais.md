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
- **✅ Migration [`20260731b_minutas_processuais.sql`](../../../supabase/migrations/Migrations_minutas/20260731b_minutas_processuais.sql)
  aplicada** pelo dono (03/ago). Precisou de dois fixes durante a aplicação: liberar `juridico` no
  `departments_slug_check` (mesma pegadinha do papel `ceo`/`profiles_role_check`) e trocar `|| 'juridico'`
  por `array_append` (ambiguidade de array literal). Ambos já no arquivo.
- **✅ Carga da planilha rodada** (03/ago): `npm run import:minutas` sobre `Planilha de Minutas
  processuais.xlsx` → **23 acordos / 87 parcelas** (26 pagas + 61 a pagar, R$ 161.064,62 — confere
  com a soma da planilha). Nome da cliente extraído do título, datas americanas `M/D/YYYY`
  normalizadas, "Parcela 02/03" → num/total.
- **🐛 Corrigido na carga (03/ago): 22 parcelas sumiam silenciosamente.** O `parseParcela` pegava
  qualquer `N/M` das observações — que são campo livre cheio de barras: CNPJ `07.440.348/0001-49`
  virava parcela 348, `Data: 24/04/2026` virava parcela 24. Como o banco tem `unique (acordo_id, num)`
  e a RPC faz `on conflict do update`, os números repetidos se **sobrescreviam**: o script reportava
  "87 gravadas" e o banco ficava com 65. Ver [Regras da carga](#carga-da-planilha--scriptsimport-minutasmjs).
- **⚠️ Pendentes do dono:**
  1. **Aplicar [`20260803b_proc_can_access_tester.sql`](../../../supabase/migrations/Migrations_minutas/20260803b_proc_can_access_tester.sql)** —
     o papel `tester` passa no gate da página mas era barrado pela RLS, então o painel abria **vazio**.
  2. Atribuir os usuários do time jurídico ao departamento `juridico` no Admin (hoje são **0**; senão
     o RLS bloqueia a leitura e o `/minutas` aparece vazio pra eles).

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

Migration [`20260731b_minutas_processuais.sql`](../../../supabase/migrations/Migrations_minutas/20260731b_minutas_processuais.sql):

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
3. **Minutas** — tabela/CRUD: filtro por situação, **filtro de período**, **ordenação por
   coluna**, **Nova minuta** (formulário que gera as parcelas), marcar paga/estornar, excluir a
   minuta e export CSV.

### Ordenação e período (aba Minutas)

- **Ordenação por coluna** — clicar no título ordena; o 2º clique inverte. A direção do 1º clique
  segue o TIPO da coluna: texto → A→Z (`localeCompare` pt-BR, acento/caixa não bagunçam), número
  (Parcela, Valor) → **maior→menor**, data (Vencimento, Pagamento) → mais antiga→mais recente.
  **Situação** não é alfabética: ordena por **urgência** (vencida → a pagar → paga), que é como a
  coluna é lida. **Nulos ("—") vão sempre pro fim**, nos dois sentidos — parcela sem valor/data é
  ausência de informação, não o "menor" de todos. Empate desempata por vencimento e depois cliente
  (a ordem antiga), então a lista nunca "treme" entre renders.
- **Filtro de período** — um `<select>` só, com **mês civil** e **ciclo 11→10** em `optgroup` +
  Personalizado (reusa `recentCivilMonths`/`recentCycles`/`customPeriod` de
  [`src/lib/period.ts`](../../../src/lib/period.ts)). Default **"Todo o período"**: a aba não
  esconde nada até o usuário pedir. ⚠️ A janela casa com a data que DEFINE a linha — parcela paga
  entra pela **data de pagamento**, parcela em aberto pelo **vencimento**. É a mesma regra da Visão
  Geral; se a Lista filtrasse só por vencimento, as duas abas mostrariam contagens diferentes pro
  mesmo mês. O recorte vale também pro total do rodapé e pro **export CSV**.

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
- **⚠️ "Parcela N/M" é ANCORADO na palavra "parcela".** As observações são campo livre com CNPJ,
  PIX, agência e datas — sem a âncora, `07.440.348/0001-49` virava parcela 348. Não confie em
  `N/M` solto.
- **⚠️ Numeração ÚNICA por acordo (senão some parcela).** O upsert é por `(acordo_id, num)`: dois
  números iguais = uma parcela **sobrescreve** a outra. Quem declara "Parcela N/M" fica com o N (o
  1º a reivindicar, em ordem de vencimento); quem não declarou ou colidiu pega o **menor número
  livre**. A planilha tem colisões legítimas — o acordo da *Marielly* tem 19 linhas para 10
  parcelas (duas favorecidas por parcela, R$ 2.479,60 + R$ 247,96), e o da *AMELIO* repete
  "Parcela 04/04" em duas linhas. Nenhuma linha é descartada; o rótulo original continua nas
  observações da parcela.
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
   22/01/2026. Conferir também que **nenhuma parcela sumiu**: o total de linhas com título na
   planilha tem que bater com `SELECT count(*) FROM proc_parcelas` (o script já reportava certo
   mesmo quando o banco perdia linhas — ver o bug de numeração acima).
6. **Aba Minutas:** clicar em *Valor* → maior primeiro; em *Cliente* → A→Z; em *Situação* →
   vencidas primeiro; 2º clique inverte e os "—" continuam no fim. Escolher um mês no filtro de
   período → contagem/total do rodapé e o CSV exportado seguem o recorte.
