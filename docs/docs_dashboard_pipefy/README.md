# Dashboard de fluxo de leads (Pipefy)

Silo de documentação do **dashboard de leads** — domínio **separado** do discador.
Nada aqui se mistura com as docs da discadora (essas ficam em [`../reference`](../reference), [`../updates`](../updates), [`../fixes`](../fixes)).

> **Estado (06/jul/2026): S0–S3 FEITOS; S4 INICIADO.** S0 no ar (schema `../../supabase/manual/leads_dashboard_setup.sql`, 4.247 leads, Make 24/7; números reais: **8 agentes, 15 duplicados, ~700 finalizados** — o catálogo de 02/jul está *stale*: 24/137). **S1** (casca `/leads`), **S2** (visão do agente + "lead parado" por SLA de fase) e **S3** (visão do supervisor: ranking ordenável + "parados agora", "onde o lead morre", alerta de duplicados, alerta de "leads sem acionamento") implementados; `tsc`/`eslint` verdes, **não deployado** (git/deploy é do dono). **S4 iniciado**: scaffolding de Realtime pronto e **desligado por padrão** (o dono liga por env + publicação Postgres). **Pendências do dono:** rodar a migration `20260706_leads_sla.sql`, mapear ≥1 `lead_agents.profile_id` (senão o agente vê tela vazia; supervisor já enxerga). Detalhes no roadmap.

## Referência (o quê e por quê)
- [`stack-tecnica-dashboard-leads.md`](stack-tecnica-dashboard-leads.md) — stack e o que cada peça supre (Pipefy → Make → Supabase)
- [`catalogo-metricas-dashboard-leads (1).md`](catalogo-metricas-dashboard-leads%20(1).md) — catálogo de métricas (relatório real de 4.212 leads)
- [`panoramavisual.md`](panoramavisual.md) — análise da proposta visual

## Roadmap (como construir)
- [`sprints-dashboard-leads.md`](sprints-dashboard-leads.md) — plano de execução em sprints (S0→S5) + decisões travadas + hierarquia-alvo

## Integração (o cenário do Make — montado e no ar)
- [`make-integracao-pipefy.md`](make-integracao-pipefy.md) — cenário Pipefy → Make → Supabase: schedule 24/7 → GraphQL delta → Transform to JSON → POST `rpc/ingest_lead_card(node)`. Módulos, query, mapa de campos e custo.

> Decisões travadas (resumo): seção própria em `/leads` no mesmo app; reusa a stack da Blue Line (Next + Recharts + Supabase + RBAC), descarta Vite/Pages; dados isolados do discador com ponte `profile_id` pronta pra depois; design system existente, não "Midnight Indigo". **Do S1:** aba **"Leads"** (ícone `Target`, todos os papéis); período = **ciclo de meta 11→10** com seletor livre; **"lead parado" = SLA por fase** (não limite global — vai pro S2, dono passa as horas → `sla_hours`); nada no banco sem ordem do dono. Detalhes no roadmap.
