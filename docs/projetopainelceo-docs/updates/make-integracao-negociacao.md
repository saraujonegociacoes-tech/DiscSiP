# Integração Pipefy → Make → Supabase (Negociação)

Clone do cenário do Financeiro ([`make-integracao-financeiro.md`](make-integracao-financeiro.md)),
apontando pro pipe **"3.0 Negociação"** (id `304370275`). É o que mantém a aba **Projeções** do
painel do CEO atualizada depois da carga inicial. **Ainda não montado** — este doc é a receita.

> **Pré-requisitos:** migration
> [`20260731b_negociacao_schema.sql`](../../../supabase/migrations/20260731b_negociacao_schema.sql)
> aplicada · `npm run import:negociacao` rodado · `NEXT_PUBLIC_CEO_ENABLED=1` (já está).

**Este cenário é o mais simples dos três.** A Negociação não tem série de movimentação nem conexões
a puxar: cada card é um contrato, e o que interessa é o estado atual dele (fase + campos). Nada de
`phases_history`, `comments`, `assignees` ou `child_relations`.

> ⚠️ **Sobre `child_relations` — não puxe.** É tentador, porque a fase tem o conector "Lançar
> pagamento". Mas ele aponta para o pipe do **Financeiro** (`304386356`), que **já é ingerido pelo
> outro cenário**. Trazer as conexões aqui seria o caminho mais curto pra contar o mesmo dinheiro
> duas vezes entre as abas Financeiro e Projeções. Esta vertical traz **só projeção**.

---

## O cenário (5 módulos)

```
Schedule (30min, 24/7) → GraphQL allCards (filtro delta) → Iterator (edges)
  → JSON: Transform to JSON (node) → HTTP POST rpc/ingest_negociacao_card
```

Os mesmos dois aprendizados de sempre: mapear os campos do Make pelos **pills** (clicar), nunca
digitar `{{ }}` na mão; e o header `Content-Type: application/json` é obrigatório, senão o PostgREST
devolve `PGRST202`.

### 1. Schedule
`At regular intervals` · **Minutes 30** · sem Advanced scheduling (roda 24/7 — o delta deixa cada
rodada quase grátis fora do expediente).

### 2. GraphQL (app do Pipefy — Execute a GraphQL Query)
- **Operation Name**: `NegociacaoDelta`
- **Query** (idêntica à do backfill, `scripts/import-negociacao.mjs`, mais o filtro delta):
```graphql
query NegociacaoDelta($pipeId: ID!, $since: String!, $cursor: String) {
  allCards(pipeId: $pipeId, first: 50, after: $cursor,
           filter: { field: "updated_at", operator: gte, value: $since }) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id title created_at updated_at done
      current_phase { id name }
      fields { name value array_value datetime_value field { id } }
    } }
  }
}
```
- **Variables** (Map desligado, Add item):
  | Key | Value |
  |---|---|
  | `pipeId` | `304370275` |
  | `since` | `{{formatDate(addMinutes(now; -35); "YYYY-MM-DDTHH:mm:ssZ")}}` |
  | `cursor` | *(vazio)* |

> A janela de 35 min pra um poll de 30 min é o overlap de segurança — reprocessar é inofensivo
> porque a RPC é idempotente (upsert por `pipefy_card_id`).

### 3. Iterator
- **Array**: `{{<GraphQL>.body.data.allCards.edges}}` — cada iteração é um `edge`; o card está em `.node`.

### 4. JSON → Transform to JSON
- **Object**: mapeia o **`node` inteiro** (clica no pill verde do Iterator; não digita).
- *Por quê:* sem isso o POST volta `PGRST102 Empty or invalid json`.

### 5. HTTP → Make a request
| Campo | Valor |
|---|---|
| Method | `POST` |
| URL | `https://wtkdyuhospcdkytcuxzu.supabase.co/rest/v1/rpc/ingest_negociacao_card` |
| Headers | `apikey`: *service_role* · `Authorization`: `Bearer` *service_role* |
| Body content type | `Raw` · Content type `application/json` |
| Request content | `{"node": {{<Transform to JSON>.json}}}` |

Retorno esperado (200):
`{ "neg_card_id": "…", "projected": true, "proj_source": "parcela2", "paid": false }`.

> ⚠ **service_role** (não anon). Vive só no Make — é ela que autoriza a escrita (a função é
> `SECURITY DEFINER` e ignora RLS; `authenticated` não tem permissão nenhuma nessas tabelas).

