# Sprints — Dashboard de fluxo de leads (Pipefy)

Plano de execução do dashboard de leads como **seção própria** dentro da Blue Line.
Este documento é o roadmap; os três documentos-irmãos deste silo são a fonte de verdade de _o quê_ e _por quê_:

- [`stack-tecnica-dashboard-leads.md`](stack-tecnica-dashboard-leads.md) — stack e o que cada peça supre
- [`catalogo-metricas-dashboard-leads (1).md`](catalogo-metricas-dashboard-leads%20(1).md) — catálogo de métricas (baseado no relatório real de 4.212 leads)
- [`panoramavisual.md`](panoramavisual.md) — análise da proposta visual

> Domínio **separado** do discador. Não misturar com o dashboard da discadora — ver [princípios](#princípios-travados).

---

## Estado atual (06/jul/2026)

**S0 FEITO e no ar.** Schema aplicado, base carregada e sincronização Make rodando 24/7.

- **Schema** aplicado via [`../../supabase/manual/leads_dashboard_setup.sql`](../../supabase/manual/leads_dashboard_setup.sql) (consolidado, drop+create). Tabelas `lead_phases` / `lead_agents` / `leads` / `lead_events` + 6 views + RPCs `ingest_lead_event` / `ingest_lead_card`. Tudo chaveado por **id do Pipefy** (nomes e fases têm lixo: `"Fechamento "`, `"Esther Vitoria "`).
- **Carga histórica** via `scripts/import-leads.mjs` (`npm run import:leads`): 4.247 cards, 0 falhas.
- **Sync viva**: Make a cada 30 min, **24/7**, GraphQL `allCards` com **filtro delta** (`updated_at >= now-35min`) → Iterator → JSON "Transform to JSON" → POST `rpc/ingest_lead_card(node)`. Ver [`make-integracao-pipefy.md`](make-integracao-pipefy.md).
- **Números reais** (o catálogo de 02/jul está *stale*): **~4.247 leads, 8 agentes, 15 duplicados, ~700 finalizados**. Canal (`capta_o_do_lead`) já vem preenchido em leads novos ("Meta ADS - …").

**S1 FEITO** (casca da seção) — jul/2026, ainda **não deployado** (o dono controla git/deploy); `tsc` + `eslint` verdes, `next build` não rodado. A `/leads` existe, é navegável por papel e mostra dados reais das views (layout cru — gráficos definitivos são do S2). Detalhes e arquivos na seção **S1** abaixo.

**S2 FEITO** (visão do agente) — jul/2026, **não deployado**; `tsc` + `eslint` verdes (erros restantes do `eslint` full são de `local-helper`/`public/helper`/`.open-next`, pré-existentes). Gráficos definitivos (Recharts + `useChartTheme`), tabela pessoal do agente e **"lead parado" por SLA de fase**. **Falta o dono rodar a migration `20260706_leads_sla.sql`** e mapear um `lead_agents.profile_id` para provar a visão do agente. Detalhes na seção **S2** abaixo.

**S3 FEITO** (visão do supervisor) — **deployado atrás de tela "Em breve"**; `tsc` + `eslint` verdes. Migration do SLA (`20260706_leads_sla.sql`) rodada e `lead_agents.profile_id` mapeado (agente já enxerga o próprio). Entregue: ranking comparativo **ordenável** + coluna "parados agora" (**inclui agentes com só parados retroativos** — decisão do dono), gráfico "onde o lead morre", alerta de duplicados (definitivo) e alerta de "leads sem acionamento". **Parados agora agregado no Postgres** (RPC `get_agent_stuck`, com fallback em memória). Detalhes na seção **S3**.

**S4 FEITO** — **Realtime LIGADO pelo dono (07/jul):** env `NEXT_PUBLIC_LEADS_REALTIME=1` + `ALTER PUBLICATION supabase_realtime ADD TABLE public.leads` rodado; a migration de perf `get_agent_stuck` também foi aplicada (verificado — o Realtime torna o RPC importante, não mais opcional). Também: **count-up sóbrio** nos KPIs de volume, **a11y** (`aria-sort`/`aria-busy`), egress via RPC. Enfeites que dependem do Realtime (destaque "venda", som opt-in) seguem adiados. Detalhes na seção **S4**.

**S5 EM ANDAMENTO (07/jul):** **S5.1 canal FEITO no código** (campo virou obrigatório no Pipefy → painel por canal + guarda de "dado incompleto"; falta o histórico encher). **S5.2 backup com scaffold** (`npm run backup:leads`, falta agendar/destino). **S5.3 ponte desenhada, dados 100% prontos** (8/8 `profile_id`+email) — não implementada de propósito (cruza domínios → só sob pedido explícito). Detalhes/contexto na seção **S5**.

**Furos conhecidos:** confirmar a assunção "mais recente = último de `respons_vel`".

**RBAC (07/jul):** achado que o **supervisor via todas as equipes** no domínio de leads (o S0 o pôs no mesmo balde que manager). Corrigido para o modelo do discador (supervisor = seu depto + órfãos) na migration `20260707_leads_supervisor_scope.sql` (**rodada e verificada** — é um aperto, não abre nada) + painel **"Leads sem responsável"** (órfãos por fase, ~395) para triagem. Detalhes na seção de princípios (#5) e no S3.

**Verificação final ao vivo (07/jul):** todas as migrations aplicadas (SLA, `get_agent_stuck`, `20260707` supervisor-scope), `profile_id` 8/8, publicação Realtime confirmada (`leads` em `supabase_realtime`), `tsc`/`eslint` verdes. **Falta só o dono** (em andamento): **commit/deploy** do S3–S5 e envs de prod no Cloudflare (`NEXT_PUBLIC_LEADS_REALTIME=1` e, ao lançar, `NEXT_PUBLIC_LEADS_ENABLED=1`).

---

## Princípios travados

Decisões já fechadas com o dono do produto (não reabrir sem motivo):

1. **Seção própria, mesmo app.** O dashboard de leads é uma seção independente (`/leads`), acessível pelo mesmo login/deploy da Blue Line — **não** é um app à parte, e **não** se mistura com o dashboard do discador (`/dashboard`). "Discadora é discadora; dashboard de leads é outra."
2. **Reusar a stack da Blue Line, descartar Vite/Pages.** O _plano de dados_ do doc de stack (Pipefy → Make → Supabase, com RLS + Realtime + Views) é 100% aproveitado. A _casca_ proposta (React + Vite no Cloudflare Pages) é descartada em favor de uma **rota nativa do Next**, reusando Recharts, Radix, Tailwind, os clientes Supabase e o RBAC que já existem.
3. **Isolamento de dados agora, ponte pronta pra depois.** Os leads vivem em tabelas próprias, **sem** reconciliar com os `profiles` do discador. A dimensão de agente do Pipefy carrega uma coluna `profile_id` _nullable_ e vazia por ora — no dia em que cruzar "desempenho no discador × no funil" for desejado, vira _backfill_, não remigração. Não é agora.
4. **Design system existente, não "Midnight Indigo".** A seção usa o tema _theme-aware_ que já existe (`theme.tsx`, `useChartTheme.ts`, `KpiCard`), não a paleta dark/glow proposta — para não virar uma ilha visualmente estrangeira. (Coerente com a própria ressalva do `panoramavisual.md`.)
5. **Duas visões via papéis existentes.** "Agente" (autoavaliação) e "Supervisor" (gerencial/ranking) mapeiam nos papéis `agent/supervisor/manager/admin` que o RBAC já tem. O escopo é garantido no banco (RLS), não no frontend, e segue o **mesmo modelo do discador**: agente vê **o seu**; **supervisor vê o do seu departamento + os órfãos** (leads sem responsável, para triagem); manager/admin veem **tudo**. A ponte de equipe é `lead_agents.profile_id → profiles.department_id`. Ver `20260707_leads_supervisor_scope.sql` (o S0 tinha posto supervisor no mesmo balde que manager — corrigido 07/jul).

---

## Hierarquia-alvo de arquivos

Espelha o padrão já usado por `features/ajuda` e `app/dashboard`:

```
src/
├── app/
│   ├── leads/
│   │   ├── page.tsx            # server component: Promise.all de server actions → client
│   │   └── LeadsClient.tsx     # client component (gráficos + realtime)
│   └── actions/
│       └── leads.ts            # server actions (espelha actions/supervisor.ts)
├── features/
│   └── leads/                  # espelha features/ajuda/
│       ├── LeadsPage.tsx
│       ├── components/         # Funnel, DeadLeadDonut, AgentRanking, KpiRow, DuplicateAlert…
│       ├── content/            # rótulos de fase, mapa produtivo × morto
│       └── index.ts
├── components/
│   └── Sidebar.tsx             # +1 item em NAV_ITEMS (com roles)
├── lib/
│   └── types/database.ts       # +tipos leads / lead_events / lead_agents
└── supabase/
    └── migrations/
        └── 20260702_leads_pipefy.sql   # tabelas + RLS + views agregadas
```

Sem mudança no `middleware.ts` — a rota `/leads` já cai no gate de sessão automaticamente.

---

## Visão geral dos sprints

| Sprint | Foco | Depende de |
|---|---|---|
| **S0** ✅ | Fundações de dados & integração (Pipefy → Make → Supabase) — **FEITO** | — |
| **S1** ✅ | Casca da seção, navegação e server actions — **FEITO** | S0 |
| **S2** ✅ | Visão do Agente (autoavaliação) — **FEITO** | S1 |
| **S3** ✅ | Visão do Supervisor (gerencial + ranking + alertas) — **FEITO** | S1 |
| **S4** ✅ | Tempo real, polimento e performance — **FEITO** (Realtime ligado 07/jul) | S2, S3 |
| **S5** 🔄 | Pós-MVP — canal ✅(código) · backup (scaffold) · ponte (desenho, sob pedido) | S4 |

MVP = S0→S4. S5 só quando o dashboard deixar de ser protótipo.

---

## S0 — Fundações de dados & integração — ✅ FEITO

**Objetivo:** ter o plano de dados de pé (banco + RLS + entrada de eventos) antes de qualquer tela.

**Entregue**
- Tabelas de fato `leads`, `lead_events`, dimensão `lead_agents` (chave `pipefy_user_id`, `profile_id` _nullable_ + `email` p/ ponte) e lookup `lead_phases` (chave `pipefy_phase_id`).
- Classificação de fase **produtiva × morta** centralizada em `lead_phases` (join por id), não no front nem no Make.
- **RLS**: agente só vê o próprio dado (via `profile_id`, fail-closed); supervisor/gerente/admin veem tudo. 6 **views** com `security_invoker=true` (a mesma view serve às duas visões).
- **RPCs**: `ingest_lead_event(payload)` (upsert idempotente) e `ingest_lead_card(node)` (adapter que traduz o node cru do Pipefy). `EXECUTE` só para `service_role`.
- **Make vivo** (24/7, delta) + **carga histórica** via `scripts/import-leads.mjs` (4.247 cards). Tudo aplicado por [`../../supabase/manual/leads_dashboard_setup.sql`](../../supabase/manual/leads_dashboard_setup.sql).

**Critério de aceite** — atendido, exceto:
- ⚠ RLS do agente ainda **não provado** na prática (precisa mapear um `lead_agents.profile_id`). Supervisor+ já funciona.
- Views batem com a realidade (700 finalizados ≈ catálogo; 15 duplicados; 8 agentes).

---

## S1 — Casca da seção, navegação e server actions — ✅ FEITO

**Objetivo:** a seção `/leads` existe, é navegável por papel e busca dados — ainda que com telas placeholder.

**Critério de aceite** — atendido: a aba aparece só para os papéis certos e navega para `/leads`; a página renderiza dados reais das views (layout cru). **Fora de escopo (S1):** gráficos definitivos, realtime.

**Entregue (06/jul/2026)** — `tsc` + `eslint` verdes; `next build` não rodado (deploy é do dono).
- Rota [`../../src/app/leads/page.tsx`](../../src/app/leads/page.tsx) (server: descobre o papel, calcula o ciclo corrente 11→10, `Promise.all`) + `LeadsClient.tsx` (client dentro do `AppShell`; troca de período re-busca; loading/vazio/erro). Espelha `app/dashboard`.
- [`../../src/app/actions/leads.ts`](../../src/app/actions/leads.ts): `getLeadsData(period)` lê **`v_lead_progress` filtrada por `created_at`** do período (puxa só o ciclo, não os 4.247 leads) e agrega KPIs / funil / motivos / ranking em memória; `getDuplicateAlerts()` é o now-alert. O RLS das views escopa por papel (agente vê o próprio, supervisor+ tudo); o ranking exclui responsabilidade duplicada.
- [`../../src/features/leads/`](../../src/features/leads/): `content/phases.ts` (catálogo de fases, espelha o seed) + componentes crus (`PeriodPicker` funcional, `LeadKpiRow`, `Funnel`, `DeadReasonsList`, `AgentRanking`, `DuplicateAlert`) + `index.ts`.
- Helper do ciclo em [`../../src/lib/leads/period.ts`](../../src/lib/leads/period.ts) (11→10 em BRT, bordas de fuso e virada de ano testadas); tipos das views em `lib/types/database.ts`; item **Leads** (ícone `Target`, todos os papéis) em `NAV_ITEMS` da `Sidebar.tsx`.
- Middleware **não** mudou (`/leads` não está na `managerArea` → agente entra; pendente cai em `/aguardando`).

---

## S2 — Visão do Agente (autoavaliação) — ✅ FEITO

**Objetivo:** a tela que o agente abre todo dia para se autoavaliar.

**Critério de aceite** — atendido (estático): KPIs/funil/donut pessoais via RLS; "lead parado" por SLA de fase (não global); tabela filtrável com parados destacados. **Pendências operacionais do dono:** rodar a migration `20260706_leads_sla.sql` e mapear ≥1 `lead_agents.profile_id` (senão o agente vê tela vazia). Supervisor+ já enxerga.

**Entregue (06/jul/2026)** — `tsc` + `eslint` (arquivos do S2) verdes; `next build` não rodado (deploy é do dono).
- **"Lead parado" = SLA por fase, ancorado no RECEBIMENTO.** Decisão do dono: a cadência de acionamento é fixa a partir de `created_at` (D+0…D+7), não dwell-in-phase (`updated_at` reseta em qualquer edição). `sla_hours` (numeric) por fase em `lead_phases`; `is_stuck` = aberto ∧ não morto ∧ não ganho ∧ `sla_hours` não nula ∧ `now − created_at > sla_hours`. Migration [`../../supabase/migrations/20260706_leads_sla.sql`](../../supabase/migrations/20260706_leads_sla.sql) (coluna + seed + `CREATE OR REPLACE VIEW v_lead_progress` anexando `title`/`sla_hours`/`is_stuck`; espelhado no consolidado). O `stuck_leads` (48h) da `v_agent_kpis` vira legado não usado.
  - Cadência → `sla_hours`: Recebidos 0.05 (3 min ⚠), 1° Acion. 8 (D+0 ⚠), 2° 24 (D+1), 3° 48 (D+2), 4° 96 (D+4), 5° 168 (D+7), 6°+/Procedimento/Fechamento/Venda/mortas = NULL. Os dois ⚠ são aproximações ajustáveis por um `UPDATE lead_phases SET sla_hours = … WHERE pipefy_phase_id = …` — **efeito imediato** (o `is_stuck` é calculado na leitura da view, sem reingestão/recriação). Instruções no rodapé da migration.
- **Duas análises no mesmo lugar (decisão do dono).** Métricas de desempenho (recebidos, conversão, lead morto, funil, donut) seguem o **período**; a fila de abertos/parados é **estado atual** (independe do período), com cada lead etiquetado `ciclo` (criado no período) vs `retroativo` (arrastado de antes). O card "Parados (agora)" mostra o total com split ciclo × retroativo.
- **Gráficos definitivos** (Recharts + `useChartTheme`): `Funnel` (barras horizontais, série única) e `DeadReasonsDonut` (donut + legenda rotulada; paleta categórica validada pela skill *dataviz* e centralizada em `useChartTheme.categorical`). `DeadReasonsList` (S1) removido.
- **Tabela `LeadsTable`** — abertos (fila) + finalizados-do-período, filtros (Todos/Abertos/Parados/Ganhos/Mortos/Retroativos), parados realçados. Colunas: Lead · Fase · Status · Aberto há · SLA · Origem.
- **Action** `getAgentLeads(period)` (nova) lê `v_lead_progress` (RLS escopa ao agente) com `abertos OU finalizados-no-período`; só é chamada para o papel `agent` (supervisor puxaria a base toda — isso é S3). `getLeadsData` inalterada. Card "Parados" só na visão do agente.

**Achado empírico (migration rodada 06/jul):** `v_lead_progress` deu **3321 parados / 3564 abertos (93%)** na visão-deus (dono, sem RLS). NÃO é bug nem SLA mal calibrado — o backlog é genuinamente vencido (ex.: ~2285 leads meses parados em 1° Acionamento; `agora − created_at` estoura qualquer SLA). O SLA-por-fase não "dessatura" porque a saturação é real. **Mitigação = o split ciclo × retroativo + escopo por agente** (decisão do dono mantida, 06/jul): o acionável é "parados do ciclo" (frescos, recuperáveis); "retroativos" = backlog a triar. Por agente o número é uma fatia pequena. (Refino "janela ativa" foi considerado e adiado — só se ficar ruidoso na tela real.)

**Fora de escopo:** ranking comparativo, alertas de processo (são do supervisor).

---

## S3 — Visão do Supervisor (gerencial + ranking + alertas)

**Objetivo:** a visão de equipe, sem duplicar lógica de permissão (mesma view, policy diferente).

**Escopo / entregáveis** (do catálogo, escopo do supervisor)
- Ranking de agentes lado a lado: volume, tempo médio até 1º contato, conversão, taxa de lead morto, parados agora.
- Funil da equipe; taxa de lead morto por agente; motivo de lead morto mais comum; em qual tentativa o lead mais morre.
- **Lista de alerta — responsabilidade duplicada** (~15 leads com 2+ responsáveis no `respons_vel`; view `v_duplicate_responsibility`): fora do ranking normal, para o supervisor corrigir no Pipefy.
- **Lista de alerta — leads sem acionamento** após X horas (lead esquecido).

**Critério de aceite**
- Supervisor vê todos os agentes; agente comum não acessa esta visão.
- Leads de responsabilidade duplicada não distorcem o ranking (aparecem só na lista de alerta).

**Fora de escopo:** métricas de canal (S5).

**Entregue (06/jul/2026)** — `tsc` + `eslint` verdes. Sem tocar no banco (só leitura de views agregadas / `v_lead_progress` recortada, como travado). Reusa `is_stuck`, a etiqueta ciclo/retroativo, o `PeriodPicker` e o `useChartTheme` do S2.

- **Action `getSupervisorMetrics(period)`** ([`../../src/app/actions/leads.ts`](../../src/app/actions/leads.ts)) — métricas de **estado atual** (NOW-scoped, não por período), lidas da MESMA `v_lead_progress` (o RLS deixa o supervisor ver tudo; a página nem chama isto para o papel `agent`), agregadas em memória com colunas enxutas:
  - `stuckByAgent` (keyed por `agentId`): parados agora por agente, com split `now`/`cycle` (exclui responsabilidade duplicada, para casar com o ranking).
  - `teamStuck` `{ total, cycle, retro }`: parados da equipe (inclui duplicados) — alimenta o card "Parados (agora)" também na visão do supervisor.
  - `forgotten` + `forgottenTotal`: leads **abertos em Recebidos/1° Acionamento, sem 1º contato, há mais de `FORGOTTEN_THRESHOLD_HOURS` (24h)** — os 100 mais antigos + o total real (via `count: 'exact'`). O limite é **ajustável** (const na action, efeito imediato) e viaja no payload (`forgottenThresholdHours`).
- **`getLeadsData` ganhou `deathByAttempt`** (sem leitura extra — deriva das linhas do período já buscadas): entre os mortos, a última etapa produtiva alcançada (`max_funnel_order`) → "em qual tentativa o lead mais morre".
- **`AgentRanking` reescrito** (definitivo): tabela **ordenável** por qualquer coluna (Recebidos / Ganhos / Conversão / Lead morto / 1º contato / **Parados agora**), com rank `#`, "menor é melhor" já com direção certa por padrão, e a coluna "Parados agora" realçada (tooltip com o split ciclo × retroativo). Substitui o ranking cru do S1.
- **`DeathByAttempt`** (novo, Recharts barras horizontais, cor *danger*) — a distribuição da mortalidade pelo funil.
- **`ForgottenLeads`** (novo) — alerta de "leads sem acionamento" (estado success quando zero; lista os mais antigos quando > 0).
- **`DuplicateAlert`** mantido (já servia como definitivo) — fora do ranking, para o supervisor corrigir no Pipefy.
- **`OrphanLeads`** (novo, 07/jul) — "Leads sem responsável": total + abertos + distribuição por fase (~395 órfãos, 275 em 1° Acionamento), para o supervisor triar e atribuir no Pipefy. `getSupervisorMetrics` ganhou `orphans {total, open, byPhase}`.
- **RLS do supervisor recortada por departamento (07/jul):** `leads_select`/`lead_events_select` reescritas — supervisor vê só o **próprio depto + órfãos** (era mesmo balde que manager). Ponte `lead_agents.profile_id → profiles.department_id`; helpers `lead_agent_dept`/`lead_in_supervisor_scope`. Migration `20260707_leads_supervisor_scope.sql`. Como as views são security_invoker, isso recorta TUDO (KPIs/funil/ranking/alertas) sem tocar no front.
- **`page.tsx` / `LeadsClient`** — para supervisor+: card "Parados" agora vem de `teamStuck`; novos painéis (DeathByAttempt + ForgottenLeads lado a lado, ranking, duplicados); a troca de período re-busca `getLeadsData` + `getSupervisorMetrics` (o split ciclo × retroativo dos parados é reancorado ao período).

**Nota de arquitetura (parados agora) — RESOLVIDO (S4/perf):** o "parados agora" é agregado **no Postgres** via RPC `get_agent_stuck(p_start, p_end)` (`SECURITY INVOKER` → o RLS do chamador vale, igual às views), que devolve **~1 linha por agente + 1 linha "equipe"** em vez de puxar a base aberta (~3.3k linhas) pro Worker — corta egress e CPU do Worker (mesma filosofia do fix do Error 1102). Migration: [`../../supabase/migrations/20260706_leads_agent_stuck.sql`](../../supabase/migrations/20260706_leads_agent_stuck.sql) (espelhada no consolidado). O app tem **fallback**: enquanto a função não existir no banco, `getSupervisorMetrics` volta a agregar em memória — funciona nos dois casos, então dá pra rodar a migration quando quiser. **Ranking mostra também agentes com só parados retroativos** (zero leads no período): entram com as métricas do período zeradas, para não sumirem da comparação (decisão do dono, 06/jul).

---

## S4 — Tempo real, polimento e performance

**Objetivo:** transformar em produto — atualização viva e acabamento visual sóbrio.

**Escopo / entregáveis**
- **Supabase Realtime:** a tela atualiza quando o Make grava um evento, sem F5 (subscription client-side, não passa pelo worker).
- Animações medidas conforme `panoramavisual.md`: count-up nos KPIs sem excesso; destaque reservado a eventos que merecem (ex.: venda), não a tudo; **som no toast opt-in e desligado por padrão**.
- Acessibilidade, responsividade, revisão de empty/error states.
- **Performance/egress:** confirmar que o front só lê views agregadas, nunca tabelas brutas.

**Critério de aceite**
- Mudança de fase no Pipefy reflete na tela aberta sem refresh manual.
- Consumo de egress condizente com o plano Free no volume atual.

**Entregue (06/jul/2026)** — `tsc` + `eslint` verdes.
- **Realtime (scaffolding, opt-in) — hook `useLeadsRealtime`** ([`../../src/features/leads/useLeadsRealtime.ts`](../../src/features/leads/useLeadsRealtime.ts)): assina `postgres_changes` em `public.leads` e dispara um **refetch silencioso** (debounce 1,5 s) do período corrente. O `LeadsClient` já usa (função `refresh`); selo **"Ao vivo"** no header quando ligado. RLS vale para o Realtime (agente só o próprio; supervisor+ tudo); por ser client-side **não passa pelo worker**. **Desligado por padrão** (nem abre socket). Ligar = DOIS passos: (1) env `NEXT_PUBLIC_LEADS_REALTIME=1`; (2) SQL uma vez `ALTER PUBLICATION supabase_realtime ADD TABLE public.leads;`.
- **Animação sóbria — `useCountUp`** ([`../../src/features/leads/useCountUp.ts`](../../src/features/leads/useCountUp.ts)): count-up só nas **contagens de volume** (Recebidos, Em aberto, Parados) — conversão/lead morto/tempo ficam estáticos ("sem excesso"). Respeita `prefers-reduced-motion` (pula pro valor final).
- **Egress/perf:** confirmado que o front só lê views agregadas / `v_lead_progress` recortada, nunca tabelas brutas; e o "parados agora" saiu do scan em memória para o RPC agregado (ver Nota no S3).
- **A11y:** `aria-sort` nas colunas ordenáveis do ranking, `aria-busy` no container durante o carregamento.

**Atualização (07/jul): o dono LIGOU o Realtime.** `NEXT_PUBLIC_LEADS_REALTIME=1` no `.env.local` (+ `NEXT_PUBLIC_LEADS_ENABLED=1` local) e rodou `ALTER PUBLICATION supabase_realtime ADD TABLE public.leads`. Como o Realtime dispara refetch a cada mudança, a **migration de perf `get_agent_stuck` deixou de ser opcional** e também foi aplicada (verificado). **Falta:** confirmar a publicação no SQL Editor + testar o "Ao vivo" no browser + a env `NEXT_PUBLIC_LEADS_REALTIME=1` no **build de produção** (Cloudflare) + commit/deploy. Os enfeites que dependem do Realtime (destaque de "venda", som opt-in) seguem **não implementados** (adiados). O resto do S4 (polimento sóbrio, egress, a11y) está fechado.

---

## S5 — Pós-MVP (só quando virar rotina)

**Objetivo:** destravar o que depende de dado/processo externo e blindar a operação. Abaixo o
contexto acionável de cada frente: o que é, por que está travado, o gatilho, os passos e o
critério de aceite.

> **Progresso (07/jul):** **S5.1 (canal) FEITO no código** — o campo virou obrigatório no
> Pipefy, então implementei o painel por canal com guarda de "dado incompleto" (só falta o
> histórico encher). **S5.2 (backup) com scaffold pronto** (`npm run backup:leads`, falta
> agendar/destino). **S5.3 (ponte) desenhada, dados 100% prontos** — não implementada de
> propósito (cruza domínios → só sob pedido explícito do dono).

### S5.1 — Métricas de canal (origem do lead)

> **Estado (07/jul): FEITO no código.** O campo `Captação do Lead` virou **obrigatório no
> Pipefy** (dono), então destravou. Implementado: `getLeadsData` agrega por canal
> (`channelBreakdown` + `channelFillRate`, sem leitura extra — o `channel` já vinha em
> `v_lead_progress`); componente `ChannelBreakdown` (tabela volume/conversão/lead morto por
> canal, barra de volume inline) com **guarda de "dado incompleto"** enquanto o preenchimento
> do período estiver < 80%. Canal é o valor cru de `capta_o_do_lead` (ex.: "Meta ADS -
> Whatsapp" vs "Meta ADS - Forms 1" são distintos), com cap top-12 + "Outros". **Só falta o
> histórico encher** (hoje ~12% no ciclo → o painel aparece marcado como incompleto e fica
> confiável sozinho conforme os leads novos entram). `tsc`/`eslint` verdes.

**O que é:** volume / conversão / taxa de lead morto **por canal de captação** (Meta ADS,
indicação, etc.) — separar "lead ruim" de "atendimento ruim".

**Por que está travado:** o campo `Captação do Lead` (`capta_o_do_lead`) vinha preenchido em
~0,5% da base histórica. Leads novos já chegam com "Meta ADS - …", então **está destravando
sozinho** conforme a base gira — mas ainda não é confiável para o histórico.

**O dado já flui:** o `channel` já é ingerido e existe em `v_lead_progress.channel` (o Make já
mapeia `capta_o_do_lead`). Ou seja, **falta só a camada de leitura + UI**, não migration de dados.

**Gatilho:** `Captação do Lead` virar **obrigatório** na entrada do card no Pipefy (ou o
Meta/formulário sempre enviar), levando o preenchimento dos leads do período para perto de 100%.

**Passos (quando destravar):**
1. Nova action tipo `getChannelBreakdown(period)` — agrega `v_lead_progress` por `channel`
   (mesmo padrão de `getLeadsData`: recorte por `created_at`, agregação em memória; vira RPC se
   pesar). KPIs por canal: recebidos, conversão, lead morto.
2. Componente `ChannelBreakdown` (donut ou barras, reusar `useChartTheme.categorical`).
3. **Estado bloqueado na UI:** enquanto o preenchimento do período estiver abaixo de um piso
   (ex.: < 80%), mostrar o painel com um selo "dado incompleto" em vez de número enganoso.

**Aceite:** painel de canal confiável para o período corrente; nada de número derivado de canal
vazio apresentado como verdade.

### S5.2 — Backup do banco

> **Estado (07/jul): SCAFFOLD pronto.** Script [`../../scripts/backup-leads.mjs`](../../scripts/backup-leads.mjs)
> (`npm run backup:leads`) — backup **lógico** (JSON timestampado por tabela + manifest) via
> PostgREST + service role, paginado, read-only, sem dependências. Testado (mecânica ok).
> `BACKUP_LIMIT=N` p/ teste rápido, `BACKUP_OUT_DIR` p/ destino. Saída em `backups/` (gitignored).
> **Falta a decisão do dono:** agendar (Make/cron) + destino externo (Cloudflare R2), ou migrar
> p/ Supabase Pro (backup gerenciado + PITR) e aposentar o script.

**O que é:** rotina de backup do schema de leads (e do resto) enquanto no plano **Free** do
Supabase (que não garante PITR/backup gerenciado).

**Por que está travado:** é operação/infra, não código do dashboard. Só vale a pena quando o
dashboard virar **dependência diária** (perder dado passa a doer).

**Gatilho:** o dashboard sair do "Em breve" e entrar no uso real do time.

**Passos (opções):**
1. **Curto prazo (Free):** `pg_dump` agendado (Make/cron externo) → storage (ex.: Cloudflare R2),
   com retenção. Barato, cobre o essencial.
2. **Quando virar crítico:** migrar para **Supabase Pro** (backup diário gerenciado + PITR) —
   decisão de custo do dono.

**Aceite:** existe um backup recuperável recente do domínio de leads; procedimento de restore
testado uma vez.

### S5.3 — Ponte com o discador (cruzar desempenho)

> **Estado (07/jul): DADOS 100% PRONTOS, código NÃO iniciado de propósito.** Verificação live:
> os **8/8 agentes** têm `email` **e** `profile_id` já mapeado → o backfill (que era o passo 1)
> **já está feito**. Mas construir o cruzamento **cruza os domínios**, o que é a regra travada
> "só sob pedido explícito" — então deixei **desenhado e pronto para executar**, sem escrever a
> query cross-domain sem o "vai" do dono. É o passo mais barato dos três quando ele pedir.

**O que é:** cruzar "desempenho no discador" × "desempenho no funil de leads" por agente.

**Por que está travado:** **decisão travada do dono** — os domínios ficam isolados por ora
("discadora é discadora; dashboard de leads é outra"). A ponte é `lead_agents.profile_id` (já
100% mapeado).

**Gatilho:** o dono **pedir explicitamente** o cruzamento. **Não é agora.**

**Plano de execução (quando o dono pedir "vai"):**
1. ~~Backfill de `profile_id`~~ — **já feito** (8/8).
2. **Action `getAgentBridge(period)`** (nova, em `actions/leads.ts` ou num módulo próprio):
   junta, POR AGENTE, o agregado do funil (reusa a lógica de `getLeadsData`/`v_agent_kpis`) com
   o agregado do discador (call_logs por `agent_id` = `profiles.id`, via `lead_agents.profile_id`).
   Cruzar **só na dimensão de pessoa** — nunca reconciliar lead × contato/ligação. Chave:
   `lead_agents.profile_id ↔ profiles.id ↔ call_logs.agent_id`.
3. **RLS/escopo:** manager+ (é visão gerencial comparativa). Fail-closed p/ agente comum.
4. **UI:** tabela comparativa (ligações feitas/atendidas × leads recebidos/convertidos por
   agente) — provavelmente **no dashboard do discador ou numa aba nova**, fora do fluxo de
   `/leads`, para não borrar o isolamento dos domínios na navegação.
5. **Cuidado travado:** manter as duas bases de fato separadas; a única cola é o agregado por
   `profile_id`. Nada de FK nova entre `leads` e `call_logs`.

**Aceite:** dá para ver, por agente, o lado discador e o lado funil lado a lado, sem misturar as
bases de fato.

> **Ordem sugerida daqui:** S5.1 (canal) já está no código — só observar o preenchimento subir e
> tirar a guarda de "incompleto" quando estabilizar. Depois: S5.2 (agendar o backup) assim que o
> time depender do dashboard, e S5.3 (ponte) só sob pedido explícito.

---

## Riscos & dados sujos (reavaliados com dado vivo)

| Risco | Impacto | Mitigação / estado |
|---|---|---|
| Canal (`capta_o_do_lead`) parcial | métricas de canal só confiáveis p/ leads novos | **destravando**: leads recentes já vêm "Meta ADS - …". Bloquear na UI só onde ainda faltar (S5) |
| Leads com 2+ responsáveis (**~15**, não 137) | distorce ranking | responsável = último do `respons_vel` + lista de alerta (feito em S0; exibir em S3) |
| Plano Free sem backup | perda de dado | backup manual agendado (S5) |
| ~16% finalizados | conversão em base aberta | deixar explícito "em aberto vs finalizado" nas métricas |
| Catálogo *stale* (24 agentes/137 dup) | expectativa errada | **realidade: 8 agentes, 15 dup, ~4.247 leads** — o time é menor que o doc de 02/jul sugeria |

## Decisões travadas no S1 (jul/2026)

- **Rótulo/ícone da aba:** **"Leads"** com ícone `Target` (não "Funil" — a seção é mais que o gráfico de funil). Visível a **todos** os papéis (o agente tem a autoavaliação; o RLS isola o dado).
- **Período:** o ciclo de meta é **11→10** (não o mês civil; ex.: 11/jun–10/jul). Default = ciclo corrente; **seletor de período livre** (ciclos recentes ou range custom) — o dono quer filtro de período em **todo** dashboard de métrica, então o `PeriodPicker` já saiu reutilizável. Recorte agregando `v_lead_progress` na action (`created_at` no período), **sem tocar no banco**; vira RPC parametrizado se o volume por ciclo crescer.
- **"Lead parado":** NÃO é limite global — é **SLA por fase** (fechado no **S2**). Modelo: `sla_hours` (numeric) por fase em `lead_phases`, prazo contado do **recebimento** (`created_at`, não `updated_at`); `is_stuck` na `v_lead_progress`. Exclui mortos/ganhos. Ver detalhe na seção S2. (O `stuck_leads` 48h da `v_agent_kpis` fica legado.)
- **Ciclo × retroativo (S2):** a fila de abertos/parados é estado atual (não recortada por período), mas cada lead é etiquetado `ciclo`/`retroativo` — o dono quer ver o total e quanto é arrastado de ciclos anteriores.
- **Banco/egress:** não aplicar migration nem rodar nada no banco sem o dono pedir; o front só lê views agregadas / `v_lead_progress` recortada, nunca tabelas brutas.

## Decisões ainda abertas

- SLA por fase: valores definidos no S2; os dois ⚠ (Recebidos 3 min, 1° Acionamento D+0) são aproximações que o dono pode ajustar no `UPDATE` da migration.
- Confirmar a assunção "responsável mais recente = último de `respons_vel`".
