# Painel de Sucesso do Cliente (CS) — separado do Painel de Leads (sprints)

> Criado em 2026-07-15. **Reformulado em 2026-07-21** (decisão do dono): o dashboard de
> CS foi repensado do zero — saímos do modelo "visão geral de funil" (cards por fase /
> tempo em fase / contato periódico) para um **painel em 4 páginas** voltado a controle
> de operação (Equipe, Visão Geral/Janelas, Minutas, Pagamentos). A fundação de
> ingestão e permissões (Sprint 0 e 1) continua válida; o que muda é a camada de
> dashboard. Réplica do padrão do dashboard de Leads (Pipefy → Make → Supabase) para o
> pipe de **Sucesso do Cliente**, como domínio **separado**.

## Por que separado

- O painel de Leads é sobre o **comercial**. O painel de CS é sobre outro departamento,
  com métricas diferentes. Não fazem sentido na mesma tela nem para o mesmo público.
- `Comercial`, `CS` e `Negociação` já são **departamentos separados** na tabela
  `departments` — não uma subdivisão de um departamento maior.
- Só quem é do departamento de CS deve acessar o painel de CS. `manager`/`admin` veem as
  3 verticais; `agent`/`supervisor` só a própria. Gating por `departments.slug`.

## Decisões travadas

1. **`departments.slug`** — identificador estável (`comercial` | `cs` | `negociacao` |
   `null`). Todo o gating (menu lateral, RLS dos dados de CS) usa o slug, nunca o `name`
   (texto livre).
2. **Escopo de acesso por vertical:** `agent`/`supervisor` só enxergam a própria
   vertical; `manager`/`admin` enxergam as 3. CS nasce com supervisor **restrito à
   própria área**.
3. **Arquitetura de dados: réplica isolada por vertical, não schema genérico
   multi-pipe.** Cada vertical tem suas tabelas/RPCs (`cs_*`), seguindo o blueprint de
   `leads`/`lead_events`/`lead_phases`/`lead_agents`. Isolamento total de blast radius.
4. **Dado sensível: ingerir TUDO em `cs_cards.metadata`** (jsonb, por field-id). O pipe
   carrega CPF/RG/endereço/telefone/dados financeiros de clientes reais (esteira de
   negociação de dívida). Por isso o RLS de `cs_cards`/`cs_card_events` é mais estrito:
   só quem é do departamento de CS (ou manager/admin) lê qualquer linha.
5. **Ciclo 11→10 e filtros de período (reformulação 2026-07-21).** O painel de CS passa
   a ter **ciclo do dia 11 ao dia 10 do mês seguinte**, igual ao de Leads, reusando
   [`src/lib/period.ts`](../../src/lib/period.ts) (`CYCLE_ANCHOR_DAY = 11`,
   `currentCycle`/`recentCycles`/`customPeriod`) e o
   [`PeriodPicker`](../../src/components/bluedesk/PeriodPicker.tsx) — ambos já
   domain-agnostic. **Filtro de período é obrigatório em todas as páginas** (decisão do
   dono: "de extrema importância").

---

## Reformulação 2026-07-21 — painel em 4 páginas

Decisão do dono: **abrir mão do dashboard de CS atual e começar do zero.** O modelo
antigo (distribuição por fase + tempo em fase + contato periódico — antigas Sprints 2 e
3, ver histórico ao final) fica **superado**. O código da Sprint 2 (`get_cs_dashboard`,
`CsKpiRow`/`CsPhaseDistribution`/`CsDwellByPhase`/`CsResponsibleBreakdown`,
`CsClient`) será reconstruído sob a nova arquitetura.

### Layout das 4 páginas (abas do `/cs`)

| Aba | Página | Base de dado |
|---|---|---|
| 1 | **Visão Geral + Janelas** | Snapshot atual (`pipefy_created_at`) — pronto pra construir |
| 2 | **Equipe** | **Série temporal** — movimento + comentário por ciclo (dado NÃO existe ainda) |
| 3 | **Controle de Minutas** | Snapshot atual (campos de resguardo/etiqueta/desconto) |
| 4 | **Controle de Pagamento + Insights** | Snapshot (projeções) + série temporal (histórico) |

### A pedra grande: a Equipe é série temporal e o dado não existe ainda

Introspecção do estado atual (2026-07-21, 1484 cards):

- **Histórico de movimento não existe.** Os únicos eventos em `cs_card_events` são os do
  backfill: **1000 cards com 1 evento, 484 com zero.** Nenhuma transição real capturada.