---

## ⚠️ O gatilho: mudança de FASE é o evento que importa aqui

No Financeiro o evento é "card novo com pagamento". **Aqui é o card MUDAR DE FASE** — uma projeção
nasce quando o card entra em `326422800` e morre quando ele sai ou é marcado como pago.

Mover um card de fase **mexe no `updated_at`**, então o filtro de delta pega. Mas vale saber que é
disso que a aba depende: se um dia a projeção ficar "presa" mostrando card que já saiu da fase, o
suspeito é o poll, não a RPC.

> Se isso virar problema, a saída é a mesma que o CS usou pro balde de pagamento: pollar a **fase
> `326422800` inteira, sem filtro de delta**, a cada rodada (são 14 cards — é barato).

## O que a RPC garante (feito no banco)

O mapeamento de field-ids vive **só no SQL** — o Make e o backfill mandam o node cru e não conhecem
campo nenhum. Trocar o mapeamento (ou a regra de qual sinal vira projeção) não exige mexer no cenário.

- **`projected`** — o card entrou na projeção do painel? Só é `true` com as três coisas juntas:
  está na **fase de espera** (`326422800`), **não** está marcado como pago, e tem valor + data.
- **`proj_source`** — de qual sinal a projeção saiu:
  - `fase` — `informe_o_valor_do_pagamento` + `informe_a_data_agendada_para_o_pagamento_1`
    (o pagamento combinado agora). Tem prioridade.
  - `parcela2` — `valor_do_pagamento_da_2_parcela` + a data da 2ª parcela.
  - É **COALESCE, não soma**: os dois não são dívidas somáveis (ver a migration).
- **`paid`** — `o_pagamento_foi_reaizado = 'Sim'`. **É o filtro anti-dupla-contagem**, e ele carrega
  peso: em 24/24 cards conferidos, esse flag equivale exatamente a "tem conexão com o Financeiro".
  Sem ele a projeção infla 74% (R$ 17.398,60 em vez de R$ 10.000,00, medido em 03/ago).
- **Datas** — a RPC lê **sempre o `value`** (`DD/MM/YYYY` ou `DD/MM/YYYY HH:MM`), **nunca o
  `datetime_value`**, que vem em UTC e joga 8,2% dos cards no dia seguinte. O `datetime_value`
  continua sendo gravado no `metadata`, mas não é usado pra data.
- **Idempotência**: upsert por `pipefy_card_id`.

## Carga inicial

`scripts/import-negociacao.mjs` (`npm run import:negociacao`) — pagina o pipe inteiro (3.342 cards)
e chama `ingest_negociacao_card` com o node cru, mesmo caminho do Make. Precisa de `PIPEFY_TOKEN` +
`SUPABASE_SERVICE_ROLE_KEY` no `.env.local` (`NEGOCIACAO_PIPEFY_PIPE_ID` default `304370275`).

Rodar **uma vez antes** de ligar o cenário agendado.

## Checklist do bootstrap

- [ ] Migration `20260731b_negociacao_schema.sql` aplicada.
- [ ] `npm run import:negociacao` (carga inicial): ~3.342 cards, com os dois sinais presentes.
- [ ] `npm run verify:negociacao`: 0 divergências card a card, total batendo com a prévia.
- [ ] Cenário montado no Make.

## Monitorar daqui pra frente

- **Frescor:** `SELECT max(synced_at) FROM public.neg_cards;` — se ficar horas parado em horário
  comercial, o cenário caiu.
- **Reconferir quando quiser:** `npm run verify:negociacao` é read-only e pode rodar a qualquer
  momento; ele relê o pipe inteiro e compara card a card. É o mesmo comando do aceite.
- **O número que denuncia regressão de fuso:** o verify imprime quantos campos têm o dia local
  diferente do `datetime_value`. Esse número é informativo — o que não pode acontecer é
  "divergências card a card" sair de 0.

## Referências

- [`introspeccao-pipefy-negociacao.md`](introspeccao-pipefy-negociacao.md) — o mapeamento e os
  achados que explicam cada regra acima.
- [`make-integracao-financeiro.md`](make-integracao-financeiro.md) — o cenário irmão (e o pipe pra
  onde o realizado da Negociação vai).
- [`make-integracao-cs.md`](../../painelcs-docs/updates/make-integracao-cs.md) — o cenário original.
