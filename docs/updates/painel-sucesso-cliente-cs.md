# Painel de Sucesso do Cliente (CS) — separado do Painel de Leads (sprints)

> Criado em 2026-07-15. Planejado em conjunto com o dono (plan mode) antes de qualquer
> código. Réplica do padrão do dashboard de Leads (Pipefy → Make → Supabase) para o pipe
> de **Sucesso do Cliente**, mas como domínio **separado** — não pode se misturar com o
> painel de Leads, que existe na discadora só por causa do comercial.

## Por que separado

- O painel de Leads é sobre o **comercial**. O painel de CS é sobre outro departamento,
  com métricas diferentes (cards por fase, tempo em fase, responsável, contato periódico
  feito ou não). Não fazem sentido na mesma tela nem para o mesmo público.
- `Comercial`, `CS` e `Negociação` já são **departamentos separados** na tabela
  `departments` — não uma subdivisão de um departamento maior.
- Só quem é do departamento de CS deve acessar o painel de CS (e, futuramente, só quem é
  de Negociação acessa o painel de Negociação). Supervisor, gerente e admin também
  precisavam de uma regra clara — ver decisões abaixo.

## Decisões travadas

1. **`departments.slug`** — identificador estável (`comercial` | `cs` | `negociacao` |
   `null`) além do `name` (que é texto livre e editável). Todo o gating (menu lateral,
   RLS dos dados de CS) usa o slug, nunca o nome.
