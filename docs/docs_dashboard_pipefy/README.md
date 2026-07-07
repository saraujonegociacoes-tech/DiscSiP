# Dashboard de fluxo de leads (Pipefy)

Silo de documentação do **dashboard de leads** — domínio **separado** do discador.
Nada aqui se mistura com as docs da discadora (essas ficam em [`../reference`](../reference), [`../updates`](../updates), [`../fixes`](../fixes)).

> **Estado (07/jul/2026): S0–S4 FEITOS; S5 em andamento.** S0 no ar (schema `../../supabase/manual/leads_dashboard_setup.sql`, ~4.3k leads, Make 24/7; **8 agentes, 15 duplicados** — o catálogo de 02/jul está *stale*: 24/137). **S1** (casca), **S2** (agente + "lead parado" por SLA), **S3** (supervisor: ranking ordenável + "parados agora" via RPC, "onde o lead morre", alertas, **leads sem responsável/órfãos**) e **S4** (Realtime, count-up, a11y) implementados; `tsc`/`eslint` verdes. **Deployado atrás de tela "Em breve"**. **Todas as migrations aplicadas e verificadas live** (SLA, `get_agent_stuck`, `20260707` **RLS do supervisor por depto + órfãos**; `profile_id` 8/8; **Realtime LIGADO e publicação confirmada**). **RBAC** agora segue o discador: agente=o seu · supervisor=seu depto+órfãos · manager/admin=tudo. **S5:** S5.1 canal **FEITO no código** (campo obrigatório no Pipefy → painel + guarda de "dado incompleto"); S5.2 backup **com scaffold** (`npm run backup:leads`); S5.3 ponte **desenhada, dados prontos** (só sob pedido). **Falta só:** commit/deploy + envs de prod (em andamento). Detalhes no roadmap.

## Referência (o quê e por quê)
- [`stack-tecnica-dashboard-leads.md`](stack-tecnica-dashboard-leads.md) — stack e o que cada peça supre (Pipefy → Make → Supabase)
- [`catalogo-metricas-dashboard-leads (1).md`](catalogo-metricas-dashboard-leads%20(1).md) — catálogo de métricas (relatório real de 4.212 leads)
- [`panoramavisual.md`](panoramavisual.md) — análise da proposta visual

## Roadmap (como construir)
- [`sprints-dashboard-leads.md`](sprints-dashboard-leads.md) — plano de execução em sprints (S0→S5) + decisões travadas + hierarquia-alvo

## Integração (o cenário do Make — montado e no ar)
- [`make-integracao-pipefy.md`](make-integracao-pipefy.md) — cenário Pipefy → Make → Supabase: schedule 24/7 → GraphQL delta → Transform to JSON → POST `rpc/ingest_lead_card(node)`. Módulos, query, mapa de campos e custo.

> Decisões travadas (resumo): seção própria em `/leads` no mesmo app; reusa a stack da Blue Line (Next + Recharts + Supabase + RBAC), descarta Vite/Pages; dados isolados do discador com ponte `profile_id` pronta pra depois; design system existente, não "Midnight Indigo". **Do S1:** aba **"Leads"** (ícone `Target`, todos os papéis); período = **ciclo de meta 11→10** com seletor livre; **"lead parado" = SLA por fase** (não limite global — vai pro S2, dono passa as horas → `sla_hours`); nada no banco sem ordem do dono. Detalhes no roadmap.
