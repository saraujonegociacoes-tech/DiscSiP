# Estrutura da Aplicação

## Navegação (Topbar)

A navegação entre as telas acontece por uma **barra horizontal fixa no topo** (topbar), não mais por sidebar lateral.

```
┌────────────────────────────────────────────────────────────────────────┐
│ 🏠 Visão Geral │ 👥 Equipe │ 🎯 Funil │ ⚠ Operação │ 📊 Performance │ ❌ Lead Morto │ 🔍 Leads │
└────────────────────────────────────────────────────────────────────────┘
```

Cada aba responde uma pergunta diferente:

| Aba | Pergunta que responde |
|---|---|
| 🏠 Visão Geral | Como está a operação agora? |
| 👥 Equipe | Quem está performando melhor ou pior? |
| 🎯 Funil | Onde estou perdendo leads no processo? |
| ⚠ Operação | O que precisa de ação agora? |
| 📊 Performance | Estamos melhorando ao longo do tempo? |
| ❌ Lead Morto | Por que estamos perdendo leads? |
| 🔍 Leads | Exploração livre dos dados |

---

## 🏠 Visão Geral

**Pergunta:** "Como está a operação agora?"

### Layout

```
┌────────────────────────────────────────────────────────────────────────┐
│ 🏠 Visão Geral │ 👥 Equipe │ 🎯 Funil │ ⚠ Operação │ 📊 Performance │ ...│
├────────────────────────────────────────────────────────────────────────┤
│ Dashboard de Leads                                            Filtros  │
└────────────────────────────────────────────────────────────────────────┘

 KPIs

┌──────┬──────┬──────┬──────┬──────┬──────┐
│Ativos│Venda │Conv.%│Morto │Parado│1ºCont│
└──────┴──────┴──────┴──────┴──────┴──────┘

┌────────────────────────────────┬──────────────────────┐
│ Evolução de Leads              │ Alertas              │
│ (Linha)                        │ (Lista)              │
└────────────────────────────────┴──────────────────────┘

┌──────────────────────────────────────────────────────────┐
│ Distribuição atual do Funil (Barras Horizontais)          │
└──────────────────────────────────────────────────────────┘
```

### Gráficos

| Pergunta | Gráfico |
|---|---|
| Como evoluiu? | Linha |
| Onde estão os leads? | Barras horizontais |
| Estado atual? | KPI Cards |
| Existe problema? | Lista de alertas |

---

## 👥 Equipe

**Pergunta:** "Quem está performando melhor ou pior?"

Essa seria a principal tela do supervisor.

### KPIs

- Equipe
- Conversão média
- Tempo médio
- Lead morto

---

### Ranking dos responsáveis

```
┌────────────────────────────┐
│ João                       │
│ Maria                      │
│ Pedro                      │
└────────────────────────────┘
```

---

### Tabela comparativa

| Responsável | Ativos | Conversão | Lead Morto | Tempo 1º Contato | Parados |
|---|---|---|---|---|---|

### Gráficos

| Pergunta | Gráfico |
|---|---|
| Quem converte mais? | Barras horizontais |
| Quem demora mais? | Barras horizontais |
| Quem tem mais carga? | Barras horizontais |
| Comparação geral? | Tabela |

> **Nada de pizza. Ranking = barra horizontal.**

---

## 🎯 Funil

Essa tela inteira é sobre **processo**.

### KPIs

```
Conversão Geral
        ↓
Funnel Chart enorme
        ↓
Tempo médio por etapa
        ↓
Perda entre etapas
```

### Gráficos

**Principal — Funnel Chart**

Porque responde: *Onde estou perdendo leads?*

**Depois — Tempo médio por etapa (Barra horizontal)**

```
Recebidos   1 dia
1°          5 dias
2°          3 dias
3°          8 dias
```

Muito mais fácil que uma tabela.

**Depois — Conversão entre etapas (Waterfall ou Barras)**

```
Recebidos   100%
    ↓
1°          63%
    ↓
2°          41%
    ↓
...
```

---

