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
| Central de Aparelhos (inventário, transversal) | `inventario-docs/` | [`updates/central-de-aparelhos.md`](inventario-docs/updates/central-de-aparelhos.md) |
| RBAC / Acessos (transversal) | `rbac-docs/` | [`updates/acessos-e-papel-tester.md`](rbac-docs/updates/acessos-e-papel-tester.md) |
| Painel do CEO (executivo) | `projetopainelceo-docs/` | [`updates/painel-ceo-indice.md`](projetopainelceo-docs/updates/painel-ceo-indice.md) |
| Performance / Bundle (transversal) | `performance-docs/` | [`updates/auditoria-performance-2026-08.md`](performance-docs/updates/auditoria-performance-2026-08.md) |

Os cinco primeiros são **domínios de produto separados** (código, dados e RLS isolados entre si);
só a documentação vive junta aqui, por projeto. O **Painel do CEO** é diferente: uma **camada de
leitura/agregação** por cima das verticais isoladas (não tem schema próprio — compõe os dados dos
outros domínios), com trava por um papel novo `ceo`.

---

# Discador · `discadora-docs/`

## `reference/` — base e fonte de verdade
- [`arquitetura-e-proximos-passos.md`](discadora-docs/reference/arquitetura-e-proximos-passos.md) — arquitetura, decisões e histórico (fonte de verdade)
- [`discadora-microsip-integracao.md`](discadora-docs/reference/discadora-microsip-integracao.md) — integração discador ↔ softphone utilizado (comandos, eventos, hooks)
- [`helper-anatomia.md`](discadora-docs/reference/helper-anatomia.md) — **o que cada arquivo do `local-helper/` faz** (os 9 arquivos, as 9 responsabilidades do `index.js`, todas as variáveis de ambiente e como depurar). Responde "o que é útil e o que não é útil ali dentro" — resposta curta: não há arquivo morto, mas a maior parte do `index.js` não é discagem, é contorno de MicroSIP e Windows
- [`perguntas-intelbras-widevoice.md`](discadora-docs/reference/perguntas-intelbras-widevoice.md) — o que pedir ao suporte Intelbras (AMD/caixa postal, limites, API, WebRTC…)
- [`plan.md`](discadora-docs/reference/plan.md) — planejamento inicial

## `updates/` — features e mudanças de arquitetura
- [`silencio-de-toque-som-no-atendimento.md`](discadora-docs/updates/silencio-de-toque-som-no-atendimento.md) — **helper v1.16 (ago/2026)**: o agente não ouve mais o ringback das N linhas do lote — o som abre sozinho no **atendimento** e fecha no fim da conversa. Explica por que nenhuma opção da tela do MicroSIP resolvia (o barulho é early media do carrier) e o **worker de PowerShell persistente** que derrubou o mute de ~1000 ms para ~45 ms. Interruptores `AUTO_MUTE_RING=0` / `AUTO_MUTE_IDLE=0`. ⏳ Reiniciar o helper e testar em ligação real
- [`preditiva-real-e-discagem-manual.md`](discadora-docs/updates/preditiva-real-e-discagem-manual.md) — **⭐ estado atual do discador (ago/2026)**: preditiva funcionando em ligação real, corte de toque anti caixa postal, discagem manual, enxugamento do helper (v1.7→1.14) e as pendências em aberto. **Começar por aqui.** ⚠️ Cobre até a v1.14 — a v1.15 está no `fixes/` abaixo, e o hider da janela foi revertido para ligado.
- [`softphone-webrtc-navegador.md`](discadora-docs/updates/softphone-webrtc-navegador.md) — **🔴 bloqueado na Intelbras (ago/2026)**: plano de migração do `local-helper` + MicroSIP para um **softphone WebRTC no navegador** (fim da instalação por máquina). Traz o inventário de paridade das 22 funcionalidades atuais, a camada `src/lib/telephony/` e as 6 etapas. **Etapa 1 concluída** (camada de transporte, sem mudança de comportamento). **Etapa 0 rodada em 14/08: o ramal registra por WebRTC, mas toda chamada volta `488 Not Acceptable Here`** — o PABX não aceita a mídia do navegador (codec GSM/G729 × Opus/G711, ou DTLS ausente no endpoint). Texto do ticket pronto na §1.2; Etapas 2–4 paradas até a resposta.
- [`discagem-paralela-preditiva.md`](discadora-docs/updates/discagem-paralela-preditiva.md) — discagem paralela/preditiva (estudo + testes + implementação)
- [`discagem-em-background-dialer-engine.md`](discadora-docs/updates/discagem-em-background-dialer-engine.md) — **design** para discar fora da tela do discador (DialerEngine) · *não implementado*
- [`discadora-status-historico-arquivamento.md`](discadora-docs/updates/discadora-status-historico-arquivamento.md) — status de campanha calculado, arquivamento reversível e histórico de chamadas com filtro de período
- [`stack-blueprint-novo-projeto.md`](discadora-docs/updates/stack-blueprint-novo-projeto.md) — blueprint portátil para iniciar um novo app na mesma stack (base do módulo Projetos/Monday)