- **Comentários não são ingeridos.** `cs_cards.metadata` guarda só os `fields` do card,
  não os comentários do Pipefy.
- **Mudança de campo ao longo do tempo não é guardada** — só o snapshot atual.

Consequência: **a página de Equipe só começa a existir depois que** (a) o cenário do
Make estiver rodando e capturando transições, (b) a gente ingerir **comentários** e (c)
a gente guardar **histórico dos campos de negociação**. Antes disso ela nasce vazia — não
há como "mostrar número real hoje". O trabalho de hoje pra ela é **montar a fundação pra
começar a acumular a partir de agora**. As páginas 1, 3 e 4 rendem valor visível já.

---

## Página 1 — Visão Geral + Janelas

Gráfico de **pizza** classificando os cards por **idade desde a criação**
(`now - pipefy_created_at`) em 4 janelas:

| Janela | Idade |
|---|---|
| 1 | 1 – 30 dias |
| 2 | 31 – 90 dias |
| 3 | 91 – 180 dias |
| 4 | 181+ dias |

**Drill-down em 2 níveis:**
1. Clica no total de uma janela → total de cards da janela **por responsável**.
2. Clica no total de uma pessoa → **lista dos cards** dela naquela janela, ordenada do
   **mais antigo pro mais novo**, com a **URL do card** no Pipefy.

- URL do card: `https://app.pipefy.com/open-cards/{pipefy_card_id}` (temos `pipefy_card_id`).
- Respeita o filtro de período (idade calculada relativa ao fim do período selecionado,
  ou "agora" no ciclo corrente — **a confirmar** na implementação).
- Totalmente construível com o dado atual.

## Página 2 — Equipe (série temporal)

Controle das movimentações dentro do pipe **por responsável, no ciclo** (11→10, filtrável
por período). `atualização = comentário no card` (decisão do dono).

**4 métricas por responsável** (bucket de cada card no ciclo):

| Métrica | Moveu de fase? | Comentou? |
|---|---|---|
| Movido com atualização | sim | sim |
| Movido sem atualização | sim | não |
| Só atualização (sem mover) | não | sim |
| Parado (não atualizou nem moveu) | não | não |

Mais: **quantos cards cada responsável recebeu no ciclo e onde parou** (classificação por
fase de destino).

### Vieses a tratar (regras do dono)

- **Fase "Aguardando pagamento": ignorar** — nem a entrada nem a saída dessa fase contam
  como movimento.  ⚠ *Pendência:* essa fase não aparece nas 35 fases seedadas (ver
  Pendências) — reconciliar id no Pipefy.
- **Fase "Negociação": separar** — movimentos de entrada/saída da negociação não entram
  na contagem geral; a negociação tem controle próprio (abaixo). ⚠ *Pendência:*
  confirmar se "Negociação" = a fase `Negociação do Cliente` (funnel_order 2) ou outra.

### Controle de negociação (dentro da Equipe)

Quantas negociações foram feitas no ciclo e **quantas tiveram os campos da fase
atualizados** (o gatilho de "negociação feita" = **a confirmar**: entrada na fase de
negociação? mudança nos 5 campos?).

**Os 5 campos de negociação existem no `metadata`** (introspecção 2026-07-21, ~1043/1484
preenchidos), em ordem de prioridade do processo:

| Prioridade | Campo (rótulo Pipefy) | field-id |
|---|---|---|
| 1° | Q.D - Valor da Quitação com Desconto | `q_d_valor_da_quita_o_com_desconto` |
| 2° | Q.A - Valor da Quitação Atualizada sem Desconto | `q_a_valor_da_quita_o_atualizada_sem_desconto` |
| 3° | P.A - Parcelas em Atraso | `p_a_parcelas_em_atraso` |
| 4° | P.P - Parcelas Pagas | `p_p_parcelas_a_pagar` |
| 5° | P.V - Parcelas à Vencer | `p_v_parcelas_vencer` |

**Classificação de completude** (do snapshot atual — construível já):

- **Completa:** todos os 5 preenchidos.
- **Parcialmente completa:** 3–4 preenchidos — informar quais faltam.
- **Incompleta:** 1–2 preenchidos — informar quais faltam.
  ⚠ *Pendência:* o dono descreveu "Parcial = 3-4" e "Incompleta = 1-3", que se sobrepõem
  no 3. Assumindo o corte **Parcial 3-4 / Incompleta 1-2** — confirmar.

