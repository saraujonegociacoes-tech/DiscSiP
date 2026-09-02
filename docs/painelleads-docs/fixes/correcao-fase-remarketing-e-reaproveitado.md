# Fix — Fase "Remarketing" invisível ao painel (contagem de Empréstimo furada) + classe "Reaproveitado"

> Criado em 2026-09-01. Sintoma relatado pelo dono: **a contagem de leads em Empréstimo não
> bate com o Pipefy**. Relatório direto do pipe, filtrado por `created_at` no ciclo **e**
> entrada na fase Empréstimo no mesmo ciclo, dava **165**; o painel mostrava **125**.
> Diferença de ~40 leads.
>
> Hipótese inicial (do dono): "o painel conta só por `created_at`, não por *entrou em
> Empréstimo no ciclo*". A descrição está certa — mas **não era a causa**. Ver abaixo.

---

## O que foi verificado

Comparação card a card entre a **API do Pipefy**, a tabela `leads` no Supabase e o retorno
real das RPCs do painel (01/set/2026, leitura pura):

| Fase | Pipefy | BlueDesk | Diff |
|---|---:|---:|---:|
| Recebidos | 6 | 118 | +112 |
| **Remarketing** | **2284** | **272** | **−2012** |
| 1° Acionamento | 604 | 2184 | +1580 |
| 2° Acionamento | 502 | 1054 | +552 |
| 3° Acionamento | 455 | 411 | −44 |
| Procedimento | 499 | 480 | −19 |
| **Empréstimo** | **519** | **409** | **−110** |
| Sem Finalidade | 1223 | 1164 | −59 |
| **TOTAL** | **6620** | **6618** | **−2** |

**O total bate.** Não é card faltando no banco — é **fase errada** no card. Os leads ficam
congelados na última fase que o poll conseguiu ver, o que infla 1°/2° Acionamento em ~2100 e
esvazia Remarketing, Empréstimo e Sem Finalidade.

Recorte do sintoma, ciclo **11/ago – 10/set**:

```
Criados no ciclo e hoje em Empréstimo (Pipefy):  191
O que a BlueDesk mostrava:                       157
--> PERDIDOS:                                     34     <-- a diferença relatada
```

Dos 519 cards que estavam em Empréstimo no Pipefy, **109** o banco achava que estavam em
outra fase (48 Sem Finalidade, 31 1° Acionamento, 14 2° Acionamento, 14 Recebidos, 1 3°
Acionamento). Em **93 desses 109**, o `updated_at` no Pipefy é **mais novo** que o
`synced_at` do banco — prova de que o card se moveu e o poll nunca mais passou nele.
Exemplo: card `1335391712` movido no Pipefy em 27/ago 14:46, último sync em **07/jul**.

## Por que a hipótese inicial não era a causa

`get_leads_dashboard.phaseDistribution` de fato usa cohort `created_at` no período e agrupa
pela fase **atual** — a descrição do dono estava correta. Mas ao reproduzir **exatamente** o
filtro do Pipefy (`criado no ciclo E entrou em Empréstimo no ciclo`) **sobre o mesmo banco**,
o resultado foi **157 contra 157**: bate perfeito. O rombo só aparece contra o Pipefy de
verdade. **Era defasagem de dado, não de lógica de leitura.**

## Causa raiz

A fase **`343865023 · Remarketing`**, criada no Pipefy **depois** do seed de `lead_phases`
([`leads_dashboard_setup.sql`](../../../supabase/manual/leads_dashboard_setup.sql), 13 fases)
e **nunca cadastrada**. Sem cadastro ela é invisível ao modelo inteiro:

- `phase_kind` e `funnel_order` ficam `NULL` → o lead não conta como produtivo **nem** como
  morto;
- some do funil e do painel de "lead morto";
- entradas nela são descartadas por `funnel_order IS NOT NULL` (regra da
  [20260731](../../../supabase/migrations/Migrations_painelleads/20260731_leads_acionamento_por_entrada.sql));
- e hoje ela é **a maior fase do pipe** (2284 cards, 1/3 da base).

Nada gritou porque **não havia nada que gritasse**: fase desconhecida entra em silêncio.
Foi esse silêncio que segurou o bug por meses.

---

## Decisões do dono (01/set)

