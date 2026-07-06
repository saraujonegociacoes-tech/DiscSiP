# Fix — Cloudflare Error 1102 (estouro de CPU do Worker)

> Criado em 2026-07-06. O painel da Cloudflare registrava só **Error 1102 — "Exceeded CPU
> Time Limits"** (sem erro de memória nem exceção da app). Este doc é o diagnóstico + o plano
> da correção, com status por item.

---

## O que é o 1102 (e por que NÃO é chamada externa lenta)

A app roda **inteira dentro do Worker** da Cloudflare (Next via OpenNext: SSR, RSC, Server
Actions e middleware — ver [`wrangler.toml`](../../wrangler.toml), [`open-next.config.ts`](../../open-next.config.ts)).

O 1102 mede **tempo de CPU (compute)**, não tempo total. **Aguardar a resposta do Supabase é
"wall time" e não conta** para o limite. Logo o gargalo não são chamadas externas demoradas —
é **processamento pesado em JavaScript** dentro do Worker.

Contexto do plano em uso (agrava tudo):
- **Cloudflare Pages Free** → orçamento de **~10 ms de CPU por invocação**. Apertadíssimo pra
  SSR do Next.
- **Supabase Free** → PostgREST corta em **1000 linhas** por padrão (`db.max_rows`).

## Causa raiz

Um padrão repetido de **puxar tabelas inteiras do Supabase e agregar em JavaScript** dentro do
Worker. Gasta CPU em dois lugares: (1) desserializar o JSON grande da resposta e (2) rodar
loops/`filter` sobre milhares de linhas. Cresce com o volume de dados (contatos, `call_logs`) e
é amplificado por **polling**. Quando o custo passa de ~10 ms → 1102.

## Ofensores (o que consumia CPU) ✅ corrigidos

Todos eram Server Actions rodando no Worker:

1. **`/dashboard` — a request mais cara.** [`dashboard/page.tsx`](../../src/app/dashboard/page.tsx)
   dispara 4 agregações em paralelo numa request:
   - `getDashboardStats` — `campaign_contacts.select('status')` na tabela **inteira**, sem
     filtro/limit, + 2 passadas de `.filter()`.
   - `getCampaignsSummary` — puxava **todos** os `campaign_contacts` e fazia **O(campanhas ×
     contatos)**: 3 varreduras do array por campanha.
   - `getCallsByHour` + `getAgentActivity` completam a mesma request.
2. **`getAgentActivity`** — `agents.map(a => logs.filter(...))` = **O(agentes × call_logs do
   dia)**. Em **polling de 15s** ([`DashboardClient.tsx`](../../src/app/dashboard/DashboardClient.tsx)).
3. **`getCampaignStats`** ([`campaigns.ts`](../../src/app/actions/campaigns.ts)) — puxava
   **todos** os `campaign_contacts` da campanha e contava em JS. Chamada na montagem, a cada
   mudança de status e em `setInterval` de 30s ([`DialerTab.tsx`](../../src/app/softphone/DialerTab.tsx)),
   **× cada agente online**.

## O que NÃO era

- **Não era o middleware** ([`src/middleware.ts`](../../src/middleware.ts) → `updateSession`):
  são chamadas de rede (I/O = wall time), não CPU.
- **Não era um commit "quebrado".** As agregações pesadas existem desde o "Dashboard do
  supervisor". O que empurrou o Worker pro limite foi **volume de dados acumulado** +
  **polling novo** de jun/2026 (heartbeat 20s, `getAgentActivity` 15s, `getMyPerformance`
  30s), que aumenta o nº de requests SSR — e cada uma custa CPU.

## Correção — agregar no Postgres, front só lê o pronto ✅

Mesmo padrão já usado no domínio de leads ([`20260702_leads_pipefy_views.sql`](../../supabase/migrations/20260702_leads_pipefy_views.sql)):
**views `WITH (security_invoker = true)`** que calculam a métrica UMA vez no banco (indexado).
O Worker passa a receber poucas linhas → CPU por request cai de "milhares de linhas
processadas" pra quase zero.

