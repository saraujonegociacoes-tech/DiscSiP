# Documentação — Blue Line

Organização por **domínio** e, dentro dele, por tipo. O README do projeto fica na raiz (`../README.md`).

Três domínios de **produto** (código, dados, RLS continuam isolados entre eles) — mas a
**documentação** de todos vive fisicamente junto em `reference/`, `updates/` e `fixes/`
(sem pastas-silo separadas por domínio): a discadora deixa de ser só "discadora" e está
virando o **Sistema da Araújo**; os painéis de Leads e de CS são os primeiros passos dessa
expansão, por isso a doc já é tratada como um corpo só. Este índice organiza por domínio
mesmo assim, pra continuar fácil de achar o que é de quem:
- **Discador** — softphone, campanhas, integração MicroSIP.
- **Dashboard de Leads** (comercial) — fluxo de leads do Pipefy. Índice próprio:
  [`updates/dashboard-leads-indice.md`](updates/dashboard-leads-indice.md).
- **Painel de Sucesso do Cliente** (CS) — outro pipe do Pipefy, outro departamento. Índice
  próprio: [`updates/dashboard-cs-indice.md`](updates/dashboard-cs-indice.md).
- **Aquecimento WhatsApp** — módulo de infra (não é uma vertical de departamento): números
  novos conversam entre si para construir reputação antes das campanhas. Índice próprio:
  [`updates/aquecimento-whatsapp-indice.md`](updates/aquecimento-whatsapp-indice.md).

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
- [`correcoes-producao-2026-06.md`](fixes/correcoes-producao-2026-06.md) — lote de produção jun/2026 (#1 tabulação, #2 fuso, #4 mute, #5 dashboard do agente; #3 pendente)
- [`correcoes-discadora-sprints.md`](fixes/correcoes-discadora-sprints.md) — 1ª leva de correções da discadora (sprints)
- [`correcao-truncamento-1000-linhas.md`](fixes/correcao-truncamento-1000-linhas.md) — contagens travando em 1000 (teto Max Rows do Supabase); cross-domain: RPC `get_leads_dashboard` (dashboard de Leads) + dedup de campanha (discador). **Aviso: consolidado é destrutivo.**

---

# Dashboard de Leads (Pipefy)

Domínio de produto separado do discador (código/dados/RLS). Índice completo em
[`updates/dashboard-leads-indice.md`](updates/dashboard-leads-indice.md).

- [`updates/novo-visual-dashleads.md`](updates/novo-visual-dashleads.md) — roadmap do novo visual em sprints (topbar de abas, séries temporais, funil aprofundado) + correções de contabilização
- [`updates/sprints-dashboard-leads.md`](updates/sprints-dashboard-leads.md) — **roadmap** original em sprints (S0→S5) + decisões travadas
- [`updates/stack-tecnica-dashboard-leads.md`](updates/stack-tecnica-dashboard-leads.md) — stack (Pipefy → Make → Supabase)
- [`updates/catalogo-metricas-dashboard-leads (1).md`](updates/catalogo-metricas-dashboard-leads%20(1).md) — catálogo de métricas
- [`updates/panoramavisual.md`](updates/panoramavisual.md) — análise da proposta visual
- [`updates/make-integracao-pipefy.md`](updates/make-integracao-pipefy.md) — cenário Pipefy → Make → Supabase
- [`fixes/correcao-truncamento-1000-linhas.md`](fixes/correcao-truncamento-1000-linhas.md) — ver Discador acima (cross-domain)
- [`fixes/correcao-ganhos-retroativos-e-funil-geral.md`](fixes/correcao-ganhos-retroativos-e-funil-geral.md) — ganhos/mortos passam a contar por data de venda (`finalized_at`), não `created_at`, com split ciclo × retroativo; funil "geral" novo (por `updated_at`). **Migrations não aplicadas ainda.**

---

# Painel de Sucesso do Cliente (CS) (Pipefy)

Domínio de produto separado do discador **e** do dashboard de Leads (código/dados/RLS).
Índice completo em [`updates/dashboard-cs-indice.md`](updates/dashboard-cs-indice.md).

- [`updates/painel-sucesso-cliente-cs.md`](updates/painel-sucesso-cliente-cs.md) — roadmap em sprints + todas as decisões travadas
- [`updates/make-integracao-cs.md`](updates/make-integracao-cs.md) — cenário Pipefy → Make → Supabase (pipe `305801110`)

---

# Aquecimento WhatsApp

Módulo de **infra** separado (código/dados/RLS próprios, prefixo `warmup_`) — não é uma
vertical de departamento. Índice completo em
[`updates/aquecimento-whatsapp-indice.md`](updates/aquecimento-whatsapp-indice.md).

- [`updates/aquecimento-whatsapp.md`](updates/aquecimento-whatsapp.md) — roadmap em sprints + todas as decisões travadas
- [`updates/make-integracao-aquecimento.md`](updates/make-integracao-aquecimento.md) — cenários Blue Line → Make → Meta (Graph API), System User único da BM