1. **Remarketing é fase produtiva sem degrau no funil** (`funnel_order NULL`). Sustentado
   pelos dados: o Pipefy marca a fase como `done=false` (as fases finais — Venda,
   Quitação/Negociação, Empréstimo, Sem Finalidade — são `done=true`), e os cards **saem**
   dela de volta pro acionamento (dos 523 que entraram, 138 já estão em outra fase). Sem
   `funnel_order`, a numeração 0..9 fica intacta e **nenhum ciclo passado muda de forma**.
2. **Classe nova "Reaproveitado"**: quem passa por Remarketing uma vez fica marcado **para
   sempre**, mesmo depois de voltar pro acionamento.
3. **Backfill reconstrói fase atual _e_ histórico**, para consertar também as métricas por
   entrada de fase (funil da aba Funil, acionamento, dwell time, drill-downs).

### Por que "Reaproveitado" é coluna em `leads`, não cálculo sobre eventos

- "pra sempre" é estado do **lead**, não da fase atual;
- fica imune à RLS de `lead_events` — a policy `lead_events_select` só deixa o agente ver
  eventos onde ele é o `agent_id`, então um lead reaproveitado por **outro** agente ficaria
  invisível se o flag fosse derivado de evento;
- é leitura de coluna, sem subconsulta por linha.

**Qual fase marca é dado, não código:** `lead_phases.marks_reaproveitado` (espelha o padrão
do `is_won`). Uma segunda fase de reaproveitamento no futuro é um `UPDATE`, não migration.

---

## O que mudou

**Migration:** [`20260901_leads_remarketing_reaproveitado.sql`](../../../supabase/migrations/Migrations_painelleads/20260901_leads_remarketing_reaproveitado.sql)

| Objeto | O quê |
|---|---|
| `lead_phases.marks_reaproveitado` | **Coluna nova.** Marca a(s) fase(s) que ligam o flag pegajoso. |
| `lead_phases` (seed) | **Remarketing cadastrada**: `produtiva`, `funnel_order NULL`, `sla_hours NULL`, `marks_reaproveitado = true`. |
| `leads.reaproveitado` | **Coluna nova**, pegajosa (nunca volta a `false`). Semeada com o que já dá pra saber; completada pelo backfill. |
| `v_lead_progress` | `is_reaproveitado` **anexada ao fim** (`CREATE OR REPLACE`, para não quebrar as views dependentes). |
| `ingest_lead_event` | Liga `reaproveitado` quando a fase de destino tem `marks_reaproveitado`; **nunca desliga** (`leads.reaproveitado OR EXCLUDED.reaproveitado`). |
| `ingest_lead_phase_history` | **Nova** (service_role). Recebe o `phases_history` do Pipefy e grava os eventos de entrada que faltam. Aditiva e idempotente. |
| `get_leads_reaproveitados(p_start, p_end)` | **Nova.** Corrigida no dia seguinte pela [`20260902`](../../../supabase/migrations/Migrations_painelleads/20260902_leads_reaproveitado_por_entrada.sql) — ver "Correção do KPI" abaixo. |
| `v_leads_unknown_phase` | **Nova.** Guarda: lista fase do Pipefy que não está em `lead_phases`. Se devolver linha, tem fase pra cadastrar. |

**Script:** [`backfill-leads-phases.mjs`](../../../scripts/backfill-leads-phases.mjs) — `npm run backfill:leads-phases`

Por card do pipe: `ingest_lead_event` (corrige a fase atual) + `ingest_lead_phase_history`
(regrava o histórico a partir do `phases_history`, que é a fonte autoritativa — dá
`firstTimeIn`/`lastTimeIn` por fase visitada). Idempotente. Aceita `--dry-run`. Avisa no
início se o Pipefy tiver fase fora de `lead_phases`.

**App:**

| Arquivo | O quê |
|---|---|
| [`content/phases.ts`](../../../src/features/leads/content/phases.ts) | `REUSE_PHASE` + o porquê de Remarketing não entrar nem em `PRODUCTIVE_PHASES` nem em `DEAD_PHASES`. |
| [`actions/leads.ts`](../../../src/app/actions/leads.ts) | `LeadKpis.reaproveitados` / `reaproveitadosOpen`; RPC `get_leads_reaproveitados` mesclada por cima, mesmo padrão de `wonBySaleDate`/`reachFunnel` (degrada pra 0 se a migration não rodou). |
| [`LeadKpiRow.tsx`](../../../src/features/leads/components/LeadKpiRow.tsx) | Card KPI **Reaproveitados** (some quando é 0). |
| [`types/database.ts`](../../../src/lib/types/database.ts) | `is_reaproveitado` em `LeadProgressRow`. |

