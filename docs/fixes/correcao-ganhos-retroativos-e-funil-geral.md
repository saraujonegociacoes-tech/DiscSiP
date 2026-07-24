# Fix + feature — Ganhos por data de venda e funil "geral" (ciclo × retroativo)

> Criado em 2026-07-18. Sintoma relatado pelo dono: o painel de leads calcula "ganhos"
> filtrando por `created_at` (quando o lead entrou no funil), não pela data real da venda.
> Um lead criado num ciclo anterior mas vendido ontem some do painel de "ontem" — o dia
> aparece zerado mesmo tendo venda real. Pedido: passar a contar por data de venda e
> classificar quanto do resultado é do próprio ciclo vs retroativo (lead antigo mexido
> agora); depois estendido pros dois gráficos do funil, que tinham o mesmo problema.

---

## Causa raiz

`get_leads_dashboard` (RPC preferencial) e seu fallback em memória `dashboardFromScan`
([`leads.ts`](../../src/app/actions/leads.ts)) filtram **tudo** — recebidos, ganhos,
mortos, funil, distribuição por fase — por `created_at` dentro do período selecionado.
Correto para "quantos leads entraram", errado para "quantos foram vendidos/mexidos": um
lead pode ter sido criado num ciclo e fechado (ou trabalhado) só num ciclo posterior.

Já existiam dois pedaços do padrão certo, usados como referência pra este fix:
`get_leads_timeseries` (linha de evolução diária) já conta ganhos/mortos por
`finalized_at`; e `getAgentLeads` (tabela "Meus leads" do agente) já classifica cada lead
como `'ciclo'` (criado dentro do período) vs `'retroativo'` (criado antes) — mesmo split
2-vias usado no fix.

## Decisão de escopo — por que RPCs novas, não editar `get_leads_dashboard`

`get_leads_dashboard` é uma função Postgres grande (funil, distribuição, ranking, canal,
drill-downs) que **não está versionada no repo** — só existe no Supabase ao vivo, sem
acesso direto ao banco nesta sessão (sem CLI/connection string). Reescrevê-la inteira às
cegas exigiria mandar o `CREATE OR REPLACE FUNCTION` completo sem poder testar antes do
dono aplicar — risco de quebrar funil/ranking/canal que já funcionam.

