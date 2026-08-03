# Documentação — Blue Desk

Índice mestre da documentação. **Organização por projeto:** cada projeto tem sua própria pasta
`<projeto>-docs/`, e dentro dela o espelho **`reference/`** (base/fonte de verdade), **`updates/`**
(features e mudanças de arquitetura) e **`fixes/`** (correções). Subpastas vazias existem só para
manter o padrão. O README do projeto fica na raiz do repo (`../README.md`).

| Projeto | Pasta | Índice próprio |
|---|---|---|
| Discador | `discadora-docs/` | — (ver `reference/arquitetura-e-proximos-passos.md`) |
| Dashboard de Leads (Comercial) | `painelleads-docs/` | [`updates/dashboard-leads-indice.md`](painelleads-docs/updates/dashboard-leads-indice.md) |
| Painel de Sucesso do Cliente (CS) | `painelcs-docs/` | [`updates/dashboard-cs-indice.md`](painelcs-docs/updates/dashboard-cs-indice.md) |
| Aquecimento WhatsApp | `warmup-docs/` | [`updates/aquecimento-whatsapp-indice.md`](warmup-docs/updates/aquecimento-whatsapp-indice.md) |
| Projetos (Desenvolvimento / TI) | `projetos-docs/` | [`updates/projetos-blue-desk.md`](projetos-docs/updates/projetos-blue-desk.md) |
| Minutas Processuais (Jurídico) | `minutas-docs/` | [`updates/painel-minutas-processuais.md`](minutas-docs/updates/painel-minutas-processuais.md) |
| RBAC / Acessos (transversal) | `rbac-docs/` | [`updates/acessos-e-papel-tester.md`](rbac-docs/updates/acessos-e-papel-tester.md) |
| Painel do CEO (executivo) | `projetopainelceo-docs/` | [`updates/painel-ceo-indice.md`](projetopainelceo-docs/updates/painel-ceo-indice.md) |

Os cinco primeiros são **domínios de produto separados** (código, dados e RLS isolados entre si);
só a documentação vive junta aqui, por projeto. O **Painel do CEO** é diferente: uma **camada de
leitura/agregação** por cima das verticais isoladas (não tem schema próprio — compõe os dados dos
outros domínios), com trava por um papel novo `ceo`.

---

# Discador · `discadora-docs/`

## `reference/` — base e fonte de verdade
- [`arquitetura-e-proximos-passos.md`](discadora-docs/reference/arquitetura-e-proximos-passos.md) — arquitetura, decisões e histórico (fonte de verdade)
- [`discadora-microsip-integracao.md`](discadora-docs/reference/discadora-microsip-integracao.md) — integração discador ↔ softphone utilizado (comandos, eventos, hooks)
- [`perguntas-intelbras-widevoice.md`](discadora-docs/reference/perguntas-intelbras-widevoice.md) — o que pedir ao suporte Intelbras (AMD/caixa postal, limites, API, WebRTC…)
- [`plan.md`](discadora-docs/reference/plan.md) — planejamento inicial

## `updates/` — features e mudanças de arquitetura
- [`discagem-paralela-preditiva.md`](discadora-docs/updates/discagem-paralela-preditiva.md) — discagem paralela/preditiva (estudo + testes + implementação)
- [`discagem-em-background-dialer-engine.md`](discadora-docs/updates/discagem-em-background-dialer-engine.md) — **design** para discar fora da tela do discador (DialerEngine) · *não implementado*
- [`discadora-status-historico-arquivamento.md`](discadora-docs/updates/discadora-status-historico-arquivamento.md) — status de campanha calculado, arquivamento reversível e histórico de chamadas com filtro de período
- [`stack-blueprint-novo-projeto.md`](discadora-docs/updates/stack-blueprint-novo-projeto.md) — blueprint portátil para iniciar um novo app na mesma stack (base do módulo Projetos/Monday)

