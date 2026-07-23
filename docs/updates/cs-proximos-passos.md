# Painel CS — Estado atual e próximos passos (handoff)

> Atualizado em 2026-07-22 (Página 2 Equipe construída — falta o dono aplicar a migration +
> Make). Ponto de retomada do painel de Sucesso do Cliente (CS).
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

## 🔜 O que falta — Páginas 2, 3, 4 (todas travadas em pendências do dono)

### Página 3 — Controle de Minutas  ·  *snapshot, mais rápida de render*
- **Destrava com:** field-ids de **minuta**, **valor da minuta** e **URL da minuta** (não
  achados no catálogo — pendência 4).
- Já há candidatos: % desconto/etiqueta (`sele_o_de_etiqueta`,
  `do_desconto_do_cliente_atualmente`), resguardo (`valor_resguardado_at_o_momento`, …).
- Buckets por vencimento: Vencidas · Mensal · Trimestral · Semestral.

### Página 4 — Pagamento + Insights  ·  *snapshot + série temporal*
- **Projeção** (quando/quanto vão pagar): construível do snapshot já — `valor_da_parcela`,
  `data_de_vencimento_da_parcela_do_cliente`, `data_da_quita_o`, contagens P.P/P.A/P.V.
- **Histórico de pagamento:** definir a fonte (pendência 6) — snapshot de P.P ao longo do
  tempo (mesma ingestão da Equipe) **ou** fonte externa ao Pipefy.

### Página 2 — Equipe (série temporal)  ·  ✅ *CONSTRUÍDA (2026-07-22)*
- **Entregue** (tsc/lint verdes nos arquivos tocados): migration `20260722_cs_team.sql`
  (tabelas `cs_card_comments` / `cs_negotiation_snapshots` / `cs_card_assignee_events` + RLS;
  `cs_card_events.from_phase_id`; `ingest_cs_card` estendida — fase nova tolerada + comentários
  + snapshot dos 5 campos + troca de responsável; RPC `get_cs_team`), `import-cs-cards.mjs` com
  `comments{}`, action `getCsTeam`, tela `CsTeam.tsx` (PeriodPicker + KPIs + tabela de
  movimento por responsável + barras de completude + tiers de negociação).
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

## ❓ Pendências a responder (destravam as páginas acima)

| # | Pendência | Trava | Status |
|---|---|---|---|
| 1 | Fase **"Aguardando pagamento"** — existe no pipe? qual id? (não está nas 35 seedadas) | P2 | ✅ id **343781769** "Aguardando Pagamento" (vazia); seedada + `exclude_from_movement=true` na migration `20260722b_cs_aguardando_pagamento.sql` |
| 2 | Fase **"Negociação"** = `Negociação do Cliente` (order 2) ou outra? | P2 | ✅ `Negociação do Cliente` (id 336929552), pré-marcada `is_negotiation` |
| 3 | Gatilho de **"negociação feita"** | P2 | ✅ **só mudança nos 5 campos** (entrada na fase não conta) |
| 4 | **Minuta** — field-ids de URL / valor da minuta | P3 | ⏳ pendente |
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

## 🧭 Ordem recomendada

1. **Aplicar `20260722_cs_team.sql` + re-rodar o backfill + montar o Make** — destrava o dado
   real da P2 (série temporal) e já semeia a completude. Prioridade, porque cada dia sem o
   Make é série temporal perdida pra sempre.
2. **Página 3 (Minutas)** — melhor esforço×valor: é snapshot (rende rápido, espelha a P1) e
   só depende de você mandar os field-ids da minuta (pendência 4).
3. **Página 4 (Pagamento)** — snapshot pra projeção; o histórico pode sair do snapshot dos 5
   campos (P.P ao longo do tempo) que a P2 já passou a gravar (confirmar pendência 6).

> Para começar a próxima: responda as pendências da página escolhida (tabela acima) e peça
> "vamos pra Página X". O fluxo é o mesmo da P1 — conceito/plano → aprovação → build com
> `tsc`/`lint` verdes; migrations você aplica manual no Supabase.