### Por que `is_reaproveitado` NÃO entrou em `PROGRESS_COLS`

O fallback paginado (`dashboardFromScan`) seleciona colunas por nome. Se o código subisse
antes da migration, ele pediria uma coluna inexistente e **derrubaria a página inteira** —
regressão que não existia. O número vem da RPC própria, que é independente; no fallback o
KPI simplesmente fica em 0 e o card some.

---

## Como aplicar (ordem importa)

| # | Migration | Estado |
|---|---|---|
| 1 | `20260901_leads_remarketing_reaproveitado.sql` | ✅ aplicada 02/set |
| 2 | `20260902_leads_reaproveitado_por_entrada.sql` | ✅ aplicada 02/set |
| 3 | `20260902b_leads_cards_excluidos.sql` | ⏳ pendente |

Depois de cada migration, rodar o backfill — ele é idempotente e re-rodar é seguro:

```
npm run backfill:leads-phases -- --dry-run    # confere sem escrever
npm run backfill:leads-phases
```

Conferir:

```sql
SELECT * FROM public.v_leads_unknown_phase;                     -- tem que vir vazio
SELECT current_phase, count(*) FROM public.v_lead_progress GROUP BY 1 ORDER BY 2 DESC;
SELECT * FROM public.v_leads_deleted ORDER BY created_at;       -- o mapa dos excluídos
SELECT count(*) FROM public.leads WHERE reaproveitado;
-- as três contagens têm que fechar:
SELECT (SELECT count(*) FROM public.leads)           AS na_tabela,
       (SELECT count(*) FROM public.v_lead_progress) AS nos_graficos,
       (SELECT count(*) FROM public.v_leads_deleted) AS excluidos;
```

A contagem por fase tem que bater com o Pipefy (números no cabeçalho de cada migration).

---

## Resultado (verificado em 02/set, depois da migration + backfill)

Comparação Pipefy × banco refeita card a card:

| | antes | depois |
|---|---:|---:|
| Remarketing (Pipefy × banco) | 2284 × 272 (**−2012**) | 2234 × 2252 (+18) |
| 1° Acionamento | 604 × 2184 (**+1580**) | 634 × 614 (−20) |
| Empréstimo | 519 × 409 (**−110**) | 526 × 524 (−2) |
| Cards em Empréstimo com fase errada no banco | **109 de 519** | **2 de 526** |
| Ciclo 11/ago–10/set (Pipefy × painel) | 191 × 157 (**−34**) | 198 × 196 (−2) |

Os ±2 residuais são **movimentação ao vivo** (cards que se moveram depois do backfill),
confirmado pelo `phases_history`: entraram em Empréstimo ~1h após o último sync. Não é
defasagem.

`lead_events` foi de ~7 mil para **37.918** (histórico reconstruído). Reaproveitados: **2998**
marcados, dos quais **746 já saíram** de Remarketing — que é exatamente o que a marca
pegajosa existe para não perder.

### Correção do KPI (migration [`20260902`](../../../supabase/migrations/Migrations_painelleads/20260902_leads_reaproveitado_por_entrada.sql))

A primeira versão de `get_leads_reaproveitados` ancorou o KPI no mesmo cohort dos outros
KPIs de topo — "recebidos no período" (`created_at`). Para reaproveitamento isso está errado
por construção. Depois do backfill, os reaproveitados por **mês de criação** do lead:

```
2026-04: 443 | 2026-05: 1387 | 2026-06: 721 | 2026-07: 445 | 2026-08: 2
```

→ "criados no ciclo E reaproveitados" = **2**; "ENTRARAM em Remarketing no ciclo" = **2832**.

Reaproveitamento é re-trabalho de base **antiga**: o lead que entra em Remarketing quase
nunca nasceu no ciclo corrente. O KPI passa a contar **quem entrou na fase dentro do
período**, com o split ciclo × retroativo que o painel já usa nos Ganhos — e aqui o split é
a leitura interessante, porque escancara que o volume é retroativo. Entrada é **transição**
(LAG), o que importa ainda mais depois do backfill: histórico do Pipefy e evento do poll
podem descrever a mesma passagem com timestamps diferentes, e sem o LAG uma passagem viraria
duas.

## Cards excluídos no Pipefy (migration [`20260902b`](../../../supabase/migrations/Migrations_painelleads/20260902b_leads_cards_excluidos.sql))

