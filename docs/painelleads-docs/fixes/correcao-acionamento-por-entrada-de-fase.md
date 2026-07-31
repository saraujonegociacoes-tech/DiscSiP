# Fix — Acionamento contado por ENTRADA de fase (não por `updated_at` nem `max` cumulativo)

> Criado em 2026-07-31. Sintomas relatados pelo dono, na aba **Funil** do painel de Leads:
> 1. Card movido de "1° Acionamento" direto para "Fechamento" (ou outra fase à frente)
>    era contado **como se tivesse passado por 2°, 3°, 4°… acionamento também**.
> 2. **Qualquer atualização** do card (editar um campo) já contava como "lead acionado" e
>    virava métrica do painel — o dono suspeitava (corretamente) do `updated_at`.
>
> Pedido: um acionamento **só acontece quando o card entra numa fase**. Ex.: recebe o lead
> em Recebidos → aciona → 1° Acionamento; faz o 2° → move para 2° Acionamento. E que essa
> regra valha para **todos os painéis que contabilizam acionamento**.

---

## Causa raiz

Duas regras erradas, ambas na contabilização de acionamento:

1. **Funil cumulativo por `max_funnel_order`.** Tanto o funil principal
   (`get_leads_dashboard.funnelByOrder`, [`Funnel.tsx`](../../../src/features/leads/components/Funnel.tsx))
   quanto o "funil geral" (`get_leads_activity`, [`FunnelActivity.tsx`](../../../src/features/leads/components/FunnelActivity.tsx))
   contavam cada etapa com **`max_funnel_order >= ordem`**. Se o lead alcançou a ordem 8
   (Fechamento), a regra "preenche" todas as ordens intermediárias (2–7), mesmo sem o card
   ter entrado nelas. → sintoma 1.

2. **Cohort "acionado" por `updated_at`.** O "funil geral" definia "acionado no período"
   como *"leads com `updated_at` dentro do período"* (migration 20260718). Qualquer
   movimentação — inclusive editar um campo sem trocar de fase — punha o card na métrica.
   → sintoma 2.

## A base pra corrigir já existia: `lead_events`

O Make grava em **`lead_events`** um registro a cada poll de card que mudou (`to_phase_id`
+ `occurred_at = updated_at`; `from_phase` fica `null`). É a fonte real de *"o card esteve
nesta fase neste momento"*. Como o `from_phase` é nulo, a **transição** (a fase mudou de
fato) é derivada com **`LAG`** sobre o histórico do lead ordenado por `occurred_at`: um
evento conta como **entrada** só quando o `to_phase_id` difere do evento anterior. Isso:

- descarta os "pings" de mesma fase (updates de campo que não trocam de fase) → resolve (2);
- nunca preenche fases puladas (só conta a etapa onde houve evento de entrada) → resolve (1).

## Decisão de escopo — por que RPCs novas/aditivas, não editar `get_leads_dashboard`

Mesma cautela do fix anterior ([`correcao-ganhos-retroativos-e-funil-geral.md`](correcao-ganhos-retroativos-e-funil-geral.md)):
`get_leads_dashboard` é uma função grande e **não versionada no repo** (só existe ao vivo).
Em vez de reescrevê-la às cegas, o funil principal é **sobrescrito no app** por uma RPC nova
pequena (`get_leads_reach_funnel`), no mesmo padrão de `wonBySaleDate`. `get_leads_dashboard`
**não é tocada**.

---

## O que mudou

**Migration:** [`20260731_leads_acionamento_por_entrada.sql`](../../../supabase/migrations/20260731_leads_acionamento_por_entrada.sql)

