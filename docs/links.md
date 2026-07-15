# Documentação — Blue Line

Organização por **domínio** e, dentro dele, por tipo. O README do projeto fica na raiz (`../README.md`).

Dois domínios, propositalmente **não misturados**:
- **Discador** — softphone, campanhas, integração MicroSIP (pastas `reference/`, `updates/`, `fixes/` abaixo).
- **Dashboard de Leads** — fluxo de leads do Pipefy, silo próprio em [`docs_dashboard_pipefy/`](docs_dashboard_pipefy/README.md).

---

# Discador

## `reference/` — base e fonte de verdade
- [`arquitetura-e-proximos-passos.md`](reference/arquitetura-e-proximos-passos.md) — arquitetura, decisões e histórico (fonte de verdade)
- [`discadora-microsip-integracao.md`](reference/discadora-microsip-integracao.md) — integração discador ↔ softphone utilizado (comandos, eventos, hooks)
- [`perguntas-intelbras-widevoice.md`](reference/perguntas-intelbras-widevoice.md) — o que pedir ao suporte Intelbras (AMD/caixa postal, limites, API, WebRTC…)
- [`plan.md`](reference/plan.md) — planejamento inicial

## `updates/` — features e mudanças de arquitetura
- [`discagem-paralela-preditiva.md`](updates/discagem-paralela-preditiva.md) — discagem paralela/preditiva (estudo + testes + implementação)
- [`discagem-em-background-dialer-engine.md`](updates/discagem-em-background-dialer-engine.md) — **design** para discar fora da tela do discador (DialerEngine) · *não implementado*
- [`discadora-status-historico-arquivamento.md`](updates/discadora-status-historico-arquivamento.md) — status de campanha calculado, arquivamento reversível e histórico de chamadas com filtro de período (agente + supervisor)

## `fixes/` — correções de bugs
- [`correcao-cpu-cloudflare-1102.md`](fixes/correcao-cpu-cloudflare-1102.md) — Cloudflare Error 1102 (estouro de CPU): agregar no Postgres (views security_invoker) em vez de puxar tabelas inteiras e agregar no Worker
- [`correcao-truncamento-1000-linhas.md`](fixes/correcao-truncamento-1000-linhas.md) — contagens travando em 1000 (teto Max Rows do Supabase): dashboard de leads via RPC `get_leads_dashboard` + `fetchAllRows` paginado; inclui dedup de campanha e saneamento de período. **Aviso: consolidado é destrutivo.**
- [`correcoes-producao-2026-06.md`](fixes/correcoes-producao-2026-06.md) — lote de produção jun/2026 (#1 tabulação, #2 fuso, #4 mute, #5 dashboard do agente; #3 pendente)
- [`correcoes-discadora-sprints.md`](fixes/correcoes-discadora-sprints.md) — 1ª leva de correções da discadora (sprints)

---

# Dashboard de Leads (Pipefy)

Domínio separado do discador. Índice completo em [`docs_dashboard_pipefy/README.md`](docs_dashboard_pipefy/README.md).

- [`docs_dashboard_pipefy/sprints-dashboard-leads.md`](docs_dashboard_pipefy/sprints-dashboard-leads.md) — **roadmap** em sprints (S0→S5) + decisões travadas
- [`docs_dashboard_pipefy/stack-tecnica-dashboard-leads.md`](docs_dashboard_pipefy/stack-tecnica-dashboard-leads.md) — stack (Pipefy → Make → Supabase)
- [`docs_dashboard_pipefy/catalogo-metricas-dashboard-leads (1).md`](docs_dashboard_pipefy/catalogo-metricas-dashboard-leads%20(1).md) — catálogo de métricas
- [`docs_dashboard_pipefy/panoramavisual.md`](docs_dashboard_pipefy/panoramavisual.md) — análise da proposta visual