## `fixes/` — correções de bugs
- [`correcao-downgrade-automatico-do-helper.md`](discadora-docs/fixes/correcao-downgrade-automatico-do-helper.md) — **⚠️ v1.16 (ago/2026)**: o helper **se rebaixava sozinho e sobrescrevia `local-helper/index.js`** — o auto-update comparava versão com `!==`, e o `public/helper/` (artefato de build, gitignored) estava parado na 1.7. Um helper 1.16 virou 1.7 no boot. Agora atualização **só anda para frente** (`isVersionNewer`, o mesmo comparador que a UI já tinha). Inclui o que fazer se acontecer de novo
- [`correcao-modal-ini-e-janela-visivel.md`](discadora-docs/fixes/correcao-modal-ini-e-janela-visivel.md) — **helper v1.15 (ago/2026)**: o modal `Failed to open file for writing microsip.ini` que aparecia em **todas** as máquinas — o `POST /call` (discagem 1-a-1 e manual) spawnava o `microsip.exe` **fora da fila** que existe justamente para impedir dois processos de brigarem pelo ini. Corrige também as piscadas de `cmd.exe` (`exec` sem `windowsHide`) e devolve o hider da janela do MicroSIP a **ligado por padrão** (era opt-in desde a v1.9). ⏳ Teste de discagem real pendente do dono
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
- [`filtro-hoje-ontem.md`](painelleads-docs/updates/filtro-hoje-ontem.md) — **transversal**: recorte de Hoje/Ontem nos seletores de período de todos os painéis

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
- [`cs-minutas-lucro-estimado.md`](painelcs-docs/updates/cs-minutas-lucro-estimado.md) — Página 3 ganha **Lucro Estimado** = `Valor da Minuta Final − Última Negociação`, derivado na RPC junto do `% desc.` (**valor derivado de campo do card se resolve na leitura, no SQL** — o front só soma, então tabela/KPI/insight/CSV não divergem). `NULL` quando um dos lados falta ou é `0` (**"0,00" do Pipefy = não preenchido**); **negativo é resultado válido** (negociação fechada acima da minuta), não erro a esconder. Migration `20260812` **aplicada**. Traz um **ponto em aberto pro dono**: o insight "última negociação abaixo da minuta final" pinta de vermelho o mesmo número que o lucro trata como margem
- [`cs-equipe-export.md`](painelcs-docs/updates/cs-equipe-export.md) — Página 2 (a última aba sem export) ganha CSV, **um botão por seção**, porque as duas têm granularidade diferente: Negociações sai **uma linha por card** com a URL do Pipefy na 1ª coluna; Movimento sai **uma linha por responsável**, **sem URL** — a `get_cs_team` devolve só contagens ali, não há card por trás da linha. Limitação de dado, não esquecimento da regra: se a URL for necessária, a RPC é que precisa passar a devolver os cards
- [`cs-pagina1-alternativas-viz.txt`](painelcs-docs/updates/cs-pagina1-alternativas-viz.txt) — notas de alternativas de visualização da Página 1

## `fixes/`
- [`pagamento-projecao-so-na-fase-e-url-no-csv.md`](painelcs-docs/fixes/pagamento-projecao-so-na-fase-e-url-no-csv.md) — Página 4 contava projeção de card que **já saiu** de "Aguardando Pagamento": os campos do plano ficam no `metadata` pra sempre, e a coorte era por campo, não por fase. Projeção passa a valer só dentro da fase (`cs_is_pagamento_phase`); o **realizado continua contando em qualquer fase**. Mesmo erro da `20260805` na Negociação do CEO — **campo de fase é dado de fase; fora dela é histórico, não projeção.** Migration `20260811` **aplicada** (12/ago). No mesmo pedido: **URL do card em toda exportação** do painel + CSV completo da Página 4 (`src/lib/csv.ts`, um escritor só)
- [`correcao-data-quitacao-ddmmyyyy.md`](painelcs-docs/fixes/correcao-data-quitacao-ddmmyyyy.md) — vencimento da minuta trocava dia/mês: `data_da_quita_o` vem em `DD/MM/YYYY` (não ISO) e o `::date` castava em MDY. `cs_parse_date` passa a converter pt-BR explícito (migration `20260730_cs_parse_date_ptbr.sql`, **aplicada** — confirmado ao vivo em 31/jul). A mesma armadilha reapareceu no Financeiro do Painel do CEO: **campo `date` do Pipefy não vem em ISO.** E o pipe de Negociação fechou a regra pelo outro lado — lá o `datetime_value` **existe** (campos `datetime`/`due_date`), mas **em UTC**, e 8,2% dos cards caem no dia seguinte por isso. A regra completa: **parse sempre o `value`; o `datetime_value` ou não existe ou está em UTC.**

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
- [`ocultar-concluidos-e-board-arrastavel.md`](projetos-docs/updates/ocultar-concluidos-e-board-arrastavel.md) —
  switch "Ocultar concluídos" na lista + board de altura fixa (cada fase rola por dentro) e
  navegação lateral segurando/puxando o fundo no lugar da barra. **Sem migration.**