**Anti-"update insignificante":** a preocupação do dono é que `updated_at` pode ser
burlado por uma mudança mínima (ex.: Q.D `12000,00` → `12000,01`). Para não ficar no
escuro: guardar **histórico dos valores** dos 5 campos (`cs_negotiation_snapshots` ou
`cs_card_field_changes`) e marcar como "atualização relevante" só quando o delta passa de
um limiar (ex.: valores > R$X ou variação > Y%). Fica registrado o que mudou, quando e por
quanto — dá pra auditar. **Requer ingestão nova** (não temos histórico de campo hoje).

## Página 3 — Controle de Minutas

Controle das minutas com: **valor da minuta, vencimento, dívida original, % de desconto e
valor resguardado**. Buckets por vencimento: **Vencidas · Mensal · Trimestral · Semestral**.
Mais um espaço de **notificações com insights** de oportunidade (quitações, antecipações).

**Mapeamento confirmado pelo dono (2026-07-27) — pendência #4 resolvida:**

| Papel na P3 | Campo (rótulo Pipefy) | field-id | Nota do dono |
|---|---|---|---|
| **Link da minuta** | — (fica anexada no card) | usa a **URL do card**: `https://app.pipefy.com/open-cards/{pipefy_card_id}` | "a URL da minuta não existe; mostrar a do card" |
| **Valor da minuta** (Q.D) | "Valor da Quitação final do cliente" | `valor_resguardados_dos_clientes` | valor da minuta **com desconto** (Q.D); atualiza a cada negociação |
| **Vencimento da minuta** | "Data da quitação" | `data_da_quita_o` | **data final** da minuta de quitação → base dos buckets |
| **Dívida original** | "Dívida atual do Cliente" | `d_vida_atual_do_cliente` | dívida de **entrada**, valor **fixo** (não muda) → base do % de desconto |
| % desconto / etiqueta | "Etiqueta" | `sele_o_de_etiqueta`, `do_desconto_do_cliente_atualmente` | candidatos; desconto tb derivável = `1 − Q.D/dívida` |
| Valor resguardado | — | `valor_resguardado_at_o_momento` | candidato (o `valor_resguardados_dos_clientes` passou a ser "valor da minuta") |

> **Não se puxa o documento da minuta** — ela está anexada ao card, então o link da P3 é a
> URL do próprio card no Pipefy (mesmo padrão da P1).

⏳ *A confirmar antes do build:* (a) os cortes dos buckets Vencidas/Mensal/Trimestral/Semestral
a partir de `data_da_quita_o`; (b) usar % de desconto **derivado** (`1 − Q.D/dívida`) ou o
campo `sele_o_de_etiqueta`.

## Página 4 — Controle de Pagamento + Insights

- **Projeções** e **quando vão pagar**: `valor_da_parcela` ("Valor da Parcela"),
  `data_de_vencimento_da_parcela_do_cliente` ("Dia de Vencimento da Parcela do Cliente"),
  `data_da_quita_o` ("Data da quitação"), e contagens de parcelas (`p_p`/`p_a`/`p_v` +
  `copy_of_quantidade_de_parcelas_em_pagas` = "Total de Parcelas do Financiamento").
  Projeção construível do snapshot.
- **Histórico de quanto o cliente já pagou**: ⚠ *Pendência* — não temos série temporal de
  pagamento. Ou (a) deriva de `P.P - Parcelas Pagas` snapshotado ao longo do tempo (mesma
  ingestão de histórico da Equipe), ou (b) há uma fonte de pagamento fora do Pipefy.
  Definir com o dono.

## Classificação das fases finais (dono, 2026-07-21)

Usada pra cor/sinal nas páginas (bom/ruim/neutro):

| Fase | Sinal |
|---|---|
| Quitado(s) | **Bom** |
| Distratos | **Ruim** |
| Arquivado | Neutro |
| Concluído | Neutro |
| Distribuição (Processual) | Neutro |

---

## Ingestão nova necessária (fundação da Equipe e do histórico)

O que a reformulação exige além do que a Sprint 1 já ingere:

1. **Comentários** — nova tabela `cs_card_comments` (`pipefy_card_id`, `author`,
   `text`/`hash`, `created_at`) + captura no Make (GraphQL passa a pedir
   `comments { ... }`) + RPC de ingestão. Base de `atualização = comentário`.
2. **Histórico dos campos de negociação** — snapshot dos 5 campos a cada ingestão, com
   detecção de delta relevante (anti-update-insignificante). Base do controle de
   negociação e do histórico de pagamento.
