# Painel CS — Estado atual e próximos passos (handoff)

> Atualizado em 2026-07-27 (**Páginas 1, 2 e 3 no ar** — todas as migrations de CS aplicadas,
> incl. `20260723_cs_team_v2` e `20260727_cs_minutas`, + Make rodando). Falta só a **P4
> Pagamento**. Ponto de retomada do painel de Sucesso do Cliente (CS).
> Fontes de verdade: [`painel-sucesso-cliente-cs.md`](painel-sucesso-cliente-cs.md) (design
> das 4 páginas + pendências), [`make-integracao-cs.md`](make-integracao-cs.md) (ingestão).

## ✅ Feito e validado — Página 1 (Visão Geral + Janelas)

**Matriz Fase × Tempo na fase** (heatmap), no ar e conferida pelo dono:
- Esqueleto de **4 abas** em `/cs` (Radix Tabs, `?aba=`); abas 2/3/4 são placeholders.
- **Matriz**: linhas = fases (ordem do funil), colunas = 4 janelas de **tempo na fase**
  (1-30 / 31-90 / 91-180 / 181+) **+ Total + Tempo médio na fase**. Cor = heat (matiz pela
  janela recente→parado, intensidade pelo nº de cards). **❗** em fase pré-acompanhamento
  (ordem ≤ 2) com cards há 181+ dias parados.
- **Drill-down** por célula (painel lateral): ID · Cliente · Responsável · tempo na fase ·
  link do Pipefy, "Ver todos". **Exportar CSV**. Toggle **Ativos · Inativos · Todos**.
- **Sem filtro de período** (é foto de estado atual — decisão do dono).
- **Tempo na fase correto**: `dwell = now − cs_cards.current_phase_entered_at`, vindo do
  `phases_history` do Pipefy (migration `20260721` + backfill re-rodado). Corrigido o bug de
  dwell = tempo desde `updated_at`.

Arquivos: `src/app/cs/{page,CsClient}.tsx`, `src/app/actions/cs.ts` (`getCsMatrix`),
`src/features/cs/components/CsMatrix|CsTabNav|CsTabPlaceholder.tsx`, utility CSS
`scrollbar-slim` em `globals.css`. Dashboard antigo removido.

## Estado das páginas — P1, P2 e P3 no ar · falta a P4

### Página 3 — Controle de Minutas  ·  ✅ NO AR (todas as migrations aplicadas 2026-07-27)

Snapshot (foto de estado atual, **sem filtro de período**, como a P1). Só cards **com minuta**
(têm `data_da_quita_o`); os sem data viram o contador "sem minuta". Não depende do Make.

**Migrations — todas aplicadas (dono confirmou 2026-07-27: "rodei todas"):**
- `20260727_cs_minutas` — base: parsers `cs_parse_money`/`cs_parse_date` + RPC `get_cs_minutas()`.
- `20260727b_cs_minutas_resguardo` — métrica de Valor Resguardado.
- `20260727c_cs_minutas_resguardo_split` — resguardo por situação (KPI acompanha o filtro).
- `20260727d_cs_minutas_negociacao` — renames + coluna "Última Negociação" (superset de b+c).
- `20260812_cs_minutas_lucro_estimado` — ✅ **aplicada 12/ago**: `lucroEstimado` = Minuta Final −
  Última Negociação (superset da d; é a **última palavra** sobre a `get_cs_minutas()`).

**Tabela** — todas as colunas **ordenáveis** asc/desc (texto A→Z, data velho→novo, número
menor→maior): `Cliente | Responsável | Dívida do Cliente | Valor da Minuta Final | Última
Negociação | Lucro Est. | Resguardado | Vencimento | Prazo | % desc. | Etiqueta`.
- **Dívida do Cliente** = `d_vida_atual_do_cliente` (dívida atual, sem desconto).
- **Valor da Minuta Final** = `valor_resguardados_dos_clientes` (minuta emitida, com desconto).
- **Última Negociação** = `q_d_valor_da_quita_o_com_desconto` (o Q.D real da fase de negociação).
- **Lucro Est.** = Minuta Final − Última Negociação, derivado na RPC (`20260812`), só com os dois
  lados > 0 ("0,00" do Pipefy = não preenchido). Pode ser **negativo** = negociação fechada acima
  da minuta. Ver [`cs-minutas-lucro-estimado.md`](cs-minutas-lucro-estimado.md).
