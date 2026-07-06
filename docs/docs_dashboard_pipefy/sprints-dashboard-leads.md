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

**S3 FEITO** (visão do supervisor) — jul/2026, **não deployado**; `tsc` + `eslint` verdes. `next build` local **não valida** aqui (erro de ambiente: `EPERM` em `.next/trace` + `EISDIR` num `route.ts` do discador — nada a ver com o código de leads; o deploy real é via OpenNext/Cloudflare, outra pipeline). Entregue: ranking comparativo **ordenável** + coluna "parados agora", gráfico "onde o lead morre", alerta de responsabilidade duplicada (definitivo) e alerta de "leads sem acionamento". Detalhes na seção **S3**.

**S4 INICIADO** — scaffolding de **Realtime** pronto e **desligado por padrão** (opt-in por env + publicação Postgres). A tela já sabe se re-buscar sozinha quando ligado. Detalhes na seção **S4**.

**Furos conhecidos:** provar o RLS do agente (mapear um `lead_agents.profile_id`) — enquanto isso o **agente logado vê a tela vazia** (o RLS não acha os leads dele); supervisor+ vê tudo. Confirmar a assunção "mais recente = último de `respons_vel`".

**Próximo: concluir S4** (ligar o Realtime — env + publicação; polimento visual/animações medidas) e depois **S5** (canal/backup/ponte com o discador).

---

## Princípios travados

Decisões já fechadas com o dono do produto (não reabrir sem motivo):

1. **Seção própria, mesmo app.** O dashboard de leads é uma seção independente (`/leads`), acessível pelo mesmo login/deploy da Blue Line — **não** é um app à parte, e **não** se mistura com o dashboard do discador (`/dashboard`). "Discadora é discadora; dashboard de leads é outra."
2. **Reusar a stack da Blue Line, descartar Vite/Pages.** O _plano de dados_ do doc de stack (Pipefy → Make → Supabase, com RLS + Realtime + Views) é 100% aproveitado. A _casca_ proposta (React + Vite no Cloudflare Pages) é descartada em favor de uma **rota nativa do Next**, reusando Recharts, Radix, Tailwind, os clientes Supabase e o RBAC que já existem.
3. **Isolamento de dados agora, ponte pronta pra depois.** Os leads vivem em tabelas próprias, **sem** reconciliar com os `profiles` do discador. A dimensão de agente do Pipefy carrega uma coluna `profile_id` _nullable_ e vazia por ora — no dia em que cruzar "desempenho no discador × no funil" for desejado, vira _backfill_, não remigração. Não é agora.
4. **Design system existente, não "Midnight Indigo".** A seção usa o tema _theme-aware_ que já existe (`theme.tsx`, `useChartTheme.ts`, `KpiCard`), não a paleta dark/glow proposta — para não virar uma ilha visualmente estrangeira. (Coerente com a própria ressalva do `panoramavisual.md`.)
5. **Duas visões via papéis existentes.** "Agente" (autoavaliação) e "Supervisor" (gerencial/ranking) mapeiam nos papéis `agent/supervisor/manager/admin` que o RBAC já tem. O escopo por agente é garantido no banco (RLS), não no frontend.

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
| **S4** 🔄 | Tempo real, polimento e performance — **INICIADO** | S2, S3 |
| **S5** | Pós-MVP: métricas bloqueadas, backup e ponte com o discador | S4 |

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
- **`page.tsx` / `LeadsClient`** — para supervisor+: card "Parados" agora vem de `teamStuck`; novos painéis (DeathByAttempt + ForgottenLeads lado a lado, ranking, duplicados); a troca de período re-busca `getLeadsData` + `getSupervisorMetrics` (o split ciclo × retroativo dos parados é reancorado ao período).

**Nota de arquitetura (parados agora):** a leitura `is_stuck = true` varre a base aberta inteira (~3.3k linhas × 3 colunas) numa agregação só. Se o egress pesar, vira uma view `v_agent_stuck` / RPC parametrizado — **decisão adiada** (sem tocar no banco por ora). O ranking é por período; um agente com parados só retroativos e zero leads no período não aparece na tabela (mas entra no `teamStuck`).

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

**Iniciado (06/jul/2026)** — scaffolding de Realtime pronto, `tsc` + `eslint` verdes.
- **Hook `useLeadsRealtime`** ([`../../src/features/leads/useLeadsRealtime.ts`](../../src/features/leads/useLeadsRealtime.ts)): assina `postgres_changes` em `public.leads` e dispara um **refetch silencioso** (debounce 1,5 s) do período corrente. O `LeadsClient` já usa (função `refresh`); há um selo **"Ao vivo"** no header quando ligado. O RLS vale para o Realtime (agente só recebe o próprio; supervisor+ tudo), e por ser client-side **não passa pelo worker** (não gasta egress do SSR).
- **Desligado por padrão** (nem abre socket). Para **ligar**, o dono faz DOIS passos:
  1. **Env:** `NEXT_PUBLIC_LEADS_REALTIME=1` (no `.env.local` / no ambiente do deploy).
  2. **Banco (uma vez, SQL Editor):** `ALTER PUBLICATION supabase_realtime ADD TABLE public.leads;` (sem isso o socket conecta mas nunca recebe evento — não quebra nada, só não atualiza sozinho).
- **Egress:** confirmado — o front só lê views agregadas / `v_lead_progress` recortada, nunca tabelas brutas (regra travada mantida no S3).

**Ainda falta no S4:** animações medidas (count-up sóbrio nos KPIs, destaque só para "venda", som opt-in); passada final de responsividade/empty-error; e o dono ligar o Realtime (env + publicação) para bater o critério "sem refresh manual".

---

## S5 — Pós-MVP (só quando virar rotina)

**Objetivo:** destravar o que depende de dado/processo externo e blindar a operação.

**Escopo / entregáveis**
- **Métricas de canal:** destravam quando `Captação do Lead` / `canal_origem` virar obrigatório no Pipefy (hoje 0,5% preenchido). Até lá, ficam marcadas como bloqueadas na UI.
- **Backup:** rotina `pg_dump` agendada (Make → storage externo, ex. Cloudflare R2) enquanto no Free; migrar Supabase Pro quando o dashboard virar dependência diária.
- **Ponte com o discador:** _backfill_ de `lead_agents.profile_id` para cruzar desempenho discador × funil. **Só quando explicitamente pedido** — não é agora.

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
