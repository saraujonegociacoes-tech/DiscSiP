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
- Trava = **criar papel `ceo`** (novo valor no enum de papéis).
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

## Sprint 0 — Fundação & trava (papel `ceo` + rota `/ceo` + docs) — ✅ ENTREGUE (29/jul/2026)

> **Pendência do dono:** aplicar
> [`20260729_ceo_role.sql`](../../../supabase/migrations/20260729_ceo_role.sql) **em duas etapas,
> na ordem** (PARTE 1 → confirmar NOTICE → PARTE 2), e promover o CEO pelo `/admin` (o papel já
> aparece no select). Enquanto a migration não roda, o app compila e a rota existe, mas ninguém
> pode ser `ceo` — o valor não existe no enum.

**Papel `ceo` (RBAC em 3 camadas):**
- **Migration** [`supabase/migrations/20260729_ceo_role.sql`](../../../supabase/migrations/20260729_ceo_role.sql):
  adiciona `'ceo'` ao enum de `profiles.role` + cria `ceo_current_role()`. O **nome do enum não
  precisou de confirmação manual** — a migration o descobre pela própria coluna via catálogo
  (`pg_attribute`/`pg_type`), é idempotente (`ADD VALUE IF NOT EXISTS`) e avisa sem erro se a
  coluna for `text` em vez de enum. Dividida em PARTE 1 / PARTE 2 porque `ADD VALUE` não permite
  usar o valor novo na mesma transação, e o editor SQL do Supabase envolve o script todo numa só.
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
efeito no banco é um valor novo no enum e uma função nova, ambos inertes até o Sprint 1.

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

## Sprint 1 — Financeiro: entradas do mês (carro-chefe)

**Ingestão do pipe Financeiro (nova vertical isolada, clone do CS):**
- Migration `AAAAMMDD_financeiro_schema.sql`: `fin_cards` (id, `pipefy_card_id`, `metadata jsonb`,
  colunas derivadas `entry_value numeric`, `entry_date date`, `category text`), + RPC
  `ingest_financeiro_card(node)` (`SECURITY DEFINER`, grant só `service_role`) mapeando **field-ids →
  valor/data/categoria** e upsert idempotente. Reusar `cs_parse_money`/`cs_parse_date` (ou clonar como
  `fin_parse_*`).
- RPC de leitura `get_ceo_financeiro(p_start, p_end)` (com a guarda `ceo`/`admin`): total do período,
  série mensal e breakdown por categoria — **agrega no Postgres** e devolve 1 linha jsonb (evita o teto
  de 1000 linhas do PostgREST).
- Backfill `scripts/import-financeiro.mjs` (clone de `import-cs-cards.mjs`) + env
  `FINANCEIRO_PIPEFY_PIPE_ID` (reusa `PIPEFY_TOKEN`). Registrar `npm run import:financeiro`.
- Cenário Make (dono monta): Schedule → GraphQL delta → Transform to JSON → POST
  `rpc/ingest_financeiro_card`. Doc `updates/make-integracao-financeiro.md`.

**Frontend — aba "Financeiro":** `KpiCard`s (entradas do mês, vs. mês anterior, acumulado) +
`AreaChart` (Recharts via `useChartTheme`) da série mensal + `PeriodPicker`. Action `getCeoFinanceiro`
em `src/app/actions/ceo.ts`.

**Definição de "mês"** (pequena decisão): recomendo **mês civil** para a visão do CEO (executivo pensa
em mês de calendário); se preferir consistência com a operação, usar o **ciclo 11→10** de
[`src/lib/period.ts`](../../../src/lib/period.ts).

**Dependência do dono:** ID do pipe Financeiro + field-ids (valor da entrada, data, categoria). Aplicar
a migration e montar o Make.

---

## Sprint 2 — Projeções de pagamento (CS reusado + Negociação novo)

