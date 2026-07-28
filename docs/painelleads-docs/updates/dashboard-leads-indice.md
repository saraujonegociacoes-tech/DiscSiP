# Dashboard de fluxo de leads (Pipefy)

Índice da documentação do **dashboard de leads** (Pipefy comercial). O código e os dados
continuam em **domínio separado** do discador e do painel de CS (RLS, tabelas e RPCs
próprios — ver decisões travadas abaixo) — só a documentação foi consolidada numa pasta
só (`docs/updates/`), junto com a do discador e a do CS, porque os três já fazem parte do
mesmo sistema em construção (a discadora deixa de ser só "discadora" e vira o **Sistema
da Araújo**; este painel e o de CS são os primeiros passos). Ver também
[`dashboard-cs-indice.md`](../../painelcs-docs/updates/dashboard-cs-indice.md) (painel irmão) e
[`../links.md`](../../links.md) (índice geral por domínio).

> **Estado (07/jul/2026): ENTREGUE (update) — S0–S5 completos.** Dashboard de leads pronto e verificado live. S0 no ar (schema `../../supabase/manual/leads_dashboard_setup.sql`, ~4.3k leads, Make 24/7; **8 agentes, 15 duplicados** — o catálogo de 02/jul está *stale*: 24/137). **S1** (casca), **S2** (agente + "lead parado" por SLA), **S3** (supervisor: ranking ordenável + "parados agora" via RPC, "onde o lead morre", alertas, **leads sem responsável/órfãos**) e **S4** (Realtime, count-up, a11y) implementados; `tsc`/`eslint` verdes. **Todas as migrations aplicadas e verificadas live** (SLA, `get_agent_stuck`, `20260707` **RLS do supervisor por depto + órfãos** + `get_leads_dashboard`; `profile_id` 8/8; **Realtime LIGADO e publicação confirmada**). **RBAC** segue o discador: agente=o seu · supervisor=seu depto+órfãos · manager/admin=tudo. **S5 entregue:** S5.1 **canal** (painel + guarda de "dado incompleto"); S5.2 **backup lógico** (`npm run backup:leads`, com o Pipefy como fonte de verdade — recuperação por `npm run import:leads` **provada** em 07/jul); S5.3 **ponte discador×funil** desenhada e pronta **sob demanda** (dados 100% mapeados). **Correção do truncamento em 1000** entregue (RPC `get_leads_dashboard` — ver [`../fixes/correcao-truncamento-1000-linhas.md`](../../discadora-docs/fixes/correcao-truncamento-1000-linhas.md)). **Ganhos por data de venda + funil "geral"** (18/jul): código pronto, migrations aguardando aplicação — ver [`../fixes/correcao-ganhos-retroativos-e-funil-geral.md`](../fixes/correcao-ganhos-retroativos-e-funil-geral.md). **Publicação** controlada pela flag `NEXT_PUBLIC_LEADS_ENABLED` (lançar = ligar a env no Cloudflare). Detalhes no roadmap.

## Referência (o quê e por quê)
- [`stack-tecnica-dashboard-leads.md`](stack-tecnica-dashboard-leads.md) — stack e o que cada peça supre (Pipefy → Make → Supabase)
- [`catalogo-metricas-dashboard-leads (1).md`](catalogo-metricas-dashboard-leads%20(1).md) — catálogo de métricas (relatório real de 4.212 leads)
- [`panoramavisual.md`](panoramavisual.md) — análise da proposta visual

## Roadmap (como construir)
- [`sprints-dashboard-leads.md`](sprints-dashboard-leads.md) — plano de execução em sprints (S0→S5) + decisões travadas + hierarquia-alvo

## Integração (o cenário do Make — montado e no ar)
- [`make-integracao-pipefy.md`](make-integracao-pipefy.md) — cenário Pipefy → Make → Supabase: schedule 24/7 → GraphQL delta → Transform to JSON → POST `rpc/ingest_lead_card(node)`. Módulos, query, mapa de campos e custo.

> Decisões travadas (resumo): seção própria em `/leads` no mesmo app; reusa a stack da Blue Desk (Next + Recharts + Supabase + RBAC), descarta Vite/Pages; dados isolados do discador com ponte `profile_id` pronta pra depois; design system existente, não "Midnight Indigo". **Do S1:** aba **"Leads"** (ícone `Target`, todos os papéis); período = **ciclo de meta 11→10** com seletor livre; **"lead parado" = SLA por fase** (não limite global — vai pro S2, dono passa as horas → `sla_hours`); nada no banco sem ordem do dono. Detalhes no roadmap.