2. **Escopo de acesso por vertical:**
   - `agent` / `supervisor` → só enxergam a vertical do próprio departamento
     (`profiles.department_id` → `departments.slug`).
   - `manager` / `admin` → enxergam as 3 verticais sempre, igual já é a intenção
     documentada em `src/features/ajuda/content/roles.ts` ("gerente enxerga o negócio
     inteiro").
   - Isso é uma mudança em relação ao supervisor de Leads hoje ser o mesmo balde que
     manager/admin em alguns pontos — CS nasce com supervisor **restrito à própria área**
     desde o início.
3. **Arquitetura de dados: réplica isolada por vertical, não schema genérico multi-pipe.**
   Pergunta feita pelo dono: qual é o melhor a longo prazo, considerando escalabilidade e
   sem atrapalhar a integração Make? Decisão (meu recado, não é preferência do dono):
   - Um schema único (`cards` + `pipe_id`) pareceria mais DRY, mas o mapeamento de campos
     do Pipefy já é específico por pipe mesmo — um RPC genérico ainda precisaria de uma
     tabela de configuração por pipe pra saber o que mapeia pra quê. A complexidade não
     some, só muda de lugar — e passa a arriscar quebrar o comercial (já em produção)
     toda vez que se mexe em CS ou, no futuro, em Negociação.
   - Os cenários do Make **já são isolados por pipe** por natureza (1 cenário por pipe
     Pipefy), então schema unificado não simplifica a integração Make — só complica, ao
     forçar um RPC de ingestão único a lidar com formatos diferentes.
   - Cada vertical ganha suas próprias tabelas/RPCs (`cs_*`, e no futuro `negociacao_*`),
     seguindo o **mesmo blueprint** de nomes de coluna/formato de RPC do que já existe em
     `leads`/`lead_events`/`lead_phases`/`lead_agents` — isolamento total de blast radius,
     e continua rápido de replicar pra próxima vertical porque o padrão já é validado.
     Tabela leve de registro (`pipefy_pipe_configs`) fica só como metadado central de
     "quais pipes estão integrados", sem guardar cards.
4. **Negociação entra no menu já como "Em breve"** (mesmo componente de placeholder do
   Leads/CS), sem tabela nem dado por trás — ainda não existe nenhuma aplicação pra essa
   vertical.

## Visão geral das sprints

| Sprint | O quê | Status |
|---|---|---|
| **0** | Fundação de navegação e permissões (`departments.slug`, grupos no menu, rotas placeholder `/cs` e `/negociacao`) | ✅ Entregue |
| **1** | Schema + ingestão do CS (tabelas `cs_*`, RPCs, script de backfill, cenário Make) | 🟡 Backfill feito (1484 cards, 0 falhas) — falta montar o cenário no Make |
| **2** | Painel CS: visão geral (cards por fase, tempo em fase, responsável) | ✅ Entregue — falta ligar a flag e verificar com sessão real |
| **3** | Métrica de contato periódico | ⬜ Planejada |
| **4+** | Iterativo (métricas que forem surgindo) + replicar blueprint pra Negociação quando houver a 1ª aplicação | ⬜ Planejada |

`tsc --noEmit` e `npm run lint` verdes na Sprint 0. Nada commitado (o dono controla o
git). Migration **aplicada e conferida** no Supabase (15/jul) — 1 departamento por slug,
sem órfãos: `comercial` → "Comercial", `cs` → "Sucesso do Cliente", `negociacao` →
"Negociação".

---

## Sprint 0 — Fundação de navegação e permissões (entregue)

### `departments.slug`
Migration `supabase/migrations/20260715_departments_slug.sql`: coluna `slug text NULL`
com `CHECK (slug IN ('comercial','cs','negociacao'))`, índice único parcial (1
departamento por slug), e um backfill **best-effort** por `name ILIKE` (comercial/cs/
negociação) — os nomes reais das linhas não estavam disponíveis localmente (schema só
existe no Supabase, `supabase/` não é mais versionado, ver
[`../../docs/updates/discadora-status-historico-arquivamento.md`](discadora-status-historico-arquivamento.md)
e a nota de plataforma nele). **Aplicada e conferida pelo dono (15/jul):** 1
departamento por slug, sem órfãos — `comercial` → "Comercial", `cs` → "Sucesso do
Cliente", `negociacao` → "Negociação".

### Tipos e resolução do departamento do usuário
- `src/lib/types/database.ts` — `Department.slug`; `Profile.department_slug` (campo
  derivado, não é coluna de `profiles`).
- `src/app/actions/auth.ts` (`getCurrentProfile`) — depois de buscar o perfil, resolve
  `department_slug` numa 2ª query por `department_id` (sem embed/FK do PostgREST — mesma
  cautela já usada no histórico de chamadas do supervisor).
- `src/store/softphoneStore.ts` — novo campo `departmentSlug`, hidratado em `setProfile`.

### Menu lateral (`src/components/Sidebar.tsx`)
Antes: uma lista plana (`NAV_ITEMS`) dentro de um único grupo "Operação". Agora:
- **Operação** (inalterado): Discador, Dashboard, Campanhas, Admin, Ajuda.
- **Comercial** (novo grupo): Leads — sai de dentro de "Operação" e ganha grupo próprio.
- **Sucesso do Cliente** (novo grupo): Painel CS (`/cs`).
- **Negociação** (novo grupo): Painel de Negociação (`/negociacao`).

Regra de visibilidade dos 3 grupos de vertical: `manager`/`admin` sempre veem os 3;
`agent`/`supervisor` só veem o grupo cujo slug bate com `departmentSlug` do próprio
perfil. Sem departamento reconhecido, nenhum grupo de vertical aparece (comportamento
seguro — "Operação" continua igual pra todo mundo).

### Rotas placeholder
- `src/app/cs/page.tsx` + `CsComingSoon.tsx` — tela "Em breve" do painel de CS.
- `src/app/negociacao/page.tsx` — tela "Em breve" do painel de Negociação, sempre (sem
  flag — ainda não há previsão de sprint pra essa vertical).
- Nenhum dos dois usa flag de lançamento ainda (`NEXT_PUBLIC_CS_ENABLED` só entra na
  Sprint 2, junto com o dashboard real — sem isso o flag não teria nenhum efeito, então
  ficou fora do escopo da Sprint 0 pra não sobrar código morto).
- Extraído `src/components/blueline/ComingSoon.tsx` (genérico, `title`/`description`/
  `message`) a partir do que era só `LeadsComingSoon.tsx`, e reaproveitado pelos 3
  painéis (Leads, CS, Negociação) — evita 3 componentes quase idênticos.

### Segurança em camadas
Nenhuma rota nova ganhou restrição no `middleware.ts` — mesmo comportamento de `/leads`
hoje (qualquer usuário aprovado consegue abrir a URL; o menu lateral só *oferece* o link
pra quem faz sentido). Como `/cs` e `/negociacao` ainda não têm dado nenhum atrás, não há
o que vazar. **Retomar esse ponto na Sprint 2**: quando o painel de CS tiver dado real, o
RLS das tabelas `cs_*` já escopa por departamento (ver decisão 3), mas vale avaliar um
guard de página adicional (como já existe pra `/admin`) por defesa em profundidade.

### Verificação feita
`npx tsc --noEmit` e `npm run lint` sem erros novos (só warnings/erros pré-existentes em
`local-helper/`, `public/helper/` e artefatos de build — nada nos arquivos tocados). Smoke
test: subi o dev server localmente e chamei `/login`, `/leads`, `/cs`, `/negociacao` sem
sessão — todas as rotas novas respondem `307` pro login (mesmo comportamento de `/leads`
hoje), sem erro 500. **Falta verificação com sessão real** (ver checklist abaixo).

---

## Sprint 1 — Fundação de dados do CS (código pronto, falta aplicar)

### Descoberta do pipe real
Pipe **"3.3 - Customer Success"** (`305801110`), **35 fases**: Triagem → Apresentação →
Negociação do Cliente → **24 fases mensais** (1° a 24° Mês, acompanhamento pós-
negociação de dívida) → saídas: Quitados, Concluído, Distratos, Acordos Vencidos,
Arquivado (827 cards — de longe o maior grupo, precisa de definição do dono do que
significa antes da Sprint 2), Falta de Contato, Distribuição Processual, Pendente envio
de carta de quitação.

**Achado que muda o plano original:** o "contato periódico" já é rastreado por campos
próprios em cada fase mensal (ex.: *"Data do atendimento"* / *"Data do [próximo]
atendimento"*) — **não** pela API de `activities()` como a hipótese inicial supunha. O
id desses campos muda a cada mês (`data_do_atendimento_1`, `_2`, `_3`...); a Sprint 3
vai precisar de uma tabela pequena de mapeamento fase → campo. Reparo à parte: a fase
"16° Mês" parece ter rótulo e tipo trocados entre os dois campos de data (o `due_date`
tem rótulo de "último" e o `date` tem rótulo de "próximo") — vale o dono conferir no
Pipefy quando puder.

### Decisão de dado sensível
O pipe carrega dado pessoal de clientes reais (CPF, RG, endereço, telefone, nome dos
pais, data de nascimento) — natural numa esteira de negociação de dívida. **Decisão do
dono: ingerir TUDO** em `cs_cards.metadata` (jsonb, por field-id), em vez de selecionar
só campos operacionais. Por isso o RLS de `cs_cards`/`cs_card_events` ficou mais
estrito que o de `cs_phases`/`cs_agents`: só quem é do departamento de CS (ou
manager/admin) lê qualquer linha das tabelas de CS — ninguém do comercial ou de
negociação enxerga nada daqui, nem via API direta.

### O que foi escrito
- `supabase/migrations/20260715_cs_pipeline_schema.sql` — tabelas `cs_phases`
  (seedada com as 35 fases reais), `cs_agents`, `cs_cards`, `cs_card_events`; helpers
  de RLS com namespace `cs_*` (pra não colidir com o que já existe pro leads, que não
  dá pra conferir localmente); policies de SELECT (fora do CS não vê nada; dentro do
  CS, agente=o próprio card, supervisor=o departamento, manager/admin=tudo); RPCs
  `SECURITY DEFINER` `ingest_cs_card(node jsonb)` / `ingest_cs_event(payload jsonb)`,
  executáveis só por `service_role` (`REVOKE ALL FROM PUBLIC, anon, authenticated`
  explícito — o front nunca escreve direto).
  - Diferença de design em relação ao leads: **um card só vira evento de transição
    quando a fase muda de fato** (compara por `phase_id`, não por nome, pra não gerar
    transição falsa se alguém só renomear uma fase no Pipefy) — evita inflar o cálculo
    de tempo-em-fase da Sprint 2 com "transições" fantasmas toda vez que um campo
    qualquer do card é editado.
  - **Responsável = último elemento de `assignees`** quando há 2+ (mesma assunção do
    leads — "mais recente é o último" — **a confirmar** com um caso real).
- `scripts/import-cs-cards.mjs` (`npm run import:cs-cards`) — carga histórica. Ao
  contrário do `import-leads.mjs` (que remonta o payload em JS), este manda o **node
  cru** pra `ingest_cs_card` — o mapeamento de campo mora só no SQL, uma única fonte de
  verdade, sem duplicar lógica em JS.
- `docs/docs_dashboard_cs/` (silo novo, mesmo padrão de `docs/docs_dashboard_pipefy/`):
  `README.md` + `make-integracao-cs.md` (roteiro do cenário Make, pipe `305801110`,
  ainda não montado).
- `.env.example` (`CS_PIPEFY_PIPE_ID`) e `package.json` (`import:cs-cards`).

### Falta pra fechar a Sprint 1
1. **Dono aplica** `20260715_cs_pipeline_schema.sql` no Supabase e confere (`SELECT
   count(*) FROM cs_phases` → 35).
2. Rodar `npm run import:cs-cards` (carga histórica) e conferir a contagem batendo
   com o Pipefy.
3. Confirmar a assunção de "responsável = último assignee" com um card real de 2+
   assignees.
4. Montar o cenário no Make seguindo `docs/docs_dashboard_cs/make-integracao-cs.md`.

## Sprint 2 — Painel CS: visão geral (entregue)

**Sem parâmetro de período** (diferente do leads): "quantos cards por fase" e
"responsável" são perguntas de estado ATUAL (quantos clientes estão em cada mês de
acompanhamento agora), não de uma janela de tempo — o leads tem ciclo de meta
comercial, o CS não. Pode ganhar filtro de período depois, se fizer falta.

### Camada de dados
`supabase/migrations/20260716_cs_dashboard.sql`:
- **`v_cs_progress`** (`security_invoker`) — 1 linha por card: fase atual, `funnel_order`,
  responsável, e `days_in_current_phase` (desde o último evento conhecido pra essa fase;
  sem evento, cai pro `pipefy_created_at`, e por último pro `synced_at`).
- **`get_cs_dashboard()`** — agrega tudo numa chamada só no Postgres (mesmo cuidado do
  erro 1102 — nunca puxar tabela inteira pro Worker): `kpis` (total, sem responsável,
  responsáveis distintos, tempo médio na fase atual), `phaseDistribution` (contagem +
  tempo médio por fase, nas 35 fases, ordenado por `funnel_order`), `byResponsible`
  (drill-down por fase → lista de responsáveis, pro clique-pra-detalhar).
- Sem `SECURITY DEFINER` — roda com o RLS de quem chamou (o mesmo RLS estrito da
  Sprint 1: só CS + manager/admin veem qualquer linha; dentro do CS, agente=o próprio,
  supervisor=o departamento).

### App
- `src/lib/types/database.ts` — `CsKpis`, `CsPhaseCount`, `CsAgentCount`,
  `CsDashboardData`.
- `src/app/actions/cs.ts` — `getCsDashboard()`, chama a RPC e tipa o retorno.
- `src/features/cs/components/` — `CsKpiRow` (4 KPIs), `CsPhaseDistribution` (barras
  horizontais, 35 fases, altura dinâmica pelo nº de fases, clique abre
  `CsResponsibleBreakdown`), `CsDwellByPhase` (barras horizontais de tempo médio na
  fase atual, só fases com card). Réplica local do padrão de
  `src/features/leads/components/PhaseDistribution.tsx`/`StepDwellTime.tsx`/
  `ResponsibleBreakdown.tsx` — sem componente compartilhado entre os dois domínios
  (mesma decisão de isolamento da Sprint 1).
- `src/app/cs/page.tsx` — gate `NEXT_PUBLIC_CS_ENABLED` (mesmo padrão do
  `NEXT_PUBLIC_LEADS_ENABLED`, introduzido só agora que existe conteúdo real atrás
  dele); `src/app/cs/CsClient.tsx` — composição (KPIs + 2 gráficos lado a lado). Sem
  abas ainda — uma página só, do jeito que foi pedido (o `/leads` só ganhou topbar de
  7 abas depois de várias sprints; não faz sentido copiar essa complexidade agora).

### Limitações conhecidas
- **"Tempo na fase atual" é uma aproximação, não o tempo exato desde a entrada na
  fase.** Hoje cada card só tem 1 evento em `cs_card_events` (o da carga histórica, que
  registra `updated_at` do card no momento do backfill — não necessariamente o momento
  em que ele entrou na fase atual). Fica mais preciso conforme o cenário do Make rodar
  e capturar transições de fase de verdade.
- **Sem classificação de fase** (o que é "sucesso" vs "encerrado sem sucesso", o que
  `Arquivado` significa) — as 35 fases aparecem todas com a mesma cor. Não bloqueava
  esta sprint (cards por fase / tempo / responsável não dependem disso), mas falta
  pra métricas futuras tipo "taxa de sucesso".
- Sem filtro de período — todo o painel é sempre "agora".

## Sprint 3 — Contato periódico (planejada)

O schema GraphQL que o dono levantou traz `activities(cardUuid: ID, ...)` — sinal de que
o contato periódico é rastreado via **atividades do card** no Pipefy, não um campo
simples. Precisa definir com o dono, antes de implementar: qual atividade conta como
"contato" e qual a cadência esperada (a cada quantos dias um card "vence"). Guardar em
`cs_card_contacts` ou `cs_cards.last_periodic_contact_at`. Widget: cards "em dia" vs
"atrasados", filtrável por responsável e fase.

## Sprint 4+ — Iterativo (planejada)

Buffer para métricas que o dono for lembrando com o tempo (mesmo padrão de crescimento
incremental que `/leads` teve — ver
[`novo-visual-dashleads.md`](novo-visual-dashleads.md)). Quando existir a 1ª aplicação de
Negociação, replicar o mesmo blueprint (`negociacao_*`, RPCs, grupo do menu passa a
apontar pra rota real).

---

## Checklist de verificação (Sprint 0)

- [x] `tsc --noEmit` / `npm run lint` sem erros novos.
- [x] Smoke test sem sessão (`/login`, `/leads`, `/cs`, `/negociacao` → `307`, sem 500).
- [x] **Dono rodou a migration** `20260715_departments_slug.sql` no Supabase (15/jul) —
      1 linha por slug, sem órfãos.
- [ ] Logar com um usuário de cada combinação (agente/supervisor/manager/admin ×
      comercial/cs/sem-departamento) e conferir que o menu lateral mostra só os grupos
      esperados.

### Sprint 1
- [x] Dono aplica `20260715_cs_pipeline_schema.sql` — conferido: as 5 primeiras fases
      batem em ordem (Triagem, Apresentação, Negociação do Cliente, 1° Mês, 2° Mês).
- [x] `npm run import:cs-cards` — **1484 cards, 0 falhas, 50 páginas.** Conferido
      contra a soma de `cards_count` das 35 fases da introspecção (0+0+10+...+827 =
      1484) — bate exato, nenhum card ficou de fora.
- [x] `responsabilidade_duplicada=1` — só 1 card em 1484 com 2+ assignees. Risco baixo
      da assunção "responsável = último elemento" estar errada; não bloqueia a Sprint 2.
- [ ] Cenário Make montado e testado (1 rodada manual, ver retorno 200 da RPC).

### Sprint 2
- [x] `tsc --noEmit` / `npm run lint` sem erros novos.
- [x] Smoke test sem sessão (`/cs` → `307` pro login, sem 500).
- [ ] Dono aplica `20260716_cs_dashboard.sql` no Supabase.
- [ ] Ligar `NEXT_PUBLIC_CS_ENABLED=1` localmente e conferir com sessão real (de cada
      papel: agente do CS, supervisor do CS, manager/admin) — `kpis.total` deve bater
      com 1484 pra quem vê tudo (manager/admin), e ser um subconjunto pro agente.
- [ ] Conferir visualmente o gráfico de 35 fases (altura/legibilidade) num card real.

## Referências

- Plano completo desta iniciativa (contexto e alternativas descartadas):
  `C:\Users\Filipe Crepaldi\.claude\plans\ent-o-eu-preciso-replicar-shimmering-bengio.md`
  (arquivo local do agente, fora do repo).
- [`../docs_dashboard_pipefy/README.md`](../docs_dashboard_pipefy/README.md) — silo do
  dashboard de Leads, modelo usado pro `docs_dashboard_cs/`.
- [`../docs_dashboard_cs/README.md`](../docs_dashboard_cs/README.md) — silo do painel
  de CS (schema, ingestão, cenário Make).