- **CS (reusar):** RPC `get_ceo_projecoes_cs()` (guarda `ceo`/`admin`) lendo a fase **"Aguardando
  Pagamento"** (id `343781769`, já seedada/ingerida) + `valor_da_parcela`,
  `data_de_vencimento_da_parcela_do_cliente`, `data_da_quita_o`, contagens P.P/P.A/P.V de
  `cs_cards.metadata`. Reusa `cs_parse_money`/`cs_parse_date`.
  ⚠️ A P4 (Pagamento) do painel de CS **ainda não foi construída** — os dados existem, mas não há RPC de
  projeção pronta. Construir aqui uma RPC de leitura compartilhável (e, se/quando a P4 do CS nascer, ela
  reaproveita a mesma).
- **Negociação (novo — "o único a fazer"):** integrar o pipe de Negociação como **vertical isolada**
  (clone do CS): migration `AAAAMMDD_negociacao_schema.sql` (`neg_cards` + `ingest_negociacao_card`),
  backfill `scripts/import-negociacao.mjs`, env `NEGOCIACAO_PIPEFY_PIPE_ID`, cenário Make. Foco na fase
  **"Aguardando Pagamento"** desse pipe. RPC `get_ceo_projecoes_negociacao()`.
- **Frontend — aba "Projeções":** timeline/gráfico "quando/quanto vão pagar" somando CS + Negociação +
  `KpiCard`s de total projetado por janela (vencidas / ≤30d / 31–90d / 90+).

**Dependência do dono:** ID do pipe Negociação + field-ids + id da fase "Aguardando Pagamento" dele.

---

## Sprint 3 — Saúde da empresa

Compor indicadores nível-empresa a partir de dados já existentes, via RPCs de leitura (guarda
`ceo`/`admin`), consolidados em `get_ceo_saude_empresa(p_start,p_end)`:
- Entradas (Financeiro), conversão comercial (Leads), carteira/negociação e movimento (CS), ritmo de
  entrega de TI (Monday: sprints/tarefas concluídas), volume de operação (Discador).
- **Frontend — aba "Saúde da Empresa":** scorecard de KPIs + mini-tendências (sparklines/`KpiCard` com
  delta).

⚠️ **Risco:** as RPCs/tabelas base de **Leads não estão versionadas no repo** (só na base ao vivo —
`supabase/manual/leads_dashboard_setup.sql` ausente). Antes de depender delas, extrair do Supabase ao
vivo.

---

## Sprint 4 — Saúde da equipe / colaboradores

Compor saúde por pessoa a partir de: CS (movimento/negociação por responsável, `get_cs_team`), Leads
(ranking/conversão/SLA/parados por agente), Monday (pontos/tarefas concluídas por assignee), Discador
(chamadas/dia). RPC `get_ceo_saude_equipe(p_start,p_end)` + aba "Saúde da Equipe".

⚠️ **Bloqueador de identidade:** as identidades **não são unificadas** entre domínios (`lead_agents`/
`cs_agents` por `pipefy_user_id`; Monday/Discador por `auth.users`/`profiles`; a ponte
`lead_agents.profile_id` está vazia). Este sprint carrega o trabalho de **unificar identidade** (popular
a ponte `profile_id` ou mapear por nome). Por isso é o último — maior esforço, menor prontidão de dados.

---

## Riscos & dependências (resumo)
- **Financeiro & Negociação**: pipe IDs + mapeamento de field-ids são **input do dono** (como toda
  integração anterior). Migrations e cenários Make aplicados **à mão** por ele.
- **Papel `ceo`**: confirmar o nome do enum de `profiles.role` na base ao vivo; `ALTER TYPE ADD VALUE`
  isolado.
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
- **Financeiro** (S1): conferir o total de "entradas do mês" contra o Pipefy para um mês conhecido.
- **Projeções** (S2): somatório projetado por janela bate com os cards em "Aguardando Pagamento".

## Referências

- [`painel-ceo-indice.md`](painel-ceo-indice.md) — índice/estado do painel do CEO.
- [`dashboard-cs-indice.md`](../../painelcs-docs/updates/dashboard-cs-indice.md) — painel de CS (molde a
  reutilizar).
- [`make-integracao-cs.md`](../../painelcs-docs/updates/make-integracao-cs.md) — cenário Pipefy → Make →
  Supabase (clone p/ Financeiro/Negociação).
- [`../links.md`](../../links.md) — índice mestre da documentação.