## ⚠ Operação

Essa é praticamente um **painel de incidentes**.

- Leads sem contato
- Leads >48h
- Leads >7 dias
- Sem responsável
- Duplicados
- Campos obrigatórios faltando

**Nada de gráficos bonitos.**

A informação importante é: *O que precisa de ação?*

Use:

- Lista
- Cards
- Tabela

---

## 📊 Performance

Essa é **histórica**.

**Pergunta:** Estamos melhorando?

```
Conversão      (Linha)
────────────
Tempo médio    (Linha)
────────────
Lead morto     (Linha)
────────────
Recebidos      (Área)
```

Tudo série temporal. **Linha. Não barras.**

---

## ❌ Lead Morto

Essa merece uma tela separada.

### KPIs

- Total
- Taxa
- Tempo até descarte

### Depois — Motivos

Poucas categorias — então pode usar pizza.

```
Sem finalidade   52%
Empréstimo       31%
Quitação         17%
```

Ou **Barra horizontal**, que normalmente fica ainda melhor.

### Depois — Lead morto por responsável

Barra horizontal.

### Depois — Em qual etapa morreu?

Barras.

```
1°   █████████████
2°   ██████
3°   ███
```

---

## 🔍 Leads

Nenhum gráfico. Só exploração.

```
Filtro
   ↓
Tabela
   ↓
Abrir Lead
```

---

## Hierarquia Visual

Aplicando os princípios de UX, a estrutura de cada tela (abaixo da topbar) segue sempre a mesma ordem:

```
Topbar (navegação entre abas)
        ↓
Título da aba + Filtros
        ↓
KPIs
        ↓
Gráfico Principal
        ↓
Gráficos Secundários
        ↓
Tabela
```

Isso reduz drasticamente a carga cognitiva, porque o usuário aprende uma única estrutura e a reconhece em todas as abas — a topbar fica fixa, e apenas o conteúdo abaixo muda.

---

## Paleta de cores

Use as cores apenas para transmitir significado:

| Cor | Significado |
|---|---|
| 🔵 Azul | Informação neutra |
| 🟢 Verde | Sucesso (Venda, Conversão) |
| 🟡 Amarelo | Atenção (Tempo elevado) |
| 🔴 Vermelho | Problema (Leads parados, Lead morto) |
| ⚫ Cinza | Informação secundária |

> Evite usar cores apenas por estética; elas devem comunicar prioridade.

---

## O gráfico certo para cada métrica

| Métrica | Gráfico recomendado | Justificativa |
|---|---|---|
| Leads por responsável | Barras horizontais | Facilita ranking e comparação entre pessoas. |
| Conversão por responsável | Barras horizontais | Comparação direta de desempenho. |
| Tempo médio por fase | Barras horizontais | Destaca rapidamente gargalos. |
| Leads recebidos ao longo do tempo | Linha | Evidencia tendência e sazonalidade. |
| Conversão ao longo do tempo | Linha | Permite acompanhar evolução. |
| Distribuição dos leads nas fases | Barras horizontais | Mais legível que um funil para mostrar volume atual. |
| Fluxo completo do processo | Funnel Chart | Mostra claramente a perda entre etapas. |
| Motivos de lead morto | Barras horizontais (ou pizza se houver apenas 3 categorias) | Comparação simples de categorias. |
| Leads parados por responsável | Barras horizontais | Prioriza rapidamente quem precisa de intervenção. |
| Tempo até 1º contato | Bullet Chart ou KPI + meta | Compara desempenho com um objetivo. |
| Indicadores gerais (Conversão, Ativos, Parados) | KPI Cards | Resposta imediata para perguntas simples. |
| Alertas operacionais | Lista ou tabela destacada | Mais eficiente que qualquer gráfico para tomada de ação. |
| Carga de trabalho ao longo do funil | Heatmap | Cruza responsáveis × fases, destacando concentrações e gargalos. |

---

