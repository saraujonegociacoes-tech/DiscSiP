# Painel do CEO — Blue Desk (Pipefy executivo) — sprints

> Criado em 2026-07-28. **Visão executiva filtrada** do que acontece no Pipefy — não
> movimentações cruas, e sim produtividade, financeiro e saúde do negócio. Entrega **por
> sprints**, como domínio de **leitura/agregação** por cima das verticais isoladas
> (Financeiro, CS, Negociação, Leads, Monday/Projetos, Discador). Réplica do padrão dos
> outros painéis (Pipefy → Make → Supabase), com uma **trava forte**: papel novo `ceo`.

## Context

O CEO precisa de uma visão executiva **filtrada** do que acontece no Pipefy. Três blocos de valor:

1. **Financeiro — entradas do mês**: a partir de um **pipe dedicado do Financeiro** (só entradas
   gerais), que **ainda não está integrado** ao Blue Desk.
2. **Projeções de pagamento**: das fases **"Aguardando Pagamento"** dos pipes de **CS** (já
   integrado) e de **Negociação** (pipe próprio, **ainda não integrado**).
3. **Saúde da empresa e da equipe/colaboradores**: indicadores compostos a partir de dados que já
   existem em domínios isolados (CS, Leads, Monday/Projetos, Discador).

Acesso restrito por uma **trava forte**: um papel novo `ceo`.

### Decisões travadas (do Q&A com o dono)
- Fonte financeira = **pipe Financeiro novo** (ingestão do zero).
- Painel puxa de 3 pipes: **Financeiro** (novo) + **CS** (reusar) + **Negociação** (novo, só o
  essencial).