3. **Transições reais** — já suportadas por `ingest_cs_card` (grava evento quando
   `phase_id` muda); só falta **o Make rodar**. Regras de viés (ignorar "Aguardando
   pagamento", separar "Negociação") entram no cálculo do dashboard, não na ingestão.

Detalhes do cenário: [`make-integracao-cs.md`](make-integracao-cs.md) (atualizado com a
reformulação).

## Pendências / perguntas abertas

1. **Fase "Aguardando pagamento"** — não está nas 35 fases seedadas. Existe hoje no pipe?
   Qual o id? (Mudança de pipe? O dono citou "Mudanças no pipe (Ignorar): Pós-fase".)
2. **Fase "Negociação"** — é `Negociação do Cliente` (order 2) ou outra fase?
3. **Gatilho de "negociação feita"** — entrada na fase? mudança nos 5 campos? ambos?
4. ✅ **Minuta** (resolvido 2026-07-27) — sem URL própria (usa a do card); valor da minuta =
   `valor_resguardados_dos_clientes` (Q.D); vencimento = `data_da_quita_o`; dívida fixa de
   entrada = `d_vida_atual_do_cliente`. Resta confirmar cortes dos buckets + fonte do % desconto.
5. **Corte de completude** — Parcial 3-4 / Incompleta 1-2 (assumido) vs "1-3" (falado).
6. **Histórico de pagamento** — deriva do snapshot de `P.P` ao longo do tempo ou fonte externa?
7. **Atribuição por responsável** — o autor do comentário pode diferir do responsável do
   card; contamos pelo responsável (assignee) ou pelo autor da ação?
8. **Limiar de "update relevante"** — que delta em Q.D/Q.A/parcelas conta como significativo?

---

## Fundação já entregue (Sprints 0 e 1 — continuam válidas)

### Sprint 0 — Navegação e permissões (entregue)
- `departments.slug` (migration `20260715_departments_slug.sql`, aplicada e conferida).
- Tipos: `Department.slug`, `Profile.department_slug` (derivado via 2ª query, sem embed FK).
- `softphoneStore.departmentSlug`, hidratado em `setProfile`.
- Menu lateral (`src/components/Sidebar.tsx`): grupos Operação / Comercial / Sucesso do
  Cliente / Negociação, com visibilidade por papel+slug.
- Rotas placeholder `/cs` e `/negociacao`; `ComingSoon` genérico reusado.

### Sprint 1 — Schema + ingestão do CS (entregue, base da reformulação)
- `20260715_cs_pipeline_schema.sql`: tabelas `cs_phases` (35 fases seedadas), `cs_agents`,
  `cs_cards`, `cs_card_events`; RLS estrito; RPCs `ingest_cs_card`/`ingest_cs_event`
  (`SECURITY DEFINER`, só `service_role`). Aplicada e conferida.
- `scripts/import-cs-cards.mjs` (`npm run import:cs-cards`) — carga histórica: **1484
  cards, 0 falhas**. Manda o node cru pra `ingest_cs_card` (field-mapping mora só no SQL).
- Responsável = último elemento de `assignees` (só 1 card em 1484 com 2+ assignees).
- **Falta:** montar o cenário no Make (agora expandido — ver `make-integracao-cs.md`).

## Histórico superado (não construir)

- **Antiga Sprint 2** — "visão geral": cards por fase (35 barras), tempo em fase,
  responsável via drill-down. Migration `20260716_cs_dashboard.sql` (`v_cs_progress` +
  `get_cs_dashboard`) **aplicada no Supabase**, mas o conceito foi substituído pelas 4
  páginas. A view/RPC podem ser reaproveitadas em parte ou descartadas na reconstrução.
- **Antiga Sprint 3** — "contato periódico" por campos `data_do_proximo_atendimento_N`.
  Substituída; os campos de atendimento continuam no `metadata` e podem servir a métricas
  futuras, mas não são mais o eixo do painel.

## Referências

- [`dashboard-cs-indice.md`](dashboard-cs-indice.md) — índice do painel de CS.
- [`dashboard-leads-indice.md`](dashboard-leads-indice.md) — painel irmão (modelo).
- [`make-integracao-cs.md`](make-integracao-cs.md) — cenário Pipefy → Make → Supabase.
- [`src/lib/period.ts`](../../src/lib/period.ts) — ciclo 11→10 e períodos (reusado).