Essa abordagem segue exatamente os princípios de *Storytelling with Data* e *The Big Book of Dashboards*: primeiro definir a pergunta, depois escolher a visualização mais adequada, reduzir o ruído visual e organizar a interface para que o usuário encontre a resposta em poucos segundos. O resultado é um dashboard que não apenas "mostra dados", mas orienta decisões.

---

# Roadmap de implementação

> Legenda de status: ✅ entregue · 🔜 próxima · ⬜ planejada

O dashboard de leads **já existe e está deployado**, mas ainda **não foi lançado** (fica atrás da tela "Em breve", flag `NEXT_PUBLIC_LEADS_ENABLED`). Hoje é **uma única página com rolagem**; este roadmap converte para o novo visual (topbar de 7 abas) e adiciona as métricas que faltam. Cada sprint é uma **fatia vertical demonstrável**. Ao fim de cada sprint: `tsc` + `lint` verdes, este doc atualizado, memória atualizada e um **bloco de handoff** para a próxima conversa.

### O que já existia (reaproveitado)
`LeadKpiRow`, `Funnel`, `DeadReasonsDonut`, `DeathByAttempt` ("em qual etapa morreu"), `AgentRanking`, `ForgottenLeads`, `OrphanLeads`, `DuplicateAlert`, `ChannelBreakdown`, `LeadsTable`, `PeriodPicker`. Dados via RPC agregado único `get_leads_dashboard` (+ `get_agent_stuck`, `getSupervisorMetrics`, `getAgentLeads`, `getDuplicateAlerts`). Stack: Recharts + shadcn/ui + Tailwind v4 + tokens `blueline` + `useChartTheme`.

### O que falta (nova camada de dados — sempre agregada no Postgres via RPC `security_invoker`; só migrations incrementais, por causa do erro 1102 de CPU e do risco de apagar dados)
- **Série temporal** de leads ao longo do tempo (recebidos/ganhos/mortos/conversão/tempo) — para a linha de evolução (Visão Geral) e toda a aba Performance.
- **Conversão entre etapas adjacentes** (drop-off passo a passo) — hoje só existe o cumulativo "≥ ordem".
- **Tempo médio por etapa** (dwell time, de `lead_events.occurred_at`).
- **Lead morto por responsável** (dead-by-agent).
- **Tempo até descarte** (created→finalized dos mortos).
- **Explorador de leads** para supervisor/manager + filtro livre.
- **Campos obrigatórios faltando** (checagem de qualidade) na aba Operação.

## Sprints

### ✅ Sprint 1 — Shell de abas (topbar) — ENTREGUE
Troca a página de rolagem única por uma **topbar de 7 abas in-page** (estado na URL via `?aba=`), redistribuindo os componentes atuais nas abas, com gate por RBAC. **Sem dados novos**. Período + realtime + fetch agregado único **preservados e compartilhados** entre abas; trocar de aba é 100% client-side (nenhum refetch). O Radix desmonta o conteúdo inativo → só a aba ativa renderiza os charts (bom para CPU/1102).

**Mapa das abas (Sprint 1):**

| Slug (`?aba=`) | Aba | Conteúdo | Papéis |
|---|---|---|---|
| `visao-geral` (default) | 🏠 Visão Geral | `LeadKpiRow` + `Funnel` + `DeadReasonsDonut` | todos |
| `equipe` | 👥 Equipe | `AgentRanking` + `ChannelBreakdown` | supervisor+ |
| `funil` | 🎯 Funil | `Funnel` | todos |
| `operacao` | ⚠ Operação | `ForgottenLeads` + `OrphanLeads` + `DuplicateAlert` | supervisor+ |
| `performance` | 📊 Performance | placeholder ("chega na Sprint 2") | supervisor+ |
| `lead-morto` | ❌ Lead Morto | `DeadReasonsDonut` + `DeathByAttempt` | todos |
| `leads` | 🔍 Leads | agente: `LeadsTable`; gestor: placeholder ("chega na Sprint 5") | todos |