- **Resguardado** = série mensal `valor_de_resguardo_N`, o **maior N com valor > 0** (um por card,
  nunca a soma; mostra o mês em superscrito).
- **% desc.** = 1 − (Minuta Final ÷ Dívida) · **Vencimento** = `data_da_quita_o` · **Etiqueta** =
  `sele_o_de_etiqueta`.

**Buckets por vencimento** (tiles clicáveis, contagem + Σ): Vencidas (`<hoje`) · Mensal (`≤30d`) ·
Trimestral (`31–90d`) · Semestral (`91–180d`) · 180+ (`>180d`). Toggle **Ativos/Inativos/Todos**.

**Trilho:** "Minutas · Σ valor" (do recorte); **"Lucro estimado"** (Σ do lucro + os dois lados da
conta e a cobertura "N de M com os dois valores", **acompanha o filtro de situação**, desenho
espelhado da "Margem" do painel do CEO); **"Resguardado na carteira"** (Σ do resguardo, um por
card, **acompanha o filtro Ativos/Inativos/Todos** via `resguardo.active`/`.inactive`); e
**Insights clicáveis** — cada um abre o drill dos cards citados (link Pipefy + valor relevante):
vencidas, vence ≤30d, **última negociação abaixo da minuta final** (com a diferença acumulada),
**lucro estimado negativo** (negociação fechada acima da minuta), maior minuta. **Export CSV**
(com a coluna Lucro Estimado).

Arquivos: RPC nas migrations acima; tipos `CsMinutaCard`/`CsMinutasData`/`CsResguardoBucket`;
action `getCsMinutas`; componente `CsMinutas.tsx`; aba "minutas" do `CsClient`.

### Página 4 — Pagamento + Insights  ·  ✅ *CONSTRUÍDA 2026-07-30 (migration aplicada)*  ·  *snapshot + série*
Modelo **híbrido** (dono): **projeção** = plano de parcelas criado na fase "Aguardando Pagamento"
do SC (snapshot, teto 3x); **realizado/histórico** = **conexão do card do SC com o pipe do
Financeiro** via `child_relations` (relação "Subir pagamento") — 1 card conectado = 1 pagamento de
1 parcela. Campos do Financeiro: `valor_de_contrata_o` (pago), `data_do_pagamento`,
`esse_pagamento_referente_a_qual_parcela`, `comprovante_de_pagamento`.
- **Entregue** (tsc/eslint verdes): migration `20260730b_cs_pagamento.sql` (tabela `cs_card_payments`
  + `ingest_cs_card` lendo `child_relations` + RPCs `get_cs_pagamento_projecao`/`_historico`; reusa
  `cs_parse_date` da `20260730`), tipos `CsPagamento*`, actions, `CsPagamento.tsx`, query do import
  com `child_relations`.
- **Correção 11/ago — projeção só na fase (migration `20260811_cs_pagamento_projecao_so_na_fase.sql`,
  ✅ APLICADA 12/ago):** a coorte da `get_cs_pagamento_projecao` era por **campo** (`1_parcela_valor`
  preenchido), e os campos do plano ficam no `metadata` mesmo depois que o card sai da fase — card
  em "1° Mês"/"Quitados"/"Arquivado" seguia com previsto/em aberto/atrasado. Agora: **projeção só
  dentro de "Aguardando Pagamento"** (`cs_is_pagamento_phase`, espelha o `neg_is_waiting_phase` do
  CEO), **realizado conta em qualquer fase** (card que saiu fica na lista como "Fora da fase", só
  com o pago). Sem backfill: o plano é resolvido na leitura. Detalhe em
  [`../fixes/pagamento-projecao-so-na-fase-e-url-no-csv.md`](../fixes/pagamento-projecao-so-na-fase-e-url-no-csv.md).