## `fixes/` — correções de bugs
- [`correcao-cpu-cloudflare-1102.md`](discadora-docs/fixes/correcao-cpu-cloudflare-1102.md) — Cloudflare Error 1102 (estouro de CPU): agregar no Postgres (views security_invoker) em vez de puxar tabelas inteiras no Worker
- [`correcoes-producao-2026-06.md`](discadora-docs/fixes/correcoes-producao-2026-06.md) — lote de produção jun/2026 (#1 tabulação, #2 fuso, #4 mute, #5 dashboard do agente; #3 pendente)
- [`correcoes-discadora-sprints.md`](discadora-docs/fixes/correcoes-discadora-sprints.md) — 1ª leva de correções da discadora (sprints)
- [`correcao-truncamento-1000-linhas.md`](discadora-docs/fixes/correcao-truncamento-1000-linhas.md) — contagens travando em 1000 (teto Max Rows do Supabase); **cross-projeto**: RPC `get_leads_dashboard` (Leads) + dedup de campanha (discador). **Aviso: consolidado é destrutivo.**

---

# Dashboard de Leads (Pipefy) · `painelleads-docs/`

Domínio de produto separado do discador (código/dados/RLS). Índice completo em
[`updates/dashboard-leads-indice.md`](painelleads-docs/updates/dashboard-leads-indice.md).

## `updates/`
- [`dashboard-leads-indice.md`](painelleads-docs/updates/dashboard-leads-indice.md) — índice/estado do painel de Leads
- [`novo-visual-dashleads.md`](painelleads-docs/updates/novo-visual-dashleads.md) — roadmap do novo visual em sprints (topbar de abas, séries temporais, funil aprofundado) + correções de contabilização
- [`sprints-dashboard-leads.md`](painelleads-docs/updates/sprints-dashboard-leads.md) — **roadmap** original em sprints (S0→S5) + decisões travadas
- [`stack-tecnica-dashboard-leads.md`](painelleads-docs/updates/stack-tecnica-dashboard-leads.md) — stack (Pipefy → Make → Supabase)
- [`catalogo-metricas-dashboard-leads (1).md`](painelleads-docs/updates/catalogo-metricas-dashboard-leads%20(1).md) — catálogo de métricas
- [`panoramavisual.md`](painelleads-docs/updates/panoramavisual.md) — análise da proposta visual
- [`make-integracao-pipefy.md`](painelleads-docs/updates/make-integracao-pipefy.md) — cenário Pipefy → Make → Supabase

## `fixes/`
- [`correcao-ganhos-retroativos-e-funil-geral.md`](painelleads-docs/fixes/correcao-ganhos-retroativos-e-funil-geral.md) — ganhos/mortos passam a contar por data de venda (`finalized_at`), não `created_at`, com split ciclo × retroativo; funil "geral" novo (por `updated_at`). **Migrations não aplicadas ainda.**
- [`correcao-acionamento-por-entrada-de-fase.md`](painelleads-docs/fixes/correcao-acionamento-por-entrada-de-fase.md) — acionamento passa a contar por **entrada real de fase** (via `lead_events` + `LAG`), não por `updated_at` nem `max_funnel_order` cumulativo: pulo de fase não preenche etapas e editar campo não conta como acionado. **Migration 20260731 aplicada** (31/jul; substituiu a 20260723c).
- Cross-projeto: o **truncamento em 1000** (RPC `get_leads_dashboard`) mora em [`discadora-docs/fixes/correcao-truncamento-1000-linhas.md`](discadora-docs/fixes/correcao-truncamento-1000-linhas.md).

---

# Painel de Sucesso do Cliente (CS) (Pipefy) · `painelcs-docs/`

Domínio de produto separado do discador **e** do dashboard de Leads (código/dados/RLS).
Índice completo em [`updates/dashboard-cs-indice.md`](painelcs-docs/updates/dashboard-cs-indice.md).

## `updates/`
- [`dashboard-cs-indice.md`](painelcs-docs/updates/dashboard-cs-indice.md) — índice/estado do painel de CS
- [`painel-sucesso-cliente-cs.md`](painelcs-docs/updates/painel-sucesso-cliente-cs.md) — roadmap em sprints + todas as decisões travadas
- [`make-integracao-cs.md`](painelcs-docs/updates/make-integracao-cs.md) — cenário Pipefy → Make → Supabase (pipe `305801110`)
- [`cs-proximos-passos.md`](painelcs-docs/updates/cs-proximos-passos.md) — estado/handoff das páginas 2/3/4 + pendências
- [`cs-pagina1-alternativas-viz.txt`](painelcs-docs/updates/cs-pagina1-alternativas-viz.txt) — notas de alternativas de visualização da Página 1

## `fixes/`
- [`correcao-data-quitacao-ddmmyyyy.md`](painelcs-docs/fixes/correcao-data-quitacao-ddmmyyyy.md) — vencimento da minuta trocava dia/mês: `data_da_quita_o` vem em `DD/MM/YYYY` (não ISO) e o `::date` castava em MDY. `cs_parse_date` passa a converter pt-BR explícito (migration `20260730`, **pendente de aplicar**).

---

# Aquecimento WhatsApp · `warmup-docs/`

Módulo de **infra** separado (código/dados/RLS próprios, prefixo `warmup_`) — não é uma
vertical de departamento. Índice completo em
[`updates/aquecimento-whatsapp-indice.md`](warmup-docs/updates/aquecimento-whatsapp-indice.md).

## `updates/`
- [`aquecimento-whatsapp-indice.md`](warmup-docs/updates/aquecimento-whatsapp-indice.md) — índice/estado do Warmup
- [`aquecimento-whatsapp.md`](warmup-docs/updates/aquecimento-whatsapp.md) — roadmap em sprints + todas as decisões travadas
- [`make-integracao-aquecimento.md`](warmup-docs/updates/make-integracao-aquecimento.md) — cenários Blue Desk → Make → Meta (Graph API), System User único da BM

---

# Projetos (Desenvolvimento / TI) · `projetos-docs/`

Módulo de tarefas/sprints estilo Monday, integrado ao Blue Desk (tabelas `monday_*`, RLS por
membership, só `manager`/`admin`).

## `updates/`
- [`projetos-blue-desk.md`](projetos-docs/updates/projetos-blue-desk.md) — módulo, acesso/RLS
  (gerência vê tudo + membros), board/tarefas/comentários, pastas por pessoa, Daily e as
  migrations pendentes (`20260723d`, `20260727_gerencia_access`, `20260727b_task_comments`).
- [`notificacoes-mencoes.md`](projetos-docs/updates/notificacoes-mencoes.md) — sino global de
  notificações in-app + @menções nos comentários (card + som + notificação do SO em tempo real);
  migration pendente `20260728_notifications.sql`.
- [`editar-apagar-sprint-e-formatacao.md`](projetos-docs/updates/editar-apagar-sprint-e-formatacao.md) —
  botões de editar/apagar sprint no card (apagar devolve tarefas ao backlog) + render `RichText`
  (tópicos/numeração/negrito/quebras) nas descrições de tarefa e objetivos de sprint. **Sem migration.**

---

# Minutas Processuais (Jurídico) · `minutas-docs/`

Área nova do Blue Desk (rota `/minutas`), departamento **Jurídico** — controle de minutas
processuais (obrigações de pagamento por processo, com parcelas recorrentes). **App-native/CRUD**
(tabelas `proc_*`, RLS por departamento), não espelho de pipe. **Domínio SEPARADO das "Minutas" do
CS** (aba dentro de `/cs`, tabelas `cs_*`) — não confundir.

## `updates/`
- [`painel-minutas-processuais.md`](minutas-docs/updates/painel-minutas-processuais.md) — a área,
  modelo de dados (`proc_acordos` + `proc_parcelas`), acesso/RLS, as 3 abas (Visão Geral /
  Calendário / Minutas) e o script de carga da planilha (CSV/xlsx). Migration
  `20260731b_minutas_processuais.sql` **aplicada** + carga rodada (23 acordos / 87 parcelas, 03/ago).

---

# RBAC / Acessos (transversal) · `rbac-docs/`

Controle de acesso do Blue Desk: escopo por departamento em toda a navegação (cada supervisor só a
própria equipe; Discador exclusivo do Comercial) + papel novo `tester` (acesso total + seletor "ver
como"). Transversal — toca Sidebar, middleware, store e os gates de página.

## `updates/`
- [`acessos-e-papel-tester.md`](rbac-docs/updates/acessos-e-papel-tester.md) — matriz de acesso, o
  papel `tester` e como está implementado (Sidebar/middleware/store). Migration
  `20260803_tester_role.sql` **aplicada** (03/ago). Pendente: escopo de DADOS por departamento no
  Painel da Discadora/Campanhas.

---

# Painel do CEO (executivo) · `projetopainelceo-docs/`

Visão executiva do Blue Desk — **camada de leitura/agregação** por cima das verticais isoladas
(Financeiro, CS, Negociação, Leads, Monday/Projetos, Discador): compõe os dados dos outros
domínios em RPCs/actions, **sem fundir os schemas**. Trava por um papel novo `ceo`. Índice
completo em [`updates/painel-ceo-indice.md`](projetopainelceo-docs/updates/painel-ceo-indice.md).

> Exceção à regra de "sem schema próprio": o **Financeiro** (Sprint 1) era um pipe **não
> integrado**, então o painel trouxe a vertical inteira (`fin_cards`/`fin_entries` +
> `ingest_financeiro_card`), como o CS fez com o dele. O que continua valendo é que o painel
> **não funde** os schemas dos domínios — ele compõe por RPC de leitura.

## `updates/`
- [`painel-ceo-indice.md`](projetopainelceo-docs/updates/painel-ceo-indice.md) — índice/estado do painel do CEO
- [`painel-ceo-sprints.md`](projetopainelceo-docs/updates/painel-ceo-sprints.md) — roadmap em sprints (S0→S4: Fundação/trava · Financeiro · Projeções · Saúde da Empresa · Saúde da Equipe) + decisões travadas
- [`introspeccao-pipefy-financeiro.md`](projetopainelceo-docs/updates/introspeccao-pipefy-financeiro.md) — mapeamento do pipe Financeiro (field-ids, parsers, achados) + as queries de introspecção reutilizáveis
- [`make-integracao-financeiro.md`](projetopainelceo-docs/updates/make-integracao-financeiro.md) — cenário Pipefy → Make → Supabase do Financeiro