**Arquivos:** novos `src/features/leads/components/LeadsTabNav.tsx` (topbar sobre o Radix `ui/tabs`) e `src/features/leads/components/TabPlaceholder.tsx` (card "Em breve nesta aba"); editados `src/app/leads/LeadsClient.tsx` (Tabs + sync `?aba=` via `useSearchParams`/`router.replace`), `src/app/leads/page.tsx` (`<Suspense>` em volta do client) e `src/features/leads/index.ts`.

**Nota de escopo:** o `ChannelBreakdown` não estava no rascunho de abas, mas foi alocado em **Equipe** (supervisor) para não se perder; pode migrar de aba numa sprint futura.

### ✅ Sprint 2 — Visão Geral completa + Performance (série temporal) — ENTREGUE
Duas RPCs de série temporal (migration `20260710`): **`get_leads_timeseries`** (evolução DIÁRIA no período) e **`get_leads_trend`** (tendência ENTRE CICLOS, últimos 6). Visão Geral ganhou a **linha de evolução** (recebidos/ganhos/mortos por dia) + **painel de alertas** (resumo → aba Operação). Performance saiu do placeholder para **4 gráficos por ciclo**: conversão %, tempo até 1º contato, taxa de lead morto (linhas) + recebidos (área). Detalhe abaixo.

### ✅ Sprint 3 — Funil aprofundado — ENTREGUE
**Tempo médio por etapa** (dwell time) via nova RPC `get_leads_dwell_time` sobre `lead_events` (1ª leitura desse dado em toda a feature). **Conversão entre etapas adjacentes** acabou **sem precisar de dado novo** — é derivável do `funnel` que `get_leads_dashboard` já retorna (`reached[i+1] / reached[i]`), então ficou como shaper puro no componente, sem RPC nem action extra. Detalhe abaixo.