- [`subtarefas-na-criacao-do-sprint.md`](projetos-docs/updates/subtarefas-na-criacao-do-sprint.md) —
  lista de subtarefas no formulário de novo sprint (campos da tarefa, status fixo em "Fazendo");
  viram tarefas do board num único INSERT. **Sem migration.**
- [`transferir-projeto.md`](projetos-docs/updates/transferir-projeto.md) — botão "Transferir" no
  cabeçalho: troca `owner_id` **e** o papel `'owner'` em `monday_project_members` (a RLS de delete
  olha o papel); dono antigo vira `admin` e pode devolver. **Sem migration.**

---

# Minutas Processuais (Jurídico) · `minutas-docs/`

Área nova do Blue Desk (rota `/minutas`), departamento **Jurídico** — controle de minutas
processuais (obrigações de pagamento por processo, com parcelas recorrentes). **App-native/CRUD**
(tabelas `proc_*`, RLS por departamento), não espelho de pipe. **Domínio SEPARADO das "Minutas" do
CS** (aba dentro de `/cs`, tabelas `cs_*`) — não confundir.

## `updates/`
- [`painel-minutas-processuais.md`](minutas-docs/updates/painel-minutas-processuais.md) — a área,
  modelo de dados (`proc_acordos` + `proc_parcelas`), acesso/RLS, as 3 abas (Visão Geral /
  Calendário / Minutas — esta com ordenação por coluna e filtro de período) e o script de carga da
  planilha (CSV/xlsx). Migration `20260731b_minutas_processuais.sql` **aplicada** + carga rodada
  (23 acordos / 87 parcelas, R$ 161.064,62 — 03/ago).
  ⚠️ **Pendente:** `Migrations_minutas/20260803b_proc_can_access_tester.sql` — inclui o papel
  `tester` no `proc_can_access()`. Sem ela o tester passa no gate da página mas a RLS devolve zero
  linhas, e o `/minutas` abre **vazio**.

---

# Central de Aparelhos (inventário) · `inventario-docs/`

Inventário dos celulares da empresa, dos chips e de quem está com cada aparelho (rota
`/aparelhos`, tabelas `inv_*`). **App-native/CRUD**, no molde das Minutas Processuais.
**Transversal, não é vertical de departamento** — todo departamento tem celular da empresa, então
o gate é por PAPEL (leem supervisor/gerente/admin; escrevem gerente/admin) e a área fica **fora**
de `VERTICAL_GATES` no middleware.

## `updates/`
- [`central-de-aparelhos.md`](inventario-docs/updates/central-de-aparelhos.md) — a área, o modelo
  (`inv_pessoas` + `inv_aparelhos` + `inv_chips`), acesso/RLS (leitura e escrita **separadas**, ao
  contrário do `for all` das Minutas) e as 4 abas. Traz o que mudou do protótipo HTML de origem e
  duas decisões que valem além desta área: o **limite de 2 chips é regra de banco** (`slot` +
  unique, não contagem no app — que teria corrida) e o **tester sai de graça** por construir os
  gates sobre `current_profile_role()`, em vez de repetir a lista de papéis e esquecer dele como
  aconteceu no `/minutas`.
  ⚠️ **Pendente:** aplicar `Migrations_inventario/20260820_inventario_aparelhos.sql`. Até lá o
  painel abre **vazio** (degrada de propósito, não quebra).

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