`security_invoker = true` = a view roda com o **RLS do usuário logado** (não bypassa
segurança). Sem GRANT explícito — o Supabase concede SELECT a `authenticated` por default em
objetos novos de `public` (idêntico às views de leads).

**Migration:** [`20260706_dashboard_aggregations.sql`](../../supabase/migrations/20260706_dashboard_aggregations.sql)
— helper `brt_today_start()` (equivale a `brtTodayStartUtcISO()` de
[`src/lib/timezone.ts`](../../src/lib/timezone.ts)) + 5 views:

| View | Substitui | Retorno |
|------|-----------|---------|
| `v_dashboard_stats` | `getDashboardStats` | 1 linha: total de contatos, contactados, chamadas de hoje, agentes ativos hoje |
| `v_campaign_summary` | `getCampaignsSummary` | 1 linha/campanha: total, pending, answered, contacted (`LEFT JOIN` + `GROUP BY`) |
| `v_campaign_status_counts` | `getCampaignStats` | 1 linha/campanha: contagem por status (total inclui `exhausted`; buckets = os 9 status expostos) |
| `v_calls_by_hour_today` | `getCallsByHour` | ≤24 linhas: chamadas por hora (fuso BRT) |
| `v_agent_activity` | `getAgentActivity` | 1 linha/agente com ramal: último horário/status + contagem de hoje (`LATERAL`) + presença |

**Server Actions** ([`supervisor.ts`](../../src/app/actions/supervisor.ts),
[`campaigns.ts`](../../src/app/actions/campaigns.ts)): passaram a `.from('v_...').select()` e só
montam o objeto de retorno. **Interfaces TS inalteradas** → os client components
(`DashboardClient`, `DialerTab`) não mudaram. `getMyPerformance`
([`performance.ts`](../../src/app/actions/performance.ts)) ficou como estava (escopado a 1
agente/dia — barato, não era ofensor).

## Bônus — corrige subcontagem silenciosa

Como antes o código puxava linhas e o PostgREST Free corta em **1000**, os números do dashboard
já vinham **truncados** acima de 1000 contatos (bug silencioso). Agregando no banco, a contagem
é exata (as views retornam poucas linhas, longe do teto).

## Polling (mantido)

Com as queries baratas, os intervalos atuais (15s dashboard / 30s softphone) ficam de boa. Se
o 1102 reaparecer, **monitorar e reduzir a frequência** é o próximo passo barato.

## Migration a rodar (dono)

Aplicar [`20260706_dashboard_aggregations.sql`](../../supabase/migrations/20260706_dashboard_aggregations.sql)
no Supabase (SQL Editor ou CLI) **antes** de subir o deploy — as actions já esperam as views.

## Verificação

1. **SQL:** após a migration, rodar `SELECT * FROM v_dashboard_stats;`,
   `SELECT * FROM v_campaign_summary;`, `SELECT * FROM v_agent_activity;` — números batem com o
   esperado e `total_contacts` reflete o total real (sem o teto de 1000).
2. **Tipos/lint:** `npx tsc --noEmit` e `npm run lint` verdes (interfaces não mudaram).
3. **Local:** `npm run dev` → `/dashboard` (métricas, gráfico, lista de agentes, tabela de
   campanhas) e `/softphone` (stats da `DialerTab`) renderizam igual e conferem com o banco.
4. **Produção (pós-deploy):** acompanhar o painel da Cloudflare — os 1102 devem sumir/despencar.

## Contingência

Se o 1102 persistir mesmo assim, o próximo gargalo é o **custo-base do SSR do Next** no
orçamento de ~10 ms do plano Free → reduzir trabalho server-side das páginas pesadas ou avaliar
Workers/Pages **Paid** (CPU muito maior por invocação).