A conferência achou **10 leads no banco sem card correspondente no Pipefy**: todos parados em
"Recebidos", nunca trabalhados, todos de julho, e **7 dos 10 com homônimo ainda vivo no pipe**
— faxina de duplicata feita à mão. A ingestão só faz upsert do que existe, então card apagado
fica no banco para sempre: inflava "Recebidos" (banco 20 × Pipefy 5) e o recebido de dois
ciclos (1 em 11/jun–10/jul, 9 em 11/jul–10/ago), diluindo conversão e taxa de lead morto por
entrar no denominador.

**Decisão do dono: não apagar — mapear e tirar de toda contagem.** O histórico continua
auditável ("cadê o lead do Fulano?") e nenhum gráfico conta o que não existe mais.

| Objeto | O quê |
|---|---|
| `leads.deleted_at` | **Coluna nova.** NULL = card vivo. Data = quando detectamos que sumiu. Data e não boolean porque "quando sumiu" é o que responde "esse número mudou por quê?" meses depois. |
| `v_lead_progress` | `WHERE deleted_at IS NULL`. **É o único ponto que precisa do filtro** para cobrir todo gráfico — ver abaixo. |
| `v_duplicate_responsibility` | Mesmo filtro. É a única leitura do painel que não passa pela view. |
| `v_leads_deleted` | **O mapeamento**: card, título, última fase, responsável, canal, criação, último sync, quando foi detectado + URL do Pipefy. |
| `mark_leads_deleted(text[])` | **Nova** (service_role). Recebe todos os card_ids vivos de uma varredura e concilia nos dois sentidos: marca o que sumiu, **desmarca o que voltou**. |
| `ingest_lead_event` | `deleted_at = NULL` no `ON CONFLICT`: se o Make manda o card, ele existe — o estado se auto-corrige sem esperar backfill. |

### Por que um filtro só cobre todos os gráficos

`v_lead_progress` é o gargalo de leitura do painel inteiro. As views derivadas
(`v_agent_kpis`, `v_funnel`, `v_dead_reasons`, `v_phase_distribution`) são construídas em
cima dela, e as RPCs ou leem dela, ou leem `lead_events` filtrando por
`EXISTS (SELECT 1 FROM v_lead_progress …)` — inclusive `get_leads_activity`,
`get_leads_reach_funnel`, `get_leads_dwell_time` e os `get_leads_drill_*`. Um `WHERE` ali
cobre KPIs, funil, distribuição por fase, motivos de descarte, ranking, canal, séries
temporais, dwell time, acionamento e todos os drill-downs de uma vez. A única exceção,
verificada arquivo por arquivo, é `v_duplicate_responsibility`.

### Duas travas contra marcar card vivo como excluído

Uma varredura parcial (rate limit, token expirado, queda de rede no meio da paginação)
marcaria metade da base como excluída e zeraria gráfico de ciclo inteiro — em silêncio.

1. **No script:** só chama `mark_leads_deleted` se a varredura terminou com **zero falhas**.
2. **No banco:** `mark_leads_deleted` recusa lista vazia ou menor que **90%** dos leads
   ativos. Se recusar de verdade, o certo é rodar o backfill de novo, não afrouxar o limite.

**Falso alarme descartado:** o `updated_at` do Pipefy chega em BRT (`-03:00`) e o
`phases_history` em UTC (`+00:00`), mas **ambos com offset explícito** — o Postgres converte
certo. Não há bug de fuso aqui (diferente do `date`/`datetime_value` do CS e do Financeiro).

## O que este fix NÃO resolve

**Por que o poll do Make perde movimentação.** O cenário vive dentro do Make, fora do
repositório. O backfill corrige o passado; sem arrumar o poll, a defasagem volta a crescer.

Indícios levantados: as perdas se concentram em movimentações **em massa** (dezenas de cards
com `updated_at` idêntico, ex. 27/ago 11:40:33) e o volume sincronizado por dia fica num teto
de ~130–385 registros. Suspeitas, na ordem:

1. limite de registros por execução menor que o pico de movimentações;
2. filtro `updated_at > última execução` — se uma execução falha ou atrasa, a janela **pula
   cards de vez**, sem recuperação;
3. algum filtro por fase no cenário (lista fixa que não inclui Remarketing).

Enquanto isso não for resolvido, `v_leads_unknown_phase` cobre só metade do risco (fase nova);
a defasagem de fase conhecida continua silenciosa. Um monitor de `synced_at` velho seria o
próximo passo.