- Projeções de CS: **reutilizar** a lógica/dados que o painel de CS já tem (fase "Aguardando
  Pagamento" já é ingerida). O **único a construir do zero na parte de projeção é a ingestão do
  pipe de Negociação**.
- Trava = **criar papel `ceo`** (novo valor permitido em `profiles.role`).
- Primeiro entregável real (Sprint 1) = **Financeiro (entradas do mês)**.

### Restrições de arquitetura que respeitamos
- O dono **rejeitou schema genérico multi-pipe**: cada pipe é uma **vertical isolada** (tabelas/RLS/
  RPCs próprios). Financeiro e Negociação seguem esse molde (clone do CS), **não** um schema
  unificado.
- O painel do CEO é uma **camada de leitura/agregação por cima** das verticais isoladas — ele
  consulta cada domínio e compõe em RPCs/actions; **não funde os schemas**.
- Ingestão real: **Pipefy → Make (poll agendado) → RPC `ingest_*` no Supabase**. O app só **lê** sob
  RLS. Migrations e cenários Make são **aplicados à mão pelo dono** (padrão do repo).

---

## Molde a reutilizar (não reinventar)

- **Casca de painel multi-abas**: [`src/app/cs/page.tsx`](../../../src/app/cs/page.tsx),
  [`src/app/cs/CsClient.tsx`](../../../src/app/cs/CsClient.tsx) (Radix Tabs + `?aba=`),
  [`src/features/cs/components/CsTabNav.tsx`](../../../src/features/cs/components/CsTabNav.tsx).
- **UI compartilhada** em [`src/components/bluedesk/`](../../../src/components/bluedesk/): `AppShell`,
  `PageHeader`, `KpiCard`, `PeriodPicker`, `useChartTheme` (cores theme-aware p/ Recharts). Modelo de
  gráfico Recharts: [`src/app/dashboard/CallsChart.tsx`](../../../src/app/dashboard/CallsChart.tsx).
- **Dados**: server actions `'use server'` → `createServerClient()`
  ([`src/lib/supabase/server.ts`](../../../src/lib/supabase/server.ts)) → `supabase.rpc(...)`; padrão
  em [`src/app/actions/cs.ts`](../../../src/app/actions/cs.ts).
- **Período**: [`src/lib/period.ts`](../../../src/lib/period.ts) (ciclo 11→10, BRT). Decidir por
  painel se usa ciclo ou mês civil (ver Sprint 1).
- **Ingestão (clone p/ Financeiro e Negociação)**:
  [`supabase/migrations/20260715_cs_pipeline_schema.sql`](../../../supabase/migrations/20260715_cs_pipeline_schema.sql)
  (`ingest_cs_card`, helpers RLS, `cs_current_role()`), script de backfill
  [`scripts/import-cs-cards.mjs`](../../../scripts/import-cs-cards.mjs), doc de cenário
  [`make-integracao-cs.md`](../../painelcs-docs/updates/make-integracao-cs.md).
- **Parsers de dinheiro/data**: `cs_parse_money`/`cs_parse_date` em
  [`supabase/migrations/20260727_cs_minutas.sql`](../../../supabase/migrations/20260727_cs_minutas.sql)
  — replicar p/ Financeiro/Negociação.

---

## Sprint 0 — Fundação & trava (papel `ceo` + rota `/ceo` + docs) — ✅ FECHADA (29/jul/2026)

> **Trava testada ponta a ponta pelo dono em 31/jul:** `ceo` cai em `/ceo`, `agent` é barrado e volta
> para `/softphone`, `admin` entra. Era a última pendência do sprint.

> **Banco: pronto (30/jul).** As duas migrations foram aplicadas —
> [`20260729_ceo_role.sql`](../../../supabase/migrations/20260729_ceo_role.sql) criou
> `ceo_current_role()` (a PARTE 1 foi no-op: `profiles.role` não é enum) e
> [`20260730_ceo_role_check.sql`](../../../supabase/migrations/20260730_ceo_role_check.sql)
> liberou `'ceo'` no CHECK `profiles_role_check`.
>
> ~~**Pendência do dono:** promover o CEO pelo `/admin`~~ — feito; papel atribuído e trava validada
> em 31/jul.

**Papel `ceo` (RBAC em 3 camadas):**
- **Migrations**: [`20260729_ceo_role.sql`](../../../supabase/migrations/20260729_ceo_role.sql) +
  [`20260730_ceo_role_check.sql`](../../../supabase/migrations/20260730_ceo_role_check.sql).
  A primeira cria `ceo_current_role()` (PARTE 2) e trata o caso de `profiles.role` ser enum
  (PARTE 1), descobrindo o tipo pela própria coluna via catálogo em vez de exigir introspecção
  manual. **A introspecção ao vivo (30/jul) mostrou que não é enum**: é `text` (typtype=b) com o
  CHECK `profiles_role_check` limitando aos 5 papéis. A PARTE 1 detectou o não-enum e retornou
  sem fazer nada — correto quanto ao enum, **incompleto quanto ao CHECK**, que rejeita `'ceo'` do
  mesmo jeito. A `20260730` fecha esse buraco recriando o CHECK com `'ceo'` na lista (só alarga o
  domínio, então nenhuma linha existente pode violar; DROP + ADD na mesma transação).
  **Lição:** "não é enum" não significava "nada a fazer" — significava "procure o CHECK".
- [`src/lib/types/database.ts:2`](../../../src/lib/types/database.ts#L2): `'ceo'` no union `Role`.
  Não havia nenhum `Record<Role, …>` no código, então a mudança **não gerou erro de compilação em
  lugar nenhum** — o que é justamente o risco: as quebras eram todas silenciosas (as duas abaixo).
- [`src/app/actions/admin.ts:6`](../../../src/app/actions/admin.ts#L6) **e**
  [`src/app/admin/AdminClient.tsx:19`](../../../src/app/admin/AdminClient.tsx#L19): são **duas**
  listas — `ROLES` valida no servidor, `ROLE_OPTIONS` popula o select. Só a primeira estava no
  plano; sem a segunda o papel ficaria inatribuível pela UI.
- [`src/features/ajuda/content/roles.ts`](../../../src/features/ajuda/content/roles.ts) *(não
  previsto)*: `/ajuda` **quebrava** para o `ceo` —
  [`RoleBadge`](../../../src/features/ajuda/components/RoleBadge.tsx) faz `ROLES.find(...)!` e
  estouraria em `meta.color` (TypeError) com papel ausente, e `/ajuda` é liberado a todos.
  Adicionada a entrada `ceo`, a coluna na matriz de acesso, e `roleIncludes()` passou a devolver
  `false` explicitamente para papéis fora da escada da operação (antes dependia do `indexOf` −1
  por acidente, que um reorder do array quebraria em silêncio).
- [`src/lib/supabase/middleware.ts`](../../../src/lib/supabase/middleware.ts): **dois** blocos, não
  um. (a) O gate espelhando `/admin`: em `/ceo` só passa `admin` (suporte) — quem é `ceo` já
  retornou antes. (b) Um bloco **invertido** para o `ceo`, colocado *antes* do redirect de
  `isPublic`: como `ceo` é trava lateral (não opera discador nem gere usuários), listamos o que
  ele alcança (`CEO_ROUTES = ['/ceo','/ajuda']`) e mandamos todo o resto para `/ceo`. É isso que
  faz o **destino pós-login** dele ser `/ceo` em vez de `/softphone` — sem esse bloco, um CEO
  logava e caía na tela do discador (`/` também redireciona para lá).
- [`src/components/Sidebar.tsx`](../../../src/components/Sidebar.tsx): item `/ceo` (ícone `Crown`,
  `roles: ['ceo','admin']`), `ceo: 'CEO'` no `ROLE_LABEL`, e `'ceo'` incluído em `/ajuda` — senão
  o CEO ficaria com um único item de menu no app inteiro.

**Rota esqueleto:**
- [`src/app/ceo/page.tsx`](../../../src/app/ceo/page.tsx) (server; flag `NEXT_PUBLIC_CEO_ENABLED`
  com early return antes de qualquer query, espelhando `cs/page.tsx:16`) +
  [`CeoComingSoon.tsx`](../../../src/app/ceo/CeoComingSoon.tsx).
- [`src/app/ceo/CeoClient.tsx`](../../../src/app/ceo/CeoClient.tsx) (`AppShell` + `PageHeader` +
  Radix Tabs `?aba=`): abas `financeiro` · `projecoes` · `saude-empresa` · `saude-equipe`, as
  quatro em placeholder, cada uma já descrevendo o que vai receber e de onde.
- [`src/features/ceo/`](../../../src/features/ceo/): `CeoTabNav.tsx` + `CeoTabPlaceholder.tsx` +
  barrel `index.ts` (réplicas locais dos equivalentes de CS — domínio separado).
- [`src/app/actions/ceo.ts`](../../../src/app/actions/ceo.ts) (`'use server'`, vazio; documenta o
  padrão que as RPCs seguem — agregar no Postgres + guarda `ceo_current_role()`).
- [`.env.example`](../../../.env.example): `NEXT_PUBLIC_CEO_ENABLED` registrada e **desligada**.

**Estratégia de RLS do `ceo` (adotada):** em vez de espalhar `'ceo'` por todas as policies `IN
('manager','admin')`, o helper `ceo_current_role()` (clone de `cs_current_role`) foi criado e as
**RPCs de leitura do painel do CEO** serão `SECURITY DEFINER` com **guarda interna** (`IF
ceo_current_role() NOT IN ('ceo','admin') THEN RETURN`). Isso centraliza o acesso do CEO nas RPCs do
painel e evita mexer no RLS de cada domínio. (Cada RPC dos sprints seguintes já nasce com essa
guarda.) **Consequência verificada:** o Sprint 0 não alterou nenhuma policy em produção — o único
efeito no banco é um valor a mais no CHECK de `profiles.role` e uma função nova, ambos inertes até
o Sprint 1.

**Docs (padrão do repo):** ✅ `docs/projetopainelceo-docs/` com `reference/.gitkeep`, `updates/`,
`fixes/.gitkeep`; `updates/painel-ceo-indice.md` (índice/estado) + `updates/painel-ceo-sprints.md`
(roadmap em sprints + decisões travadas — este arquivo); projeto registrado na tabela de
[`docs/links.md`](../../links.md).

**Decisão de infra tomada durante a execução:** `supabase/` **voltou a ser versionado**
(`.gitignore`). A pasta ignorada existia apenas no worktree `discsip`, e como migrations são um log
append-only aplicado a **um** banco, as duas cópias divergiriam em silêncio — git não avisa sobre
arquivos untracked. Versionadas, elas viajam com a branch e a divergência aparece no diff. Efeito
colateral: os links relativos destes docs para `supabase/migrations/*.sql` voltaram a resolver.

---

## Sprint 1 — Financeiro: entradas do mês (carro-chefe) — ✅ CÓDIGO ENTREGUE (31/jul/2026)

> **Mapeamento fechado por introspecção ao vivo:**
> [`introspeccao-pipefy-financeiro.md`](introspeccao-pipefy-financeiro.md) — pipe **`304386356`**
> ("2.0 - Financeiro"), field-ids, fases, formato dos valores e as decisões do dono.
>
> **Executado pelo dono em 31/jul:** ✅ migration
> [`20260731_financeiro_schema.sql`](../../../supabase/migrations/20260731_financeiro_schema.sql)
> aplicada · ✅ `npm run import:financeiro` rodado (carga histórica, ~4.500 cards) · ✅ cenário Make
> montado ([`make-integracao-financeiro.md`](make-integracao-financeiro.md)) · ✅
> `NEXT_PUBLIC_CEO_ENABLED=1`. A aba está no ar com dado real.
>
> **Conferência: ✅ passou** (`npm run verify:financeiro`, 31/jul) — 4.549/4.549 cards, 5.348
> pagamentos nas duas convenções, 0 divergências card a card, 32/32 meses, total
> R$ 7.310.222,27 idêntico. Parsers confirmados por chamada ao vivo; **painel aberto e testado
> pelo dono**. **SPRINT 1 FECHADA.**
>
> **Arquivos entregues:** migration acima · `scripts/import-financeiro.mjs`
> (`npm run import:financeiro`) · `getCeoFinanceiro` em `src/app/actions/ceo.ts` · tipos em
> `src/lib/types/database.ts` · mês civil em `src/lib/period.ts` ·
> `src/features/ceo/components/CeoFinanceiro.tsx` + `CeoPeriodPicker.tsx` · aba ligada em
> `src/app/ceo/CeoClient.tsx` · doc do Make.

**Ingestão do pipe Financeiro (nova vertical isolada, clone do CS):**
- Migration `AAAAMMDD_financeiro_schema.sql`: **duas** tabelas, porque o pipe mudou de convenção no
  meio de 2025 e um card antigo vale até 4 pagamentos com datas próprias (achado 3):
  - `fin_cards` — contexto do card (`pipefy_card_id`, `metadata jsonb`, `paid_value`,
    `charged_value`, `net_value`, `paid_date`, `category` ← `COALESCE` dos 3 campos de referência,
    `department` **normalizado**, `payment_method`, `contract_ref`).
  - `fin_entries` — **um pagamento por linha** (`fin_card_id`, `entry_value`, `entry_date`, `seq`).
    É ela que alimenta KPI e série mensal. Card com parcela preenchida → uma linha por parcela
    (descartando `0,00`) e **ignora** `valor_de_contrata_o`, que é inconsistente nesses cards; card
    sem parcela (todo 2026) → uma linha de `valor_de_contrata_o` + `data_do_pagamento`.
  - RPC `ingest_financeiro_card(node)` (`SECURITY DEFINER`, grant só `service_role`), upsert
    idempotente por `pipefy_card_id`, regenerando as `fin_entries` do card.
  - `fin_entry_sign(category)`: `-1` em desconto/devolução, `+1` no resto (distrato e reversão são
    entradas normais — decisão do dono).
  - ⚠️ `fin_parse_money` é clone fiel de `cs_parse_money`, mas **`fin_parse_date` não pode ser
    clone**: este pipe manda `DD/MM/YYYY` (nunca ISO, `datetime_value` sempre `null`) e o
    `left(raw,10)::date` do CS devolveria `NULL` em 100% dos cards — sem erro nenhum. Precisa de
    `to_date(s,'DD/MM/YYYY')`.
- RPC de leitura `get_ceo_financeiro(p_start, p_end)` (com a guarda `ceo`/`admin`): total do período,
  série mensal e breakdown por categoria — **agrega no Postgres** sobre `fin_entries` e devolve 1
  linha jsonb (evita o teto de 1000 linhas do PostgREST). Filtra
  `current_phase_id <> '327456661'` ("Pagamento cancelado" — as outras 4 fases contam) e soma
  `entry_value * fin_entry_sign(category)`.
- **Alerta de duplicidade** (pedido do dono): a RPC devolve, à parte, os grupos de mesmo
  `contract_ref` **com mesmo valor, mesma categoria e mesmo dia** — o único trio que indica
  lançamento em duplicata. Mesmo contrato com categorias diferentes é dado bom (pagamento + desconto,
  por exemplo) e não pode entrar no alerta. É **aviso na tela, nunca dedupe automático**.
- Backfill [`scripts/import-financeiro.mjs`](../../../scripts/import-financeiro.mjs) (clone de
  `import-cs-cards.mjs`) + env `FINANCEIRO_PIPEFY_PIPE_ID` (reusa `PIPEFY_TOKEN`), registrado como
  `npm run import:financeiro`. Reporta `pagamentos` e `cards_sem_entrada` por rodada.
- Cenário Make (dono monta): Schedule → GraphQL delta → Transform to JSON → POST
  `rpc/ingest_financeiro_card`. Doc [`make-integracao-financeiro.md`](make-integracao-financeiro.md).

**Frontend — aba "Financeiro":** 4 `KpiCard`s (entradas no período com delta vs. período anterior,
nº de pagamentos, ticket médio, maior categoria) + `AreaChart` (Recharts via `useChartTheme`) dos 12
meses + 3 breakdowns (categoria, departamento, forma de pagamento) + painel de aviso de duplicidade.
Action `getCeoFinanceiro` em `src/app/actions/ceo.ts`.

**Período — `CeoPeriodPicker` (novo, local do domínio):** toggle **mês civil** (default) × **ciclo
11→10**, com intervalo livre. Réplica local em vez de estender o `PeriodPicker` compartilhado, que é
usado por leads e discadora. Os KPIs seguem a janela escolhida; **a série mensal é sempre em meses
civis** — em ciclo 11→10 a barra de "julho" não seria julho.

**Definição de "mês" — decidido (31/jul): os dois.** O `PeriodPicker` ganha um toggle mês civil ×
ciclo 11→10, com **mês civil no default** (é como executivo lê faturamento e como bate com o
extrato). Custa pouco porque a RPC já recebe `p_start`/`p_end` — quem define a janela é o frontend; o
ciclo reusa [`src/lib/period.ts`](../../../src/lib/period.ts).

~~**Dependência do dono:** ID do pipe Financeiro + field-ids~~ — **fechado em 31/jul** por
introspecção ao vivo ([`introspeccao-pipefy-financeiro.md`](introspeccao-pipefy-financeiro.md)).
Resta do dono: **aplicar a migration** e **montar o cenário Make** quando o código estiver pronto.

---

## Sprint 2 — Projeções de pagamento (CS reusado + Negociação novo) — ✅ FECHADA (03/ago/2026)

> **Mapeamento da Negociação fechado por introspecção ao vivo (03/ago):**
> [`introspeccao-pipefy-negociacao.md`](introspeccao-pipefy-negociacao.md) — pipe **`304370275`**
> ("3.0 Negociação"), 3.343 cards, fases, field-ids, parsers e os 8 achados.
>
> **As 4 decisões do dono (03/ago):** projeção **só da fase `326422800`** (⚠️ **contra** a minha
> recomendação — eu propus incluir `338815768`, que é do Comercial) · card já pago **fora** ·
> 2ª parcela vencida **é** projeção, em janela própria · RPC do CS **escrita** mesmo sem dado.
>
> **Executado pelo dono em 03/ago:** ✅ [`20260731b`](../../../supabase/migrations/20260731b_negociacao_schema.sql)
> (schema + ingestão + RPCs) · ✅ [`20260731c`](../../../supabase/migrations/20260731c_ceo_guard_null_safe.sql)
> (correção da guarda, confirmada ao vivo) · ✅ `npm run import:negociacao` (3.343 cards) ·
> ✅ cenário Make montado ([`make-integracao-negociacao.md`](make-integracao-negociacao.md)) ·
> ✅ card de teste órfão do CS removido.
>
> ✅ [`20260803`](../../../supabase/migrations/20260803_negociacao_fase_unica.sql) (fase única) —
> aplicada e **confirmada ao vivo**: `neg_is_waiting_phase('338815768')` → `false`.
>
> ⚠️ Ela **rodou sem efeito na primeira tentativa** (`338815768` continuava `true`), porque a
> `20260731b` tem um `CREATE OR REPLACE` da mesma função com a versão de duas fases — reexecutar
> aquele arquivo **desfaz esta correção em silêncio**. Os dois ganharam aviso no lugar exato.
> Conferência que pega o erro: `SELECT public.neg_is_waiting_phase('338815768');` → **false**.
>
> **Conferência: ✅ passou** (`npm run verify:negociacao`, 03/ago) — 3.343/3.343 cards, 0 faltando,
> **0 divergências de dado**, total idêntico dos dois lados: **R$ 10.000,00 em 8 cards**
> (R$ 4.750,00 vencidos em 5 · R$ 5.250,00 a vencer ≤30d em 3). Por sinal: 5 `parcela2`, 3 `fase`.
>
> **O filtro de fase carrega 99% do resultado** (medido em 03/ago, depois da `20260803`): existem
> **665 cards** fora da fase de espera que têm valor e data de projeção preenchidos, somando
> **R$ 1.041.813,33** — restos de campos que ficam no card depois que ele sai da fase (achado 7).
> Sem `neg_is_waiting_phase` a aba mostraria R$ 1.051.813,33 em vez de R$ 10.000,00. É por isso
> que a RPC filtra por fase e **nunca** por "tem valor de projeção preenchido".
>
> ⚠️ **A conferência achou um bug de segurança na guarda** das RPCs do painel — inclusive a do
> Financeiro **em produção**. Corrigido e aplicado
> ([`20260731c`](../../../supabase/migrations/20260731c_ceo_guard_null_safe.sql), [fix
> documentado](../fixes/correcao-guarda-ceo-null.md)).
>
> **Arquivos entregues:** [`20260731b_negociacao_schema.sql`](../../../supabase/migrations/20260731b_negociacao_schema.sql)
> · [`20260731c_ceo_guard_null_safe.sql`](../../../supabase/migrations/20260731c_ceo_guard_null_safe.sql)
> · [`20260803_negociacao_fase_unica.sql`](../../../supabase/migrations/20260803_negociacao_fase_unica.sql)
> · `scripts/import-negociacao.mjs` (`npm run import:negociacao`) · `scripts/verify-negociacao.mjs`
> (`npm run verify:negociacao`) · `scripts/probe-negociacao-fields.mjs` (`npm run probe:negociacao`)
> · `getCeoProjecoes` em `src/app/actions/ceo.ts` · tipos em `src/lib/types/database.ts` ·
> `src/features/ceo/components/CeoProjecoes.tsx` · aba ligada em `src/app/ceo/CeoClient.tsx` ·
> env `NEGOCIACAO_PIPEFY_PIPE_ID` · doc do Make.

**Estado das duas metades — mudou em relação ao plano original:**

- **CS: destravado no código, mas SEM DADO.** A P4 (Pagamento) do painel de CS **já foi construída**
  — [`20260730b_cs_pagamento.sql`](../../../supabase/migrations/20260730b_cs_pagamento.sql) está
  aplicada e traz `get_cs_pagamento_projecao()` + `get_cs_pagamento_historico()`. ⚠️ **Mas a
  operação ainda não usa a fase:** conferido ao vivo em 31/jul, a fase "Aguardando Pagamento"
  (`343781769`) tem **1 card, "teste filipe"**, e **1 de 1.493 `cs_cards`** tem o plano de pagamento
  preenchido — o mesmo card de teste. `cs_card_payments` tem 1 linha.
  ⚠️ **Os field-ids que este roadmap listava estavam errados**: não são `valor_da_parcela` /
  `data_de_vencimento_da_parcela_do_cliente` / `data_da_quita_o` (esses são os campos das
  **minutas**). O plano de pagamento do CS mora em slugs irregulares, teto de 3 parcelas:
  `1_parcela_valor`/`1_parcela_data_do_pagamento`, `copy_of_1_parcela_valor`/`copy_of_1_parcela_data_do_pagamento`,
  `copy_of_2_parcela_valor`/`copy_of_2_parcela_data_do_pagamento`.
  → `get_ceo_projecoes_cs()` vira um wrapper fino com a guarda `ceo`/`admin` sobre os mesmos slugs.
  **Escrevê-la hoje entrega uma aba que mostra 1 card de teste** — a decisão de valer a pena é do dono.
- **Negociação: mapeada, pronta pra construir.** Vertical isolada (clone do Financeiro): migration
  `AAAAMMDD_negociacao_schema.sql` (`neg_cards` + `neg_parse_money`/`neg_parse_date` +
  `ingest_negociacao_card`), backfill `scripts/import-negociacao.mjs`, env
  `NEGOCIACAO_PIPEFY_PIPE_ID=304370275`, cenário Make, RPC `get_ceo_projecoes_negociacao()`.

**Os três achados que mudam o desenho** (detalhe em
[`introspeccao-pipefy-negociacao.md`](introspeccao-pipefy-negociacao.md)):

1. ⚠️ **O realizado da Negociação já está no Financeiro.** O conector `lan_ar_pagamento` da fase
   aponta para o pipe `304386356` — o mesmo do Sprint 1. `neg_cards` fornece **só a projeção**;
   somar o realizado contaria o mesmo dinheiro duas vezes entre as abas.
2. ⚠️ **`o_pagamento_foi_reaizado = 'Sim'` ⟺ tem conexão com o Financeiro, em 24/24 cards.** É o
   sinal anti-dupla-contagem, e é barato (está no `metadata`). Sem ele a projeção da fase é
   R$ 10.500,00; com ele, **R$ 4.000,00** — os outros R$ 6.500,00 já entraram.
3. **A fase de projeção é `326422800`, e SÓ ela.** 6 dos 14 cards não têm valor nem data nos campos
   da própria fase — nesses o sinal é a 2ª parcela da venda, quase sempre vencida. ❌ Eu havia
   recomendado incluir também **"Pré - Triagem - 2° Parcela📝"** (`338815768`), por estar bem mais
   preenchida; **o dono corrigiu em 03/ago: aquela fase é do COMERCIAL** e não é projeção deste
   painel. Removida em
   [`20260803_negociacao_fase_unica.sql`](../../../supabase/migrations/20260803_negociacao_fase_unica.sql).
   **Lição: densidade de preenchimento não é sinal de pertencimento** — nenhuma query distingue
   "espera de pagamento da Negociação" de "espera de pagamento do Comercial dentro do mesmo pipe".

**⚠️ Armadilha de formato deste pipe — o inverso da do Financeiro.** Lá `datetime_value` vinha
sempre `null`. Aqui os campos `datetime`/`due_date` trazem `datetime_value` em **100%** dos casos —
**em UTC**, enquanto o `value` é local (BRT). **79 de 968 cards (8,2%)** têm o **dia divergente**
entre os dois (`"06/08/2026 21:00"` → `"2026-08-07T00:00Z"`). **A ingestão lê `value`, nunca
`datetime_value`.** `neg_parse_date` é clone fiel de `fin_parse_date` (confirmado ao vivo: ele já
engole `DD/MM/YYYY HH:MM` porque a regex não é ancorada e ele faz `left(s,10)`).

- **Frontend — aba "Projeções":** timeline/gráfico "quando/quanto vão pagar" somando CS + Negociação +
  `KpiCard`s de total projetado por janela (vencidas / ≤30d / 31–90d / 90+).

~~**Dependência do dono:** ID do pipe Negociação + field-ids + id da fase~~ — **fechado em 31/jul**.
O pipe é `304370275`; o candidato `306994213` ("2.1 - Controle de Vendas") está **descartado** (0
cards em todas as 8 fases, nunca usado).

**Decisões do dono — todas tomadas em 31/jul, pelas recomendações:**

| # | Pergunta | Resposta | Onde vive |
|---|---|---|---|
| 1 | Projeção sai só de `326422800` ou também de `338815768`? | **SÓ `326422800`** — a outra é do Comercial | `neg_is_waiting_phase()` (corrigida na `20260803`) |
| 2 | Card com `o_pagamento_foi_reaizado = 'Sim'` entra? | **Não** | filtro `paid_flag` na RPC |
| 3 | 2ª parcela vencida é projeção ou inadimplência? | **Projeção**, janela "vencidas" | `window_key` na RPC |
| 4 | Escrever `get_ceo_projecoes_cs()` com o CS sem dado? | **Sim** — volta vazia hoje | PARTE 6 da migration |

**Decisão de desenho que veio junto: COALESCE, não soma.** Um card pode ter os dois sinais
preenchidos e eles não são dívidas somáveis — real (`#1348129801`): venda de R$ 890,00, 2ª parcela
de R$ 590,00 vencida, e um pagamento agendado de R$ 1.500,00. Somar daria R$ 2.090,00 a receber num
contrato de R$ 890,00. O agendamento da fase **supersede** a parcela antiga. Por isso `neg_projection()`
é COALESCE por prioridade e **não há tabela-filha** aqui (o Financeiro precisou de `fin_entries`
porque lá um card guardava vários pagamentos **históricos já ocorridos** — problema diferente).

---

## Sprint 3 — Saúde da empresa — ✅ CÓDIGO ENTREGUE (04/ago/2026)

> **O bloqueio caiu sem precisar extrair nada do banco.** Ver "O bloqueio de Leads" abaixo.
>
> **Arquivos entregues:** [`20260804_saude_empresa.sql`](../../../supabase/migrations/Migrations_projetopainelceo/20260804_saude_empresa.sql)
> (`get_ceo_saude_empresa`) · `scripts/verify-saude-empresa.mjs` (`npm run verify:saude-empresa`) ·
> `getCeoSaudeEmpresa` em `src/app/actions/ceo.ts` · tipos em `src/lib/types/database.ts` ·
> `src/features/ceo/components/CeoSaudeEmpresa.tsx` · aba ligada em `src/app/ceo/CeoClient.tsx` ·
> 23 migrations base restauradas do git (ver abaixo).
>
> **Falta o dono:** aplicar a migration e abrir a aba. Não há ingestão nova nem cenário Make —
> esta sprint só LÊ o que os outros domínios já gravam.

`get_ceo_saude_empresa(p_start, p_end)` devolve 1 jsonb com cinco blocos, um por domínio:

| Bloco | Fonte | Números |
|---|---|---|
| `financeiro` | `fin_entries` | total, pagamentos, janela anterior |
| `comercial` | `v_lead_progress` | recebidos, ganhos, mortos, abertos, parados por SLA, 1º contato médio |
| `cs` | `cs_cards`/`cs_card_events`/`cs_negotiation_snapshots` | carteira ativa, movidos, negociados, quitados, distratos |
| `ti` | `monday_tasks`/`monday_sprints` | concluídas, pontos, em aberto, atrasadas, sprints |
| `operacao` | `call_logs` | chamadas, atendidas, minutos falados |

Todos com a janela anterior de mesmo tamanho (delta), série diária BRT zero-preenchida
(sparkline) e `lastActivityAt`.

**Três decisões de desenho:**

1. **O bloco financeiro DELEGA para `get_ceo_financeiro`** em vez de repetir a regra. A regra do
   dinheiro tem três partes que já morderam (sinal por categoria, fase de cancelado fora, uma
   linha por pagamento e não por card); copiá-la criaria duas fontes de verdade, e o sintoma
   seria a aba Saúde discordando da aba Financeiro **do mesmo painel**.
2. **SECURITY DEFINER lendo as tabelas base, nunca as RPCs de cada domínio.**
   `get_leads_dashboard`, `get_cs_team` e afins são SECURITY INVOKER, e o papel `ceo` não está em
   nenhuma policy de leads/cs/monday (decisão da Sprint 0). Chamá-las como CEO devolveria **zero —
   não erro, zero**, que é o pior modo de falhar.
3. **Todo bloco devolve `lastActivityAt`,** e a aba mostra isso no rodapé de cada cartão. Dois dos
   cinco domínios estão parados hoje, e "não aconteceu nada no período" e "a fonte parou de mandar
   dado" desenham a mesma tela. É a generalização da lição da Sprint 2 (mostrar o total por origem
   para o zero do CS aparecer como causa).

⚠️ **Foto das cinco fontes — leia a data junto, é medição pontual e não característica do sistema:**

| Fonte | Volume (04/ago) | Estado |
|---|---|---|
| financeiro | 5.359 entradas, a última no dia | saudável |
| comercial | 5.209 leads, 882 criados em 30d | saudável |
| cs | 1.492 cards, 834 eventos em 30d | saudável |
| ti | **30 tarefas no total** (24 concluídas) | **baixo volume** — é o backlog do próprio Blue Desk, nascido em 27/jul. Serve pra ritmo, não pra tendência |
| operacao | **0 chamadas em 7 dias**; última em 23/jul; 12 campanhas em `draft` | fonte muda |

**E essa foto durou menos de um dia.** Em 05/ago o discador **voltou**: 19 chamadas, todas na tarde
de 04/ago, nenhuma atendida, com as campanhas ainda em `draft`. A conferência da véspera acusava
"parado há 12 dias"; a do dia seguinte não acusou fonte muda nenhuma.

**É exatamente o argumento da decisão (3), agora demonstrado:** o estado das fontes muda de um dia
para o outro e nenhuma delas avisa. Por isso o carimbo de frescor vale para as cinco o tempo todo,
e não como remendo para a que estivesse fraca. **Não escreva "a fonte X está parada" em lugar
nenhum como se fosse permanente** — quem responde isso é o `lastActivityAt` na hora da leitura, ou
`npm run verify:saude-empresa` (seção FRESCOR DAS FONTES) para o estado de hoje.

**Um bug de contabilização, achado pela conferência e corrigido antes de entregar:** a média de
tempo até o 1º contato saía **negativa** (−22,0 h em agosto). Causa legítima: lead retroativo — a
vendedora cria hoje o card de um lead antigo e preenche o 1º contato com a data real, anterior à
criação. **O painel de Leads já tinha resolvido isso em 08/jul** (`FILTER hours_to_first_contact >= 0`
em [`20260708_leads_dashboard_fixes.sql`](../../../supabase/migrations/Migrations_painelleads/20260708_leads_dashboard_fixes.sql));
a RPC nova replicou o `AVG` sem o filtro. Com o filtro: 17,0 h. **A lição é sobre reuso: compor um
painel novo por cima de domínios antigos herda os dados, não as correções deles.**

### O bloqueio de Leads: estava no git, não no banco

Este roadmap dizia desde a Sprint 0 que as tabelas/RPCs base de Leads "só existem na base ao vivo"
e teriam que ser **extraídas do Supabase** antes de qualquer coisa depender delas. Era o primeiro
bloqueio da Sprint 3.

**Nunca precisou.** O commit `bf62847` (10/jul, "chore: remover supabase/ do repo") apagou **23
arquivos**, e o commit que voltou a versionar `supabase/` (`51cc883`, 30/jul) restaurou só as
migrations de 10/jul em diante. As 23 anteriores ficaram no histórico o tempo todo. Restauradas
em 04/ago, cada uma na pasta do seu domínio:

- **10** em `Migrations_painelleads/` (`20260702`–`20260710`): `leads`, `lead_events`, `lead_phases`,
  `lead_agents`, `v_lead_progress`, SLA, `get_leads_dashboard`, drill-downs e séries.
- **5** em `Migrations_rbac/` (`20260611`–`20260615`): `profiles`, `departments`, cutover de
  identidade e **todo o RLS por papel**.
- **5** em `Migrations_discadora/`: `campaigns`, `lists`, `campaign_contacts`, `agent_presence`,
  discagem paralela, views do dashboard.
- **2** em [`supabase/manual/`](../../../supabase/manual/README.md): o setup consolidado de leads e
  `ingest_lead_card.sql`.

Conferido contra o banco ao vivo: as colunas que `20260702_leads_pipefy.sql` cria são exatamente as
15 que `leads` tem hoje — o arquivo do histórico é fiel. ⚠️ São migrations **já aplicadas**,
restauradas como registro: `20260612`/`20260613` dropam a tabela `agents` e
`manual/leads_dashboard_setup.sql` recria o schema de leads **do zero**. Não reexecutar.

**A lição:** "não está no repo" e "não está no git" não são a mesma coisa.
`git log --all --diff-filter=D --name-only -- 'supabase/*'` teria respondido em segundos, e o
plano carregou esse bloqueio por 5 dias. Antes de extrair schema de um banco ao vivo, procure no
histórico.

⚠️ **Efeito colateral bom:** isso destrava também a **Sprint 4**, que tinha o mesmo bloqueio, e
devolve ao repo o RLS do discador — que o README de migrations listava como não auditável.

### ⚠️ A conferência achou R$ 8.000,00 de um card apagado, na aba Financeiro em produção — ✅ limpo em 05/ago

`fin_cards` tem 4.560 cards; o pipe tem 4.558. Os dois excedentes não existem mais no Pipefy
(`Acesso negado`), e **os dois contam** — a fase deles não é a de cancelado:

- `1421643991` "teste filipe" — R$ 0,23
- `1424109818` **"RICARDO DOS SANTOS SILVA" — R$ 8.000,00, lançado em 03/ago**

No mês corrente isso era **29,5% do total** (R$ 27.132,00 com o órfão; R$ 19.132,00 sem). É a
materialização do risco "card apagado no Pipefy não some do Supabase" que já estava listado aqui
desde 03/ago — com nome de cliente real e valor material, numa aba que o CEO já usa. Negociação
(3.344/3.344) e CS (1.492/1.492) batiam exatamente.

✅ **O dono apagou os dois em 05/ago**, e a prova é as duas conferências passarem a dar o mesmo
número em julho (R$ 185.404,52 / 161 dos dois lados; antes o banco dizia 185.404,75 / 162). Foi a
divergência entre elas que revelou o problema e é o fim dela que o fecha. Detalhe e a decisão de
fundo que continua em aberto (o backfill virar autoridade sobre exclusão) em
[`cards-orfaos-financeiro.md`](../fixes/cards-orfaos-financeiro.md).

⚠️ **Não confundir com o caso inverso, que é normal:** a rodada de 05/ago acusou `faltando no
banco: 1` e terminou em ✗. Era um card criado no Pipefy **duas horas antes**, que o poll do Make
ainda não tinha buscado. A regra: **banco > Pipefy = órfão (age)** · **Pipefy > banco = poll
atrasado (espere)**.

---

### Revisão de 05/ago — a aba mudou de conceito, e a Negociação ganhou uma regra

Depois de abrir o painel, o dono redefiniu cinco coisas. Todas entregues em 05/ago.

> **Executado pelo dono em 05/ago:** ✅ [`20260805_negociacao_so_campos_da_fase.sql`](../../../supabase/migrations/Migrations_projetopainelceo/20260805_negociacao_so_campos_da_fase.sql)
> · ✅ [`20260805b_saude_custos.sql`](../../../supabase/migrations/Migrations_projetopainelceo/20260805b_saude_custos.sql)
> · ✅ [`20260805c_financeiro_serie_por_ciclo.sql`](../../../supabase/migrations/Migrations_projetopainelceo/20260805c_financeiro_serie_por_ciclo.sql)
>
> Confirmado ao vivo logo depois: `ceo_pessoa_custo` e `ceo_custo_config` criadas ·
> `set_ceo_custo_geral`, `set_ceo_pessoa_custo` e `fin_vendedor` expostas ·
> `get_ceo_financeiro` respondendo com 3 argumentos (a de 2 saiu, sem ambiguidade) ·
> as RPCs devolvendo `NULL` para a `service_role` (guarda de pé).
>
> 🔴 **PENDENTE: o re-cálculo da PARTE 2 da `20260805`.** A conferência ao vivo achou
> **285 cards ainda com `proj_source = 'parcela2'`** e **8 cards na aba em vez de 3**.
> Não é falha da migration: a PARTE 2 está dentro de comentários `--`, então rodar o
> arquivo **não** a executa — e `proj_*` é gravado na ingestão, então trocar a função não
> reescreve as linhas antigas. Sem erro nenhum: a aba simplesmente continua com o número
> velho. O comando está no fim daquele arquivo.
> Conferência: `SELECT count(*) FROM neg_cards WHERE proj_source = 'parcela2';` → **0**.
>
> **Vale como padrão do repo, não como caso isolado:** toda migration que muda uma regra
> **materializada na ingestão** (`fin_entries`, `neg_cards.proj_*`, `cs_card_payments`)
> precisa de um passo de re-cálculo, e esse passo nunca roda junto. É o mesmo tipo de
> falha silenciosa do `CREATE OR REPLACE` em duas migrations: nada quebra, só o número
> fica velho.

**1. A Saúde da Empresa deixou de ser scorecard de 5 domínios.** O conceito passa a ser
**quanto cada departamento e cada colaborador coloca para dentro, contra quanto custam**.
Saíram os cartões de **TI (Monday)** e de **Operação (Discador)** — nenhum dos dois responde
"quanto essa pessoa trouxe" — e saíram as frases de insight dos cartões.
[`20260805b_saude_custos.sql`](../../../supabase/migrations/Migrations_projetopainelceo/20260805b_saude_custos.sql)
substitui o corpo de `get_ceo_saude_empresa` e cria `ceo_pessoa_custo` + `ceo_custo_config` +
`set_ceo_pessoa_custo` + `set_ceo_custo_geral`.

As 3 decisões do dono: custo **por pessoa com um geral padrão** para quem não tiver ·
a pessoa é o **nome do Pipefy**, não o usuário do Blue Desk · o cartão mostra
**receita, custo e margem** (não múltiplo).

**A receita por pessoa já existia e ninguém tinha usado:** o campo
`respons_vel_pelo_pagamento` do pipe Financeiro (rótulo "Vendedor"), que já está em
`fin_cards.metadata`. **34 pessoas em 3 departamentos**, sem ingerir nada novo.

⚠️ **Cobertura, medida ao vivo:** 94% do valor de 2026 e **100% de julho** têm vendedor —
mas só **28% dos cards do histórico inteiro** (os antigos não usavam o campo). Em período
antigo a soma das pessoas **não fecha** com o total do Financeiro, e por isso a RPC devolve
`semVendedor` à parte: a diferença aparece nomeada na tela em vez de virar um total que não
bate sem explicação.

⚠️ **A mesma pessoa aparece em mais de um departamento** (Charles, Larissa, Leonardo,
Gustavo) — o departamento é do **card**, não dela. A receita é a de cada um; o **custo é
rateado entre eles na proporção da receita**, senão o mesmo salário entraria duas vezes e a
margem da empresa sairia menor do que é.

**2. Negociação: só a fase, e só os campos dela.** Regra do dono —
[`20260805_negociacao_so_campos_da_fase.sql`](../../../supabase/migrations/Migrations_projetopainelceo/20260805_negociacao_so_campos_da_fase.sql).
O filtro de **card** já era o certo desde a `20260803`; faltava o de **campo**:
`neg_projection` tinha fallback para a 2ª parcela da venda quando os campos da fase estavam
vazios. **Era escopo do Comercial entrando pela porta dos fundos** — o mesmo erro que a
`20260803` corrigiu do lado do card, corrigido pela metade. A decisão #3 do Sprint 2
("2ª parcela vencida É projeção") fica **revogada**.

⚠️ **E o campo nem era data de pagamento.** Conferido card a card: o
`data_do_pagamento_da_2_parcela`, lido primeiro pelo fallback, é **carimbo de quando alguém
preencheu o formulário** — três cards distintos com "10/06/2026 17:2x" (edição em lote) e
discordando do campo de data real do mesmo card. A aba vinha mostrando, nesses cards, uma
data que nunca foi vencimento de nada. É a explicação da "data invertida" que o dono viu.

Efeito: dos 14 cards da fase, 8 têm os campos dela e 6 não. A projeção cai de
**R$ 10.000,00 em 8 cards** para **R$ 5.250,00 em 3** (conferido com `npm run verify:negociacao`).
⚠️ A migration exige um **re-cálculo** depois (PARTE 2 do arquivo): `proj_*` é resolvido na
ingestão e fica gravado — trocar a função não reescreve sozinha as 3.344 linhas.

**3. A série de 12 períodos passou a seguir o toggle** —
[`20260805c_financeiro_serie_por_ciclo.sql`](../../../supabase/migrations/Migrations_projetopainelceo/20260805c_financeiro_serie_por_ciclo.sql).
Trocar para "Ciclo 11→10" mudava os KPIs e não o gráfico. Não era bug: era a decisão da
Sprint 1 ("a série é sempre em meses civis, senão a barra de julho não seria julho"), que na
prática fazia a tela **ignorar o filtro** — pior que o problema que evitava. Em ciclo, o
rótulo vira o dia de início ("11 jul") para não se confundir com mês.
⚠️ `get_ceo_financeiro` ganhou um 3º parâmetro e **a versão de 2 argumentos foi derrubada** —
duas versões conviveriam e a chamada com 2 args daria "function is not unique".

**4. Todos os campos de data em DD/MM/AAAA.** Regra do dono, para todos os painéis. A causa
era o `<input type="date">` nativo: ele renderiza no locale do **sistema operacional**, não
da página — num Windows em inglês, 6 de maio aparece como `05/06/2026`, e não há CSS,
atributo nem `lang` que mude isso. Os **11 campos** em 6 arquivos (CEO, Leads/Discadora,
Minutas ×2, Projetos ×2) passaram a usar
[`BrDateInput`](../../../src/components/bluedesk/BrDateInput.tsx), que mantém o mesmo
contrato ISO do nativo — trocar não mexeu em nenhuma lógica de período.

⚠️ **O que foi descartado por medição, não por opinião:** os 4 parsers de data do banco
(`cs_`/`fin_`/`neg_`/`proc_parse_date`) foram chamados ao vivo com data ambígua e **todos
acertaram** (`06/05/2026` → `2026-05-06`); nos 14 cards da fase o `value` bate com o
`datetime_value` em 100% quando lido como DD/MM; e toda a formatação do front já era
`${dia}/${mês}/${ano}`. Não havia inversão em ingestão nem em exibição.

**5. Cards de departamento separados + individual por pessoa.** O breakdown em barra
lateral virou **um cartão por departamento** (receita, custo, margem, nº de pessoas),
clicável, e **abaixo a tabela por pessoa** de cada um, com o custo editável na própria
linha.

### 06/ago — filtro de período nas Projeções

[`20260806_projecoes_periodo.sql`](../../../supabase/migrations/Migrations_projetopainelceo/20260806_projecoes_periodo.sql).
A aba ganhou o mesmo seletor das outras duas (mês civil × ciclo 11→10).

⚠️ **Duas datas convivem, e confundi-las inverte a leitura:** o **período** recorta por data de
**vencimento**; as **faixas** (vencida / ≤30d / 31–90d / >90d) continuam contadas **contra hoje** —
decisão do dono. Escolhendo agosto, uma parcela vencida em 02/08 aparece como "vencida" mesmo
dentro do período, porque ela venceu de verdade. "Isso já atrasou?" é pergunta sobre hoje; o
período responde "que recorte eu quero ver". A aba escreve isso na tela, junto do filtro.

**Ganho colateral de desenho:** `total`, `byWindow` e `byProduct` passaram a ser derivados dos
**itens já filtrados**, em vez de virem prontos das duas sub-RPCs. Antes eram dois caminhos que
podiam divergir; agora o total é, por construção, a soma do que está na lista.

⚠️ Mesma armadilha de assinatura da `20260805c`: a versão de **0 argumentos foi derrubada** antes
de criar a de 2 com DEFAULT — as duas conviveriam e `get_ceo_projecoes()` daria
"function is not unique".

### Verificação da Sprint 3

`npm run verify:saude-empresa` ([`scripts/verify-saude-empresa.mjs`](../../../scripts/verify-saude-empresa.mjs))
— mesmo molde dos outros dois: reimplementa em JS as regras da migration a partir das tabelas base
e imprime o scorecard esperado, bloco a bloco, com a janela anterior e o frescor de cada fonte.
Roda com período: `node scripts/verify-saude-empresa.mjs 2026-07-01 2026-08-01`.

⚠️ **Ele NÃO chama a RPC**, e é limitação por construção, não descuido: a guarda
`ceo_current_role()` devolve NULL para a `service_role` (correção `20260731c`), então a RPC
responde NULL para qualquer script. O que ele entrega é o **número esperado** — dá pra rodar
antes de aplicar a migration e conferir a tela contra o relatório depois. A comparação final
"RPC × recomputação" é do dono, com a tela aberta.

⚠️ **Ele pode divergir de `npm run verify:financeiro`, e não é erro de nenhum dos dois:** aquele
varre o **Pipefy** e ignora card já apagado lá; este lê o **banco**, que é o que a aba mostra. Foi
exatamente essa divergência (R$ 0,23 em julho) que descobriu os cards órfãos.

Resultado em 04/ago, julho/2026 fechado: Financeiro R$ 185.404,75 (162) · Comercial 977 recebidos /
42 ganhos / 4,3% / 1º contato 45,8 h · CS 742 movidos, 23 negociados, 17 quitados **contra 69
distratos** · TI 17 tarefas, 17,5 pontos · Operação 1.354 chamadas, 17 atendidas (1,3%). Séries com
31 pontos cada, uma fonte muda (`operacao`).

**Segunda armadilha de reuso que a conferência pegou:** a regra de "movimento" do CS exclui as
fases administrativas conferindo a origem do evento **por id E por nome**, e eu tinha replicado só
o id. Não é redundância defensiva do `get_cs_team`: **1.506 dos 1.617 eventos (93%) têm
`from_phase_id` NULL**, e 14 deles trazem só o `from_phase`. Sem a checagem por nome, julho dava
752 movidos em vez de 742. Mesma lição do 1º contato negativo — **replicar uma regra pela metade
não quebra nada, só devolve outro número.**

---

## Sprint 4 — FUNDIDA na Sprint 3 (06/ago/2026)

**A Sprint 4 não vai existir como aba separada.** Ao reformular a Sprint 3 para receita e custo
**por pessoa** (05/ago), ela virou o que a Sprint 4 seria. O dono constatou isso em 06/ago e
decidiu: **a aba placeholder "Saúde da Equipe" sai, e a aba construída herda o nome**.

O painel passa de 4 para **3 abas**: `Financeiro` · `Projeções` · `Saúde da Equipe`.

⚠️ **A RPC continua se chamando `get_ceo_saude_empresa`**, desalinhada do rótulo **de propósito**:
renomear exigiria mais uma migration mexendo em objeto já aplicado, e este projeto já se queimou
com troca de definição de função entre migrations. O desalinho está avisado nos dois pontos
(`src/app/actions/ceo.ts` e o componente). Link antigo `?aba=saude-empresa` continua abrindo a aba
certa — ela mudou de nome, não sumiu.

### O que a Sprint 4 previa e ficou de fora, e por quê

O plano era compor atividade por pessoa de **CS** (`get_cs_team`), **Leads** (ranking/conversão/SLA),
**Monday** (pontos por assignee) e **Discador** (chamadas/dia).

**Medido ao vivo em 06/ago, o cruzamento de identidade não sustenta isso:**

| Cadastro | Casam com os 30 "Vendedores" do Financeiro |
|---|---|
| `lead_agents` (Leads) | **4 de 30** |
| `cs_agents` (CS) | **5 de 30** |
| `profiles` (Monday/Discador) | **2 de 30** |

E os conjuntos quase não se sobrepõem: **no máximo 9 das 30 pessoas** (30%) teriam qualquer métrica.

⚠️ **E isso não é cadastro mal preenchido — são papéis diferentes.** Quem fecha pagamento no pipe
do Financeiro em geral não é quem trabalha lead no Comercial nem quem toca carteira no CS. Unificar
a identidade faria os nomes casarem, mas **não** faria a mesma pessoa ter as duas métricas.

Decisão do dono: **não trazer nada por ora.** Entraria como coluna vazia em 2 de cada 3 linhas, e
uma tela cheia de "—" parece quebrada. Fica para quando (e se) a identidade for unificada — o
trabalho descrito abaixo continua válido como pré-requisito.

**Pré-requisito preservado:** popular a ponte `lead_agents.profile_id` / `cs_agents.profile_id`
(hoje 6/9 e **0/9**), casando por e-mail — os dois lados têm e-mail do mesmo domínio corporativo.

---

## Riscos & dependências (resumo)
- ~~**Financeiro**: pipe ID + field-ids~~ — resolvido em 31/jul
  ([`introspeccao-pipefy-financeiro.md`](introspeccao-pipefy-financeiro.md)).
  ~~**Negociação** ainda pendente~~ — **resolvido em 31/jul** (`304370275`,
  [`introspeccao-pipefy-negociacao.md`](introspeccao-pipefy-negociacao.md)). Migrations e cenários
  Make continuam aplicados **à mão** pelo dono.
- ⚠️ **Contagem dupla entre as abas Financeiro e Projeções** (Sprint 2): o realizado da Negociação
  entra no pipe do Financeiro pelo conector `lan_ar_pagamento`, então já está em `fin_entries`. A
  projeção tem que excluir card com `o_pagamento_foi_reaizado = 'Sim'` — sem isso a projeção da fase
  infla 160% (R$ 10.500 em vez de R$ 4.000).
- ⚠️ **`datetime_value` do Pipefy vem em UTC** (Sprint 2): nos campos `datetime`/`due_date` ele
  existe e parece o campo "pronto", mas 8,2% dos cards caem no **dia errado** por causa do fuso.
  Parse sempre o `value`. Generaliza a regra do `DD/MM/YYYY` do Sprint 1.
- ⚠️ **A projeção do CS não tem dado real** (Sprint 2): a P4 está construída e aplicada, mas a fase
  "Aguardando Pagamento" tem só o card "teste filipe" (1 de 1.493 `cs_cards`). O bloqueio é de
  **adoção da operação**, não de código — nenhuma RPC resolve.
- ⚠️ **`CREATE OR REPLACE` da mesma função em duas migrations = a última que rodar vence**
  (mordeu em 03/ago). A `20260803` corrige `neg_is_waiting_phase`, mas a `20260731b` também a
  define — reexecutar a antiga desfaz a correção **sem erro nenhum**. É o mesmo tipo de falha
  silenciosa do resto deste projeto: nada quebra, só o número fica errado. Os dois arquivos têm
  aviso no ponto exato, e a conferência barata é
  `SELECT public.neg_is_waiting_phase('338815768');` → **false**.
- ⚠️ **CARD APAGADO NO PIPEFY NÃO SOME DO SUPABASE** (descoberto em 03/ago, vale para **todos** os
  domínios: `cs_cards`, `fin_cards`, `neg_cards`, leads). A ingestão é upsert por `pipefy_card_id`
  e o poll por delta só enxerga o que **existe**; não há sincronização de exclusão. O card fica no
  banco para sempre e continua sendo somado.
  Foi assim que o "teste filipe" reapareceu na aba Projeções depois de o dono apagá-lo no Pipefy:
  a API do Pipefy já responde "Acesso negado" para o card `1421641222`, mas a linha em `cs_cards`
  (e a de `cs_card_payments`) seguem lá. Limpeza é manual hoje. Se isso virar recorrente, a saída
  é o backfill marcar como `deleted_at` quem não voltou na varredura completa — mas aí o backfill
  passa a ser autoridade sobre exclusão, o que é uma decisão, não um detalhe.
- ⚠️ ~~**A guarda `ceo_current_role()` não bloqueava com papel NULL**~~ — **corrigido em 31/jul**
  ([`20260731c_ceo_guard_null_safe.sql`](../../../supabase/migrations/20260731c_ceo_guard_null_safe.sql),
  [fix documentado](../fixes/correcao-guarda-ceo-null.md)). `NULL NOT IN (...)` é NULL, não TRUE, e
  `IF NULL THEN` não entra — a guarda caía direto no corpo da função. Afetava as 4 RPCs do painel,
  inclusive a do Financeiro em produção.
- **Qualidade do dado do Financeiro**: 2 grupos em 360 cards têm mesmo contrato + mesmo valor +
  mesma categoria + mesmo dia (suspeita forte de lançamento em duplicata). Vira **aviso** na aba, não
  dedupe — o mesmo contrato com categorias diferentes é dado legítimo.
- **Duas convenções de parcelamento no mesmo pipe** (2024/2025 × 2026): resolvido por `fin_entries`,
  mas é a fonte de erro mais provável do backfill. Conferir o total de um mês de 2024 **e** de um de
  2026 contra o Pipefy, não só um dos dois.
- ~~**Papel `ceo`**: confirmar o nome do enum de `profiles.role`~~ — resolvido (30/jul): a coluna
  **não é enum**, é `text` com o CHECK `profiles_role_check`. Ver `20260730_ceo_role_check.sql`.
- **Leads não versionado** (Sprint 3/4): extrair do Supabase ao vivo antes de depender.
- **Identidade não unificada** (Sprint 4).
- **Projeção do CS** ainda não construída no painel de CS — construímos a RPC de leitura aqui.

---

## Verificação (por sprint)
- **Build**: `npm run lint` + `tsc` verdes nos arquivos tocados (padrão do repo).
- **Ingestão** (S1/S2): rodar o backfill (`npm run import:financeiro` / `import:negociacao`), conferir
  linhas no Supabase; teste do cenário Make retornando **200**.
- **Trava/RBAC** (S0): logar como `ceo` → vê `/ceo` e os dados; como `agent`/`supervisor` → `/ceo`
  redireciona (middleware); como `admin` → vê. Enquanto não pronto, `NEXT_PUBLIC_CEO_ENABLED` mantém a
  rota oculta.
- **Financeiro** (S1): ✅ **feito em 31/jul** por `npm run verify:financeiro`
  ([`scripts/verify-financeiro.mjs`](../../../scripts/verify-financeiro.mjs)) — o script reimplementa
  em JS as mesmas regras da migration (parsers, COALESCE da categoria, sinal, as duas convenções),
  recomputa a partir do **Pipefy cru** e compara card a card com `fin_cards`/`fin_entries`.
  Resultado: 4.549/4.549 cards · 5.348 pagamentos (parcela 3.212 / card 2.136) · **0** divergências ·
  32/32 meses · total R$ 7.310.222,27 dos dois lados. Roda com meses específicos:
  `node scripts/verify-financeiro.mjs 2024-09 2026-07`.

  ⚠️ **O que essa conferência prova e o que não prova.** Ela prova que a **ingestão** está fiel ao
  Pipefy: parser de `DD/MM/YYYY` correto, as duas convenções de parcelamento tratadas, nenhum card
  perdido, nada contado em dobro, sinal aplicado. Ela **não** prova que as *regras de negócio* são as
  certas — se "qual valor é a entrada" ou "quais fases contam" estiver errado, as duas implementações
  erram junto. Essa parte é leitura do dono: o número do mês tem que fazer sentido pra ele.
- **Projeções** (S2): `npm run verify:negociacao`
  ([`scripts/verify-negociacao.mjs`](../../../scripts/verify-negociacao.mjs)) — mesmo molde do
  Financeiro: reimplementa em JS as regras da migration (parsers, prioridade do sinal, filtro de
  fase, filtro de pago), recomputa do **Pipefy cru** e compara card a card com `neg_cards`.
  Roda **antes** da migration em modo **prévia** (mostra o número que vai dar) e depois em modo
  conferência. Resultado em 03/ago, já com o banco carregado: **3.343/3.343 cards, 0 divergências
  de dado, R$ 10.000,00 em 8 cards** batendo dos dois lados (R$ 4.750,00 vencidos / R$ 5.250,00 a
  vencer ≤30d), 5 do sinal `parcela2` e 3 do sinal `fase`.

  **Defasagem de fase não reprova.** O script separa divergência de DADO (valor/data/sinal/pago —
  erro de ingestão) de card que mudou de fase depois da carga (o poll do Make ainda não passou —
  normal num sistema vivo). Só chama atenção quando a fase defasada é a de projeção, porque aí a
  aba mostra número velho. Em 03/ago: 1 card defasado, fora da fase de projeção.

  Ele confere duas coisas que o do Financeiro não precisava:
  - **Anti-dupla-contagem:** quanto está nas fases de espera já marcado como pago (R$ 7.898,60 em
    7 cards) — dinheiro que já está em `fin_entries` e tem que ficar **fora** da projeção. Sem esse
    filtro a projeção inflaria ~50%.
  - **Alarme de fuso:** quantos campos de data têm o dia local ≠ o dia do `datetime_value` (79). É
    um número informativo permanente — se alguém trocar a ingestão pra ler `datetime_value`, as
    divergências card a card saem de 0 e o script falha.

## Referências

- [`painel-ceo-indice.md`](painel-ceo-indice.md) — índice/estado do painel do CEO.
- [`dashboard-cs-indice.md`](../../painelcs-docs/updates/dashboard-cs-indice.md) — painel de CS (molde a
  reutilizar).
- [`make-integracao-cs.md`](../../painelcs-docs/updates/make-integracao-cs.md) — cenário Pipefy → Make →
  Supabase (clone p/ Financeiro/Negociação).
- [`../links.md`](../../links.md) — índice mestre da documentação.
