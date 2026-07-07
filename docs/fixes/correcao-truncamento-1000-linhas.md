# Fix — Contagens travando em 1000 (teto de linhas do Supabase)

> Criado em 2026-07-07. Sintoma relatado pelo dono: no dashboard de leads, as contagens de
> vários painéis paravam em **1000**, e os totais na **lista de agentes** (ranking) pareciam
> capar em ~100. Este doc é o diagnóstico + a correção, com status por item.
>
> Irmão de [`correcao-cpu-cloudflare-1102.md`](correcao-cpu-cloudflare-1102.md) — mesmo teto
> (Supabase Max Rows), mesma solução (agregar no Postgres). O 1102 resolveu isso para o
> dashboard do **discador**; este resolve para o dashboard de **leads** (que ainda agregava
> linhas cruas em JS) e fecha um resquício no import de campanha.

---

## Causa raiz — o teto "Max Rows" do PostgREST

O Supabase corta **toda resposta REST no "Max Rows" do projeto** (Settings → API → Max Rows,
padrão **1000**). Não é limite de tabela nem de plano — é o teto de linhas que o PostgREST
devolve por request. Logo, **qualquer `.select()` que devolve mais que Max Rows volta
truncado**, silenciosamente.

Quem **agrega no banco** (view/RPC que devolve poucas linhas) passa ileso. Quem **puxa linhas
cruas e conta no Worker** trava no teto. O dashboard de leads fazia o segundo:
[`getLeadsData`](../../src/app/actions/leads.ts) lia `v_lead_progress` do período e agregava
KPIs / funil / ranking / canal / motivos **em JavaScript** — acima de 1000 leads no período,
todas as contagens saíam truncadas (era o "1000" nos painéis e o "~100" nos totais por agente,
que é o ranking).

## Correção — agregar no Postgres (RPC), front só lê o pronto

Mesmo padrão do 1102 e das views de leads: contar **uma vez no banco** e devolver **1 linha**.
Como o teto limita a *quantidade de linhas da resposta* (não o que uma função conta
internamente), a agregação fica **imune ao corte**.

**Migration:** [`20260707_leads_dashboard_rpc.sql`](../../supabase/migrations/20260707_leads_dashboard_rpc.sql)
(espelhada no consolidado [`leads_dashboard_setup.sql`](../../supabase/manual/leads_dashboard_setup.sql)).

| Objeto | O quê | Retorno |
|---|---|---|
| `get_leads_dashboard(p_start, p_end)` | Agrega o dashboard do período | **1 `jsonb`**: `kpis`, `funnelByOrder`, `deadReasons`, `deathByOrder`, `channels`, `channelFilled`, `ranking` |

- `LANGUAGE sql STABLE`, **`SECURITY INVOKER`** (default): o RLS do chamador vale em
  `v_lead_progress` (security_invoker) — agente vê o próprio, supervisor o do depto, admin
  tudo. A **mesma função serve às duas visões**, sem duplicar permissão. Igual ao
  `get_agent_stuck`.
- CTE `period AS MATERIALIZED` → `v_lead_progress` (view com `LATERAL` sobre `lead_events`) é
  avaliada **uma vez**, não uma por seção.
- `GRANT EXECUTE ... TO authenticated`.

**Server Action** ([`leads.ts`](../../src/app/actions/leads.ts)): `getLeadsData` virou
`dashboardFromRpc(...) ?? dashboardFromScan(...)`. O front só pós-processa **arrays já
pequenos** (rótulos limpos de `PRODUCTIVE_PHASES`, cap "top-12 + Outros" do canal, escada de
mortalidade, ordenação do ranking) via **shapers puros** compartilhados
(`kpisFromCounts` / `buildFunnel` / `buildDeathByAttempt` / `buildChannels` / `buildRanking`).
Nada disso pode truncar (fases ~10, agentes ~8, canais ~dezenas). **Interfaces TS inalteradas**
→ os client components não mudaram.

### Fallback paginado (as leituras que precisam ser lista)

Nem tudo dá pra reduzir a 1 linha: a fila do agente e os alertas são **listas**. Para essas,
novo helper [`fetchAllRows`](../../src/lib/supabase/paginate.ts) pagina via `.range()`
avançando pelo nº de linhas **realmente** devolvido (robusto mesmo se o teto do projeto for <
1000). Exige ordenação determinística (por PK/`lead_id`). Usado em:

- `getLeadsData` → fallback `dashboardFromScan` (enquanto a migration do RPC não roda).
- `getAgentLeads` (fila do agente) e os órfãos / o fallback de "parados" do supervisor.
- [`createList`](../../src/app/actions/lists.ts) do **discador** (ver achado 1 abaixo).

## Achados relacionados corrigidos junto

1. **Dedup de campanha truncava (discador).** [`createList`](../../src/app/actions/lists.ts)
   lia os telefones já existentes com `.select('phone_number')` **capado em 1000** → numa
   campanha com >1000 contatos, uma nova lista deixava **passar duplicados**. Agora pagina com
   `fetchAllRows` (ordena por `id`).
2. **Período do cliente ia cru pra um filtro por string (segurança).** `getAgentLeads` monta um
   `.or(finalized_at...gte.${period.start}...)` — `period` vem do browser. Novo
   [`sanitizePeriod`](../../src/lib/leads/period.ts) normaliza `start`/`end` para **ISO
   canônico** (lança se inválido) na entrada das 3 actions (`getLeadsData` / `getAgentLeads` /
   `getSupervisorMetrics`), então nada forjado entra no filtro. O RLS já era a barreira real; é
   defesa em profundidade.

## Propriedade importante

**O truncamento some já no deploy — mesmo sem rodar a migration.** Sem o RPC, cai no fallback
paginado, que é **correto** (só mais lento). Rodar a migration não é o que "conserta" — é o que
deixa **barato** (conta no banco em vez de puxar tudo pro Worker), evitando reacender o
[Error 1102](correcao-cpu-cloudflare-1102.md) quando o período for grande.

## Migration a rodar (dono) + verificação

1. Aplicar **só** [`20260707_leads_dashboard_rpc.sql`](../../supabase/migrations/20260707_leads_dashboard_rpc.sql)
   (é `CREATE FUNCTION`, não toca em dado). **NÃO reaplicar o consolidado** — ver aviso abaixo.
2. **SQL:** a `total` de uma faixa larga deve passar de 1000 sem travar:
   ```sql
   SELECT public.get_leads_dashboard('2000-01-01T00:00:00Z','2100-01-01T00:00:00Z') -> 'kpis';
   -- ex.: {"total": 4374, "won": 69, "dead": 672, "open": 3642, "avgHoursToFirstContact": 469.2}
   ```
3. **Tipos/lint:** `npx tsc --noEmit` e `npx eslint` verdes (interfaces não mudaram).
4. **Recomendado:** conferir o valor de **Max Rows** em Settings → API (é o teto global).

## ⚠️ Aviso operacional — o consolidado é DESTRUTIVO

[`supabase/manual/leads_dashboard_setup.sql`](../../supabase/manual/leads_dashboard_setup.sql)
é um **drop + create** (começa com `DROP TABLE ... CASCADE` de `leads` / `lead_events` /
`lead_agents` / `lead_phases`) feito para montar a base **do zero**; re-seeda **só o
`lead_phases`**. **Reaplicá-lo num banco com dado APAGA os leads.**

Aconteceu em 07/jul (reaplicaram o consolidado achando que era a migration → base zerada).
Recuperação, porque **o Pipefy é a fonte de verdade** (o Supabase é espelho):

1. `npm run import:leads` re-puxa todos os cards do Pipefy → restaura
   `leads` / `lead_events` / `lead_agents` (idempotente; foram 4.374 cards / 8 agentes / 15
   dup em ~78s). O **Make sozinho não backfilla** — o delta só traz cards mudados nos ~35 min.
2. Re-mapear `lead_agents.profile_id` (a dimensão foi recriada com `profile_id` nulo):
   ```sql
   UPDATE public.lead_agents la
   SET profile_id = p.id
   FROM public.profiles p
   WHERE p.email IS NOT NULL
     AND lower(btrim(la.email)) = lower(btrim(p.email))
     AND la.profile_id IS DISTINCT FROM p.id;
   ```
   Quem não casar por e-mail (typo no `profiles`) mapeia à mão por `id`.
3. `sla_hours` volta ao seed do consolidado — refazer o `UPDATE lead_phases` se tiver sido
   ajustado à mão.

**Regra travada:** em banco com dado, **só migrations incrementais** — nunca reaplicar o
consolidado.