## `fixes/`
- [`perfil-orfao-auth-sem-profile.md`](rbac-docs/fixes/perfil-orfao-auth-sem-profile.md) — usuário
  em `auth.users` **sem linha em `profiles`** ficava invisível no `/admin` e preso em `/aguardando`,
  e recadastrar batia em "já existe uma conta com este email". RPC `ensure_profile()` recria o
  perfil como `pending` na entrada de `/aguardando`. ⏳ migration `20260819_ensure_profile.sql`
  pendente do dono.

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
- [`painel-ceo-indice.md`](projetopainelceo-docs/updates/painel-ceo-indice.md) — índice/estado do painel do CEO. **✅ ENTREGUE em 06/ago/2026**, 3 abas no ar
- [`painel-ceo-sprints.md`](projetopainelceo-docs/updates/painel-ceo-sprints.md) — roadmap em sprints (S0 Fundação/trava · S1 Financeiro · S2 Projeções · **S3+S4 Saúde da Equipe, fundidas numa aba só**) + decisões travadas + a conferência de conclusão da entrega
- [`introspeccao-pipefy-financeiro.md`](projetopainelceo-docs/updates/introspeccao-pipefy-financeiro.md) — mapeamento do pipe Financeiro (field-ids, parsers, achados) + as queries de introspecção reutilizáveis. ⚠️ O **campo de valor** mudou em 10/ago — ver abaixo
- [`financeiro-valor-liquido.md`](projetopainelceo-docs/updates/financeiro-valor-liquido.md) — **10/ago:** a entrada da aba Financeiro virou o **"Valor do Pagamento Líquido"** do card, no lugar do "Valor que o Cliente Pagou?". Como o líquido é um número por card, **um card = uma entrada** e os campos de parcela pararam de ser lidos: o histórico de 2024/25 mudou de valor **e de mês** (R$ 7,42 mi → R$ 5,92 mi). Card sem o campo preenchido sai do total e vira aviso na tela
- [`introspeccao-pipefy-negociacao.md`](projetopainelceo-docs/updates/introspeccao-pipefy-negociacao.md) — mapeamento do pipe Negociação `304370275` (Sprint 2): fase da projeção, field-ids, parsers e 8 achados. Dois deles mudam o desenho: o **realizado já cai no pipe do Financeiro** (risco de contagem dupla) e o **`datetime_value` vem em UTC** (8,2% dos cards no dia errado)
- [`make-integracao-financeiro.md`](projetopainelceo-docs/updates/make-integracao-financeiro.md) — cenário Pipefy → Make → Supabase do Financeiro
- [`make-integracao-negociacao.md`](projetopainelceo-docs/updates/make-integracao-negociacao.md) — cenário Pipefy → Make → Supabase da Negociação (Sprint 2). Traz **só projeção**: o realizado desse pipe já entra pelo cenário do Financeiro

## `fixes/`
- [`correcao-guarda-ceo-null.md`](projetopainelceo-docs/fixes/correcao-guarda-ceo-null.md) — a guarda das RPCs do CEO **não bloqueava** quando `ceo_current_role()` devolvia NULL: `NULL NOT IN (...)` é NULL, não TRUE, e `IF NULL THEN` não entra. Afetava as 4 RPCs do painel, inclusive a do Financeiro em produção. Corrigido na origem (o helper nunca mais devolve NULL) — migration `20260731c_ceo_guard_null_safe.sql`
- [`cards-orfaos-financeiro.md`](projetopainelceo-docs/fixes/cards-orfaos-financeiro.md) — **R$ 8.000,00 na aba Financeiro, em produção, de um card apagado no Pipefy** (29,5% do mês corrente). Card apagado lá não some do Supabase: a ingestão é upsert e o poll só enxerga o que existe. Achado pela divergência entre `verify:financeiro` (lê o Pipefy) e `verify:saude-empresa` (lê o banco). Limpeza manual; a correção de fundo é uma decisão em aberto

---

# Performance / Bundle (transversal) · `performance-docs/`

Auditoria técnica e otimizações que atravessam todos os domínios (bundle, round-trips ao Supabase,
índices). Transversal — toca `AppShell`, os barrels de feature, as server actions de auth/campanhas
e o schema do Discador.

## `updates/`
- [`auditoria-performance-2026-08.md`](performance-docs/updates/auditoria-performance-2026-08.md) —
  auditoria de ago/2026: First Load JS **−24% a −48% por rota** (Supabase client e Recharts fora do
  caminho crítico) + `getNextContacts` de 2N idas sequenciais para 2 ondas paralelas. Traz o **plano
  de commit em 3 partes**, o **checklist de validação manual** (3 caminhos ficaram sem teste por
  falta de sessão) e o que foi **recomendado mas não implementado** (claim de papel no JWT).
  ⚠️ Documenta a armadilha do **barrel**: `export` de componente com Recharts em `features/*/index.ts`
  arrasta a biblioteca inteira para a rota, mesmo sem ninguém usar a exportação — foi o que fez a
  primeira rodada de `next/dynamic` não surtir efeito.

> Índice das migrations por projeto (`supabase/migrations/Migrations_<projeto>/`):
> [`supabase/migrations/README.md`](../supabase/migrations/README.md).