- **Exportação (mesmo pedido, já no código):** **URL do card em toda exportação** do painel
  (Matriz, Minutas, Pagamento; a **Equipe** entrou em 12/ago — ver
  [`cs-equipe-export.md`](cs-equipe-export.md)); CSV da Página 4 reescrito com cronograma parcela a
  parcela e botão novo no Histórico de recebimento; formato do CSV centralizado em `src/lib/csv.ts`.
- **PENDENTE do dono:** ~~aplicar `20260730b`~~ (✅ aplicada — RPCs respondem);
  ~~aplicar `20260811`~~ (✅ aplicada 12/ago); ligar
  `child_relations` na query do Make **+ poll sem-delta do balde "Aguardando Pagamento"** (gatilho:
  pagamento no Financeiro pode não tocar o `updated_at` do card do SC); re-rodar
  `npm run import:cs-cards`. Conferido em 31/jul: `cs_card_payments` tem **1 linha** (só o card de
  teste `1421643991`), então o Make/backfill ainda não semearam.

### Página 2 — Equipe (série temporal)  ·  ✅ *CONSTRUÍDA (2026-07-22)*
- **Entregue** (tsc/lint verdes nos arquivos tocados): migration `20260722_cs_team.sql`
  (tabelas `cs_card_comments` / `cs_negotiation_snapshots` / `cs_card_assignee_events` + RLS;
  `cs_card_events.from_phase_id`; `ingest_cs_card` estendida — fase nova tolerada + comentários
  + snapshot dos 5 campos + troca de responsável; RPC `get_cs_team`), `import-cs-cards.mjs` com
  `comments{}`, action `getCsTeam`, tela `CsTeam.tsx` (PeriodPicker + KPIs + tabela de
  movimento por responsável + barras de completude + tiers de negociação).
- **Export CSV (12/ago):** um botão por seção — **Negociações** sai uma linha por **card** com a
  URL do Pipefy na 1ª coluna (regra de 11/ago); **Movimento** sai uma linha por **responsável**,
  **sem URL**, porque a `get_cs_team` não devolve os ids dos cards dessa seção. Detalhe e o
  caminho caso a URL passe a ser necessária: [`cs-equipe-export.md`](cs-equipe-export.md).
- **Decisões travadas:** atribuição = **qualquer comentário** (autor guardado); "negociação
  feita" = **mudança nos 5 campos**; relevância **pela prioridade** Q.D›Q.A›P.A›P.P›P.V (sem
  epsilon); completude **Completa=5 · Parcial=3–4 COM Q.D · Incompleta=1–2 ou 3–4 sem Q.D ·
  Sem=0**; viés de fase data-driven (`is_negotiation`/`exclude_from_movement`).
- **A completude já rende** do snapshot atual; **movimento/negociação nascem ~vazios** e
  enchem conforme o Make acumula.
- **Ativação concluída (2026-07-23):** migrations `20260722` + `20260722b` aplicadas
  (checklist verde), backfill re-rodado (snapshots/comentários semeados) e **Make montado,
  testado (200) e rodando** — série temporal já acumulando (trocas de responsável e eventos
  subindo). Fase "Aguardando Pagamento" (id `343781769`) marcada `exclude_from_movement`.