### 🔜 Sprint 4 — Equipe + Lead Morto
Equipe (tela principal do supervisor): ranking em **barras horizontais** + tabela comparativa + KPIs de equipe. Lead Morto (aba dedicada): total/taxa/**tempo até descarte** (nova métrica) + motivos + **lead morto por responsável** (nova métrica) + "em qual etapa morreu" (`DeathByAttempt`).

### ⬜ Sprint 5 — Operação + Leads (explorer) + polimento/lançamento
Operação: painel de incidentes (buckets **>48h / >7 dias**, sem contato, sem responsável, duplicados, **campos obrigatórios faltando**). Leads: **explorador livre** (filtro → tabela paginada → abrir lead) para todos os papéis. Polimento: consistência dataviz, estados vazios, a11y, responsividade, cor só por significado. Checklist de lançamento (flip da flag).

---

# Correções de contabilização (08/jul) — pré-Sprint 2

Ao revisar os painéis surgiram 3 bugs de **contagem** (pré-existentes, do dashboard antigo). Confirmados com queries na base real e corrigidos juntos numa **migration incremental** — `supabase/migrations/20260708_leads_dashboard_fixes.sql` (recria `get_leads_dashboard` + `v_dead_reasons`; NÃO toca em dados) — e no fallback JS `src/app/actions/leads.ts` (mesma lógica).

1. **Funil "Recebidos" subcontava** (ex.: 969 em vez de 1110). 141 leads mortos-sem-evento-produtivo tinham `max_funnel_order = -1` e sumiam do funil. Agora a ordem 0 (Recebidos) é ancorada em **todos** os recebidos do período. Idem "em qual etapa morreu": esses mortos passam a contar na ordem 0.
2. **Motivos de lead morto** vinham de `leads.discard_reason` — **texto livre** do agente (430 vazios + centenas de variações). Trocado pela **fase morta** (`current_phase` de quem `is_dead`): Sem Finalidade / Empréstimo / Quitação-Negociação. Dado estruturado.
3. **Tempo até 1º contato negativo** (−2,2h no KPI). Causa legítima: **lead retroativo** — vendedora pega lead antigo (anterior ao card no pipe) e preenche o 1º contato com a data real (ex.: janeiro), anterior ao `created_at`. A média (KPI **e** ranking) passa a considerar só `first_contact_at >= created_at`; retroativos saem da conta.

**+ Novo painel:** **Distribuição por fase atual** (`PhaseDistribution`, barras horizontais, volume atual, mortas em vermelho) — soma bate com o total recebido. Adicionado à **Visão Geral** (substitui o funil cumulativo lá) e à aba **Funil** (ao lado do funil de fluxo). Resolve o "não tem esses números nas fases": distribuição (volume atual) ≠ funil (fluxo cumulativo).

**Status:** ✅ migration `20260708` **aplicada e verificada** no banco (08/jul) — `kpis.total == funnelByOrder['0'] == 1132`, `deadReasons` por fase, `avgHoursToFirstContact = 27,2h` (≥ 0). `tsc` + `lint` verdes; nada commitado.

---

# Add-ons da Sprint 1 (interatividade) — 08/jul

Pedidos do dono ao revisar os painéis, entregues ainda na Sprint 1. Camada de dados na **nova migration incremental** `supabase/migrations/20260709_leads_drilldowns.sql` (idempotente, não toca dados; roda **depois** da `20260708` — inclui a versão completa da RPC + 2 seções novas) e no fallback JS (`src/app/actions/leads.ts`, mesma lógica).

1. **Drill-down por responsável** ao clicar numa barra de fase, nos dois gráficos:
   - **Distribuição por fase atual** → quem está **parado ali agora** por responsável (RPC `phaseByResponsible`, chaveado por nome da fase; soma bate com a barra).
   - **Funil de acionamento** → responsáveis dos que **alcançaram** aquela etapa (RPC `funnelByResponsible`, chaveado por ordem; soma bate com a barra cumulativa). Ambos seguem o período.
   - UI: barras clicáveis (`cursor-pointer`) abrem um painel inline `ResponsibleBreakdown` (novo componente compartilhado, mini-barras estilo `OrphanLeads`). *(a11y: barra Recharts não é focável por teclado — clique de mouse nesta iteração.)*
2. **Filtro por pessoa** no "Leads sem acionamento" (`ForgottenLeads`): `<select>` de responsáveis presentes na lista, filtra client-side. *(Caveat: a lista vem capada em `FORGOTTEN_LIMIT=100` mais antigos.)*
3. **Link do card no Pipefy** no "Responsabilidade duplicada" (`DuplicateAlert`): âncora "Pipefy" por linha → `https://app.pipefy.com/open-cards/{card_id}` (helper `src/lib/leads/pipefy.ts`). A view `v_duplicate_responsibility` ganhou `pipefy_card_id`.

**Arquivos:** migration `20260709`; `src/app/actions/leads.ts` (tipo `AgentCount`, `phaseByResponsible`/`funnelByResponsible` em `LeadsData` + RPC + fallback; `pipefyCardId` nos duplicados); `src/lib/types/database.ts` (`pipefy_card_id`); novos `src/lib/leads/pipefy.ts` e `ResponsibleBreakdown.tsx`; `Funnel.tsx`/`PhaseDistribution.tsx` (clique+breakdown); `ForgottenLeads.tsx` (filtro); `DuplicateAlert.tsx` (link); wiring em `LeadsClient.tsx` + `index.ts`. `tsc` + `lint` verdes; nada commitado.

---

# Sprint 2 (entregue) — séries temporais

**Camada de dados — migration `20260710_leads_timeseries.sql`** (idempotente, não toca dados; 2 RPCs `SECURITY INVOKER`, agregadas no Postgres):
- **`get_leads_timeseries(p_start, p_end)`** → evolução DIÁRIA no período: `[{day, received, won, dead}]`. Recebidos por `created_at`, ganhos/mortos por `finalized_at`, dias BRT sem movimento preenchidos com 0.
- **`get_leads_trend(p_windows jsonb)`** → tendência ENTRE CICLOS: recebe as janelas dos últimos 6 ciclos (o app monta de `recentCycles`) e devolve, por ciclo, recebidos/ganhos/mortos + média de horas até 1º contato (retroativos fora). Uma chamada só.

**App — `src/app/actions/leads.ts`:** tipos `DailyPoint` / `TrendPoint`; actions `getLeadsTimeseries(period)` e `getLeadsTrend()` (deriva conversão/taxa/lead-morto + rótulos de mês). Degradação graciosa: se a migration não rodou, retornam `[]` e a UI mostra estado vazio.

**UI (novos componentes):** `EvolutionChart` (linha diária, 3 séries), `TrendChart` (genérico, 1 métrica/ciclo, linha ou área, formata %/h/nº), `PerformancePanel` (4 `TrendChart`), `AlertsPanel` (resumo com atalho p/ Operação).
- **Visão Geral:** KPIs → **[Evolução (2/3) | Alertas (1/3)]** → [Distribuição por fase | Motivos]. Alertas: sem acionamento, parados, órfãos, duplicados (gestor) / parados (agente).
- **Performance:** conversão %, tempo até 1º contato, taxa de lead morto (linhas) + recebidos (área), 1 ponto por ciclo.
- **Fetch:** `timeseries` buscado junto no load e a cada troca de período (todos os papéis); `trend` buscado 1× no load só p/ gestor (independe do período). Wiring em `page.tsx` + `LeadsClient.tsx`; exports em `index.ts`.

`tsc` + `lint` verdes; nada commitado. **Confirmado ao vivo (10/jul): a migration `20260710` já estava rodando** — testei `get_leads_timeseries` direto contra o Supabase (leitura, sem alterar nada) e voltou dado real. O doc estava desatualizado nesse ponto; verificação: `soma(timeseries.received) == kpis.total` do ciclo; `trend` com 1 objeto/janela.

---

# Sprint 3 (entregue) — Funil aprofundado

**Achado de plataforma (10/jul):** o commit `bf62847` (mesmo dia) **removeu `supabase/` do repo git** — a pasta local de migrations agora só existe no disco de quem a cria (`.gitignore: /supabase/`, "schema mantido no Supabase"). Não há mais histórico de migrations versionado localmente. Para escrever a RPC desta sprint com as colunas certas, o schema de `lead_events`/`lead_phases` foi **introspectado ao vivo** (leitura, via `openapi+json` do PostgREST com a service role do `.env.local` — nenhuma alteração no banco). Colunas confirmadas de `lead_events`: `id, lead_id, pipefy_card_id, from_phase, to_phase, to_phase_id, agent_id, occurred_at, created_at`.

**Camada de dados — migration `20260710_leads_funnel_depth.sql`** (idempotente, `CREATE OR REPLACE FUNCTION`, não toca dado; `SECURITY INVOKER` — o RLS de `leads_select`/`lead_events_select` vale igual às outras RPCs):
- **`get_leads_dwell_time(p_start, p_end)`** → tempo médio (horas) que os leads criados no período passam em cada etapa produtiva **antes de sair dela** (`LAG(occurred_at)` por lead, ancorado em `leads.created_at` para a 1ª transição = saída de "Recebidos"). Só conta transições **completas** — um lead ainda parado na fase atual não entra (dwell em aberto/censurado enviesaria a média pra cima nas fases com backlog). Retorna `{funnel_order, avg_hours, sample_size}` por etapa (0..8; Venda é terminal).
- **Conversão entre etapas adjacentes NÃO virou RPC** — simplificação em relação ao plano original: dá pra derivar do `funnel` que `get_leads_dashboard` já devolve (`reachedByOrder[i+1] / reachedByOrder[i]`), então é um shaper puro dentro do componente (`StepConversion.tsx`), sem round-trip novo.

**App — `src/app/actions/leads.ts`:** tipo `StepDwellTime`; action `getLeadsFunnelDepth(period)` (mapeia o retorno da RPC pelas `PRODUCTIVE_PHASES`, igual ao padrão de `buildFunnel`/`buildDeathByAttempt`). Degradação graciosa: RPC ausente → `[]`, UI mostra estado vazio.

**UI (novos componentes):** `StepDwellTime` (barras horizontais, `Xh`/`X d` — mesma regra de formatação do `fmtHours` já usado em `LeadKpiRow`/`AgentRanking`; só mostra etapas com `sampleSize > 0`) e `StepConversion` (barras horizontais, % da etapa anterior que avançou; deriva de `data.funnel`, sem prop de dado novo). Aba **Funil**: nova seção abaixo do Funil + Distribuição por fase existentes — `[StepDwellTime | StepConversion]`. Fetch: `funnelDepth` busca junto com `timeseries` no load inicial, na troca de período e no refresh silencioso do Realtime — mesmo tratamento pros dois papéis (a aba Funil é visível a todos, RLS escopa o resultado por agente/depto como o resto). Wiring em `page.tsx` + `LeadsClient.tsx`; exports em `index.ts`.

`tsc` + `eslint` verdes; nada commitado. **Pendente do dono: rodar `20260710_leads_funnel_depth.sql` no Supabase** (até lá, "Tempo médio por etapa" aparece vazio por degradação graciosa; "Conversão entre etapas" já funciona hoje, pois não depende da migration nova). Verificação sugerida no rodapé do arquivo de migration.

---

# Handoff — para a próxima conversa (início da Sprint 4)

**Onde paramos:** Sprints 1, 2 e 3 no código. **Sprint 1 (migrations `20260708`/`20260709`) aplicada e verificada no banco.** **Sprint 2 (migration `20260710_leads_timeseries.sql`) confirmada rodando ao vivo (10/jul).** **Sprint 3 (migration `20260710_leads_funnel_depth.sql`) implementada — falta o dono rodar** (a parte de conversão entre etapas não depende disso e já funciona). `tsc` + `lint` verdes; nada commitado (o dono controla o git). **Nota de plataforma:** `supabase/` saiu do git (`bf62847`, 10/jul) — migrations novas continuam sendo escritas em `supabase/migrations/`, só não são mais versionadas; o dono é quem as aplica e guarda.

**Como rodar/verificar localmente:** `NEXT_PUBLIC_LEADS_ENABLED=1` no `.env.local` → `npm run dev` → logar → `/leads` → aba Funil. Tempo médio por etapa fica vazio até a migration `20260710_leads_funnel_depth.sql` rodar; conversão entre etapas já aparece (não depende de migration nova). *(Interativo exige sessão autenticada — feito pelo dono.)*

**Próximos passos (Sprint 4 — Equipe + Lead Morto):**
1. **Equipe** (tela principal do supervisor): ranking em barras horizontais (`AgentRanking` já existe como tabela ordenável — decidir se vira gráfico ou se a tabela já resolve) + tabela comparativa + KPIs de equipe.
2. **Lead Morto** (aba dedicada): total/taxa (já existem) + **tempo até descarte** (nova métrica — `finalized_at - created_at` dos mortos, provavelmente cabe numa RPC pequena ou até em `get_leads_dashboard`) + motivos (`DeadReasonsDonut` já existe) + **lead morto por responsável** (nova métrica, provavelmente agregável em `get_leads_dashboard` sem RPC extra) + "em qual etapa morreu" (`DeathByAttempt` já existe).
3. Verificar o que já dá pra reaproveitar de S3 do `sprints-dashboard-leads.md` (o dashboard "antigo" já tem `AgentRanking`/`DeathByAttempt`/ranking por depto) antes de criar componente novo.

**Cuidados herdados (memória do projeto):** o dono controla git/migrations/deploy; PowerShell 5.1; agregar sempre no Postgres (nunca puxar tabelas inteiras — erro 1102); só migrations incrementais (reaplicar consolidado APAGA dados); `CREATE OR REPLACE VIEW` só adiciona coluna no FIM; cuidado com `name` ambíguo (qualificar alias); dashboard segue atrás de "Em breve" até o lançamento; `supabase/` não é mais versionado — para conferir schema ao vivo sem tocar em nada, dá pra ler `GET {SUPABASE_URL}/rest/v1/` com `Accept: application/openapi+json` e a service role do `.env.local`.