| Objeto | O quê |
|---|---|
| `get_leads_activity(p_start, p_end)` | **Reescrita.** Cohort "acionado" = leads que tiveram ≥1 **entrada** de fase no período. `funnelByOrder[N]` = leads que **entraram** numa fase de ordem N **no período** (não `max >= N`). `phaseDistribution` = onde esse cohort está agora. Mantém `total`/`cycle`/`retro`. |
| `get_leads_reach_funnel(p_start, p_end)` | **Nova.** Funil principal (cohort = recebidos no período) por **entrada**: `funnelByOrder[N>=1]` = quem desse cohort **entrou** na ordem N (qualquer momento); ordem 0 = todo o cohort (todo recebido entrou em Recebidos). Também `funnelByResponsible` (usado pela representatividade do `StepConversion`). |
| `get_leads_drill_agents` / `get_leads_drill_cards` | **Reescritas** (substituem a 20260723c) para contar por entrada nas 4 dimensões — senão o drill não bate com a barra. `funnel`/`funnel_activity` = entrou na ordem; `phase`/`phase_activity` = fase atual, mas com o cohort certo. |

**Server action** ([`leads.ts`](../../../src/app/actions/leads.ts)): `getLeadsData` busca
`get_leads_reach_funnel` em paralelo e sobrescreve `funnel` + `funnelByResponsible` do
dashboard base. RPC ausente → mantém o funil antigo (degradação graciosa). `getLeadsActivity`
e o drill não mudam de assinatura — só a lógica no banco.

**UI:** textos atualizados para "**entrou na fase**" em vez de "alcançou"/"qualquer
movimentação" ([`Funnel.tsx`](../../../src/features/leads/components/Funnel.tsx),
[`FunnelActivity.tsx`](../../../src/features/leads/components/FunnelActivity.tsx),
[`PhaseDistributionActivity.tsx`](../../../src/features/leads/components/PhaseDistributionActivity.tsx),
subtítulo em [`LeadsClient.tsx`](../../../src/app/leads/LeadsClient.tsx)). O
[`StepConversion.tsx`](../../../src/features/leads/components/StepConversion.tsx) deriva do
funil já corrigido; como o funil deixou de ser cumulativo, a razão etapa→etapa **pode passar
de 100%** (entrada direta numa etapa por pulo) — o rótulo mostra o valor real e a barra
satura em 100%.

## Trade-offs conhecidos (aceitos pelo dono)

1. **Poll de 30 min.** Fase atravessada **mais rápido** que a janela do poll pode não gerar
   evento próprio → não é contada (antes, com o `max`, era contada por tabela). É o
   comportamento **correto** sob "só conta quando entra na fase".
2. **Histórico do import.** A carga inicial gravou **um** evento por card = a fase no momento
   do import; fases atravessadas **antes** do import não têm evento → não são contadas para
   leads antigos (afeta sobretudo o lado retroativo). Leads novos (pós-tracking) têm a
   jornada completa.

---

## Migração + verificação

A pasta `supabase/` é gitignorada pra arquivos novos (decisão antiga) — o arquivo existe só
localmente; o dono aplica à mão.

1. **[`20260731_leads_acionamento_por_entrada.sql`](../../../supabase/migrations/20260731_leads_acionamento_por_entrada.sql)
   — ✅ APLICADA pelo dono (2026-07-31).** Ela **substitui** `get_leads_activity` (20260718) e
   as funções de drill (tornou a **20260723c redundante** — foi pulada). Pré-requisito já
   aplicado: `get_leads_dwell_time` da 20260723b (dwell), que segue valendo.
2. Verificação (4 queries no fim do arquivo):
   - card conhecido que pulou 1°→Fechamento **sumiu** das ordens 2–7 do funil geral;
   - `cycle + retro == total` em toda linha;
   - ordem 0 do funil principal == nº de recebidos no período;
   - soma dos counts do drill de uma ordem == total da barra.
3. `npx tsc --noEmit` e `npx eslint` rodados e **verdes**.
4. No app (`/leads`, aba Funil): comparar 1-2 cards conhecidos (um que pulou fase; um que só
   teve edição de campo no período — não deve aparecer como acionado).

## Status

**Entregue.** Migration 20260731 aplicada (2026-07-31); código `tsc`/`eslint` verdes. Os
gráficos de acionamento passam a contar por entrada real de fase.