Por isso as duas correções usam **funções novas e pequenas**, aditivas, no mesmo padrão já
usado em `get_leads_dwell_time`/`get_leads_timeseries` (migrations incrementais, "não toca
em dado"). O app mescla o resultado por cima do que `get_leads_dashboard` já devolve.
`get_leads_dashboard` em si **não foi tocada**.

**Fica de fora (não corrigido ainda):** a coluna "Ganhos" do ranking por agente
(`AgentRanking.tsx`) e o breakdown por canal (`ChannelBreakdown`) continuam contando por
`created_at` — mesma causa raiz, mas corrigir exigiria reescrever `get_leads_dashboard`
inteira. Também fora: `get_leads_trend` (aba Performance, tendência entre ciclos).

---

## 1. Ganhos por data de venda (KPI "Ganhos")

**Migration:** [`20260717_leads_won_by_sale_date.sql`](../../supabase/migrations/20260717_leads_won_by_sale_date.sql)

| Objeto | O quê | Retorno |
|---|---|---|
| `get_leads_won_by_sale_date(p_start, p_end)` | Ganhos/mortos por `finalized_at` (data da venda/descarte), não `created_at` | **1 `jsonb`**: `won`, `dead`, `wonCycle`, `wonRetro` |

`wonCycle`/`wonRetro` classificam cada ganho por `created_at`: dentro do período
selecionado = ciclo; antes = retroativo (lead arrastado de um ciclo anterior, vendido
agora).

**Server action** ([`leads.ts`](../../src/app/actions/leads.ts)): `getLeadsData` busca
essa RPC em paralelo com o dashboard base e sobrescreve `kpis.wonLeads`/`deadLeads`/
`conversionRate`/`deadRate` + os novos `wonCycle`/`wonRetro`. Fallback em memória
(`dashboardFromScan`) replica a mesma lógica com uma segunda leitura paginada (por
`finalized_at`, separada da leitura por `created_at` que já existia). RPC ausente →
degrada pro comportamento antigo (`wonCycle = wonLeads`, `wonRetro = 0`), sem quebrar.

**UI** ([`LeadKpiRow.tsx`](../../src/features/leads/components/LeadKpiRow.tsx)): novo
card "Ganhos" (`WonCard`, mesmo padrão visual do `StuckCard` já existente) — total grande
+ subtexto "X do ciclo · Y retroativos". O card "Conversão %" existente passa a refletir
o `wonLeads` corrigido (muda de "conversão do mesmo lote" pra "throughput do período" —
mesma leitura que a linha de evolução diária já usa).

**Nota de qualidade de dado:** lead com `is_won = true` mas `finalized_at` nulo (import
antigo do Pipefy sem `finished_at`) não é contado por esta RPC. Verificação incluída no
fim do arquivo de migration:
```sql
SELECT COUNT(*) FROM public.v_lead_progress WHERE is_won AND finalized_at IS NULL;
```

## 2. Funil "geral" (acionado no período, por `updated_at`)

Extensão do mesmo princípio pros dois gráficos da aba **Funil**: `Funnel.tsx` (fluxo
cumulativo — quantos leads ALCANÇARAM cada etapa) e `PhaseDistribution.tsx` (onde os
leads estão agora), que só enxergavam o cohort "recebidos no período".

**Migration:** [`20260718_leads_activity_by_update.sql`](../../supabase/migrations/20260718_leads_activity_by_update.sql)

| Objeto | O quê | Retorno |
|---|---|---|
| `get_leads_activity(p_start, p_end)` | Cohort NOVO: leads com `updated_at` no período (qualquer movimentação), não `created_at` | **1 `jsonb`**: `funnelByOrder` (cumulativo, mesma regra de `max_funnel_order >= ordem`) e `phaseDistribution` (fase atual) — cada linha já com `total`/`cycle`/`retro` |

Só usa colunas já existentes em `v_lead_progress` (`updated_at`, `created_at`,
`max_funnel_order`, `current_phase`, `phase_kind`, `current_funnel_order`) — sem
`lead_events`/`lead_phases`.

**Server action:** nova `getLeadsActivity(period)` — mapeia `funnelByOrder` via
`PRODUCTIVE_PHASES` (mesmo padrão de `buildFunnel`) e `phaseDistribution` direto. RPC
ausente → `{ funnel: [], phaseDistribution: [] }` (mesma degradação graciosa das outras
métricas novas).

**UI — dois componentes novos** em
[`src/features/leads/components/`](../../src/features/leads/components/):
`FunnelActivity.tsx` e `PhaseDistributionActivity.tsx`. Mesmo layout/eixos/tooltip dos
originais, mas em **barras empilhadas de 2 séries** (ciclo × retroativo) com o **total no
fim da barra** (`LabelList` no segmento do topo da pilha, `dataKey="total"`). Fases mortas
continuam sinalizadas — agora pelo rótulo do eixo Y em vermelho (o preenchimento da barra
já está ocupado pela identidade ciclo/retroativo).

Renderizados na aba **Funil**
([`LeadsClient.tsx`](../../src/app/leads/LeadsClient.tsx)), logo abaixo do par existente,
sob o subtítulo "Acionado no período (por atualização, não por criação)". Sem
drill-down por responsável (o RPC não devolve `byResponsible` pra este cohort — fora do
escopo pedido).

### Cor — ajuste pós-entrega (skill dataviz)

Cor inicial do segmento "retroativo" reaproveitava `ct.series.warning` (laranja) — mesmo
tom já usado em `StuckCard`/`LeadsTable` pro mesmo conceito. Feedback do dono: o laranja
já está "muito feito" nesses outros cards, perdendo identidade visual neste gráfico novo.

Trocado pra `ct.categorical[5]` (rosa, paleta categórica já validada do painel —
[`useChartTheme.ts`](../../src/components/bluedesk/useChartTheme.ts)). Validado com o
script da skill dataviz contra o azul do "ciclo" (`ct.series.primary`), luz e escuro:

```
node scripts/validate_palette.js "#2a78d6,#e87ba4" --mode light   # PASS
node scripts/validate_palette.js "#3987e5,#d55181" --mode dark    # PASS
```

Descartado antes: `ct.categorical[3]` (roxo) — passa em modo claro mas **falha** a
separação CVD/normal-vision contra o azul em modo escuro (ΔE 9.8, abaixo do piso 15).
Rosa também evita colidir com o vermelho já usado pra sinalizar "fase morta" no
`PhaseDistributionActivity` (`ct.series.danger`, reservado a esse status).

---

## Migrations a rodar (dono) + verificação

Nenhuma migration foi aplicada ainda — os dois arquivos existem só localmente (a pasta
`supabase/` é ignorada pra arquivos novos no `.gitignore` deste repo, por escolha já
feita antes; nada foi commitado).

1. Rodar **[`20260717_leads_won_by_sale_date.sql`](../../supabase/migrations/20260717_leads_won_by_sale_date.sql)**
   no SQL Editor do Supabase, depois as 3 queries de verificação no fim do arquivo
   (sanidade ampla, gap de dado sem `finalized_at`, um dia recente com venda conhecida).
2. Rodar **[`20260718_leads_activity_by_update.sql`](../../supabase/migrations/20260718_leads_activity_by_update.sql)**,
   depois as 3 queries de verificação no fim (total da ordem 0 bate com `updated_at` no
   período; `cycle + retro == total`; um lead antigo mexido hoje aparece só do lado
   retroativo).
3. `npx tsc --noEmit` e `npx eslint` já rodados e verdes nesta sessão (interfaces novas,
   nada quebrado nos componentes existentes).
4. No app (`npm run dev`), `/leads` → card "Ganhos" no topo (Visão Geral) e os dois
   gráficos novos na aba Funil, comparando com 1-2 leads conhecidos (venda ou
   movimentação recente de lead antigo).

## Status

Código pronto, `tsc`/`eslint` verdes. **Aguardando o dono aplicar as duas migrations** no
Supabase — sem elas, os KPIs/gráficos novos degradam graciosamente pro comportamento
antigo (sem quebrar nada), só sem a correção.