- **Eixo das negociações trocado (2026-07-31, migration `20260731b_cs_negociacao_por_responsavel.sql`
  — ✅ APLICADA e conferida):** "Negociações feitas no período" deixou de agrupar pelo assignee do
  card e passou a agrupar pelo campo da fase `quem_realizou_a_negocia_o` ("Quem realizou a
  Negociação?", `select`: Larissa/Charles/Laura/Mayara). **Movimento no período segue pelo
  assignee** (decisão do dono). O campo guarda **texto**, não usuário do Pipefy — não casa com
  `cs_agents`; card em branco vai pro balde "Sem responsável pela negociação". A migration também
  adiciona `cs_negotiation_snapshots.negotiator` (congela quem fez a negociação **no momento** dela);
  snapshot antigo (NULL) cai no valor atual do card, então a tela rende sem backfill. **Nada mais é
  exigido** — nem query nova no Make (o campo já vem em `fields`), nem re-rodar o import.
  Conferência pós-aplicação: total 23 (inalterado) em **Laura 20 · Charles 1 · Larissa 1 · Sem
  responsável pela negociação 1**; movimento seguiu por assignee, em 8 linhas.

## ❓ Pendências a responder (destravam as páginas acima)

| # | Pendência | Trava | Status |
|---|---|---|---|
| 1 | Fase **"Aguardando pagamento"** — existe no pipe? qual id? (não está nas 35 seedadas) | P2 | ✅ id **343781769** "Aguardando Pagamento" (vazia); seedada + `exclude_from_movement=true` na migration `20260722b_cs_aguardando_pagamento.sql` |
| 2 | Fase **"Negociação"** = `Negociação do Cliente` (order 2) ou outra? | P2 | ✅ `Negociação do Cliente` (id 336929552), pré-marcada `is_negotiation` |
| 3 | Gatilho de **"negociação feita"** | P2 | ✅ **só mudança nos 5 campos** (entrada na fase não conta) |
| 4 | **Minuta** — field-ids de URL / valor da minuta | P3 | ✅ resolvido (2026-07-27): sem URL própria (URL do card); **Q.A** = `d_vida_atual_do_cliente`, **Q.D** = `valor_resguardados_dos_clientes`, vencimento = `data_da_quita_o`, etiqueta = `sele_o_de_etiqueta` |
| 5 | **Corte de completude** | P2 | ✅ Completa=5 · Parcial=3–4 **com Q.D** · Incompleta=1–2 ou 3–4 sem Q.D · Sem=0 |
| 6 | **Histórico de pagamento** — snapshot de P.P ao longo do tempo ou fonte externa? | P4 | ⏳ pendente (o snapshot dos 5 campos já cobre P.P ao longo do tempo, se for essa a fonte) |
| 7 | **Atribuição** | P2 | ✅ **qualquer comentário** conta (autor guardado p/ trocar depois) |
| 8 | **Limiar de "update relevante"** | P2 | ✅ **sem epsilon** — pela ordem de prioridade Q.D›Q.A›P.A›P.P›P.V |

## 🧱 Infra transversal (independe de qual página)

- **Montar o cenário do Make** (Pipefy → Make → Supabase) — já roteirizado em
  [`make-integracao-cs.md`](make-integracao-cs.md); a query já inclui `phases_history` e
  `comments`. É o que liga a série temporal de P2 e o histórico de P4.
- **Ingestão nova** (migration a criar): `cs_card_comments` + snapshot de negociação +
  `ingest_cs_card` estendida (comentários + os 5 campos).
- Confirmar "responsável = último assignee" com um card real de 2+ assignees.

## 🧭 O que falta

**Só a Página 4 (Pagamento + Insights).** P1, P2 e P3 estão no ar com as migrations aplicadas.

- **Projeção** ("quando/quanto vão pagar") é **construível já** do snapshot: `valor_da_parcela`,
  `data_de_vencimento_da_parcela_do_cliente`, `data_da_quita_o`, contagens P.P/P.A/P.V.
- **Histórico de pagamento** depende da **pendência #6**: sai do snapshot de P.P ao longo do
  tempo (a P2 já grava `cs_negotiation_snapshots`) **ou** de fonte externa? — responder antes.
- **Não precisa de nada novo no Make** (os campos já são ingeridos pelo `ingest_cs_card`).

> Pra começar: responda a pendência #6 e peça "vamos pra Página 4". O fluxo é o mesmo —
> conceito/plano → aprovação → build com `tsc`/`lint` verdes; a migration você aplica à mão.

> Para começar a próxima: responda as pendências da página escolhida (tabela acima) e peça
> "vamos pra Página X". O fluxo é o mesmo da P1 — conceito/plano → aprovação → build com
> `tsc`/`lint` verdes; migrations você aplica manual no Supabase.
