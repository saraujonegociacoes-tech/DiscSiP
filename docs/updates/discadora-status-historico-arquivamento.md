# Blue Desk — Discadora: status calculado, arquivamento e histórico (sprints)

> Criado em 2026-07-15. Três pedidos do usuário sobre o painel da Discadora (supervisor
> e agente) — domínio **separado** do dashboard de leads (Pipefy). Entregues juntos, numa
> passada só, mas documentados como sprints porque são fatias independentes.

---

## Visão geral

| Sprint | O quê | Status |
|---|---|---|
| **1** | Status de campanha deixa de ser manual e passa a ser **calculado** | ✅ Entregue — migration aplicada |
| **2** | Arquivamento reversível de campanhas (além da exclusão que já existia) | ✅ Entregue — migration aplicada |
| **3** | Histórico de chamadas com filtro de período (agente + supervisor) | ✅ Entregue — não depende de migration |

`tsc` + `eslint` verdes nos três. Migration `supabase/migrations/20260715_campaign_status_archive.sql` **rodada pelo dono** no Supabase.

---

## Sprint 1 — Status de campanha calculado

### Causa (por que todas ficavam em "Rascunho")
`campaigns.status` só era escrito na criação (default do banco). A action
`updateCampaignStatus()` existia (`src/app/actions/campaigns.ts`) mas **nunca tinha
chamador** — nenhum botão, nenhum fluxo automático. Resultado: toda campanha ficava
presa em "Rascunho" pra sempre, mesmo já configurada, com agentes e listas, discando de
verdade. O status era puramente cosmético — não travava nada (`DialerTab.tsx` só olha o
horário de funcionamento pra liberar a discagem, nunca olhou `status`).

### Solução
Status deixou de ser gravado e passou a ser **calculado** a cada leitura, a partir do
estado real da campanha:

| Status | Regra |
|---|---|
| `draft` | sem agente vinculado OU sem nenhum contato carregado |
| `completed` | tem contato, e a fila esgotou (`pending = 0` e `dialing = 0`) |
| `paused` | pronta (agente + contato), mas fora da janela `schedule_start`/`schedule_end` agora |
| `active` | pronta e dentro da janela (ou sem restrição de horário) |

Mesma lógica de janela de horário que já existia em `isWithinSchedule`
(`src/app/softphone/DialerTab.tsx`), incluindo o caso de virar a noite (ex.: 22h→6h).

### Arquivos
- `supabase/migrations/20260715_campaign_status_archive.sql` — função SQL
  `campaign_computed_status(...)`; `CREATE OR REPLACE VIEW v_campaign_summary` (mesmo
  contrato de saída de antes); nova view `v_campaigns`.
- `src/app/actions/campaigns.ts` — `getCampaigns()`/`getCampaignsForAgent()` passam a ler
  de `v_campaigns`; `updateCampaignStatus()` removida (código morto, sem chamador).
- Nenhuma mudança de UI: os badges (`STATUS_BADGE`/`STATUS_LABEL` em
  `CampaignsListClient.tsx`, `DashboardClient.tsx`, `DialerTab.tsx`) continuam iguais —
  só muda de onde o valor de `status` vem.
- `campaigns.status` (coluna crua) **não foi removida** do banco — só deixou de ser lida
  pelo app, evitando mudança destrutiva num dado ao vivo.

---

## Sprint 2 — Arquivar e excluir campanhas

### Causa
Só existia exclusão definitiva (`deleteCampaign`, já funcional, cascata manual). Não
havia como "guardar" uma campanha encerrada sem apagar os dados.

### Solução
Coluna nova `campaigns.archived_at timestamptz` (null = ativa). Arquivar é **reversível**
e some a campanha do painel "ao vivo" (supervisor) e da lista de discagem do agente, sem
apagar nada.

### Arquivos
- `supabase/migrations/20260715_campaign_status_archive.sql` — coluna `archived_at`.
- `src/app/actions/campaigns.ts` — `archiveCampaign(id)` / `unarchiveCampaign(id)`;
  `getCampaigns(includeArchived = false)` e `getCampaignsForAgent()` filtram
  `archived_at is null` por padrão.
- `src/app/campaigns/CampaignsListClient.tsx` — toggle **Ativas / Arquivadas** acima da
  tabela; botão de arquivar (ícone `Archive`/`ArchiveRestore`) ao lado do botão de
  excluir já existente (`Trash2`), reaproveitando o mesmo padrão de confirmação inline.

---

## Sprint 3 — Histórico com filtro de período

### Causa
O agente só via as últimas 20 ligações (`getCallHistory`, sem filtro de data). O
supervisor só via métricas de **hoje** (views todas escopadas ao dia atual). A tabela
`call_logs` já guarda tudo (agente, campanha, status, disposição, duração,
`created_at`) — faltava só a consulta.

### Solução

**Reuso generalizado do seletor de período do `/leads`** (ciclo de meta dia 11 → dia 10
+ opção "Personalizado"):
- `src/lib/leads/period.ts` → **`src/lib/period.ts`** (conteúdo igual, só mudou de casa).
- `src/features/leads/components/PeriodPicker.tsx` → **`src/components/bluedesk/PeriodPicker.tsx`**
  (ao lado de `AppShell`/`PageHeader`/`StatusBadge`, componentes já compartilhados).

**Lado agente** (`/softphone`, aba Histórico):
- `getCallHistory(agentId, period, page)` em `src/app/actions/dialer.ts` — ganhou filtro
  de período (`sanitizePeriod` + `.gte`/`.lt` em `created_at`) e paginação (30 por
  página, antes era um `.limit(20)` fixo sem filtro nenhum).
- `src/app/softphone/CallHistory.tsx` — `PeriodPicker` no topo (default: ciclo atual) +
  botão "Carregar mais".

**Lado supervisor** — nova rota **`/dashboard/historico`**:
- `getCallHistoryFiltered({ period, agentId?, campaignId?, page })` em
  `src/app/actions/supervisor.ts` — período obrigatório, agente e campanha opcionais,
  paginado; nomes de agente/campanha resolvidos à parte (sem depender de embed/FK do
  PostgREST).
- `src/app/dashboard/historico/page.tsx` + `HistoricoClient.tsx` — período + dropdown de
  agente + dropdown de campanha + tabela paginada (telefone, agente, campanha,
  resultado, duração, data/hora).
- Link "Histórico" adicionado no cabeçalho de `/dashboard` (`DashboardClient.tsx`).

Esta parte **não depende da migration** — só lê tabelas (`call_logs`, `profiles`,
`campaigns`) que já existiam.

---

## Verificação
- `tsc --noEmit` e `npm run lint` verdes nos três sprints.
- Migration `20260715_campaign_status_archive.sql` **aplicada pelo dono** no Supabase.
- Testar ao vivo: `/campaigns` (status correto + toggle Ativas/Arquivadas), `/softphone`
  aba Histórico (filtro de período + carregar mais), `/dashboard/historico` (período +
  agente + campanha).
