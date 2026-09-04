# Integração Pipefy → Make → Supabase (Financeiro)

> ## 🔴 SUPERADO EM 04/set/2026 — este cenário sai do ar
>
> A ingestão passou a ser **sob demanda**: o painel ganhou um botão **Atualizar** e o Blue Desk
> consulta o Pipefy por conta própria, sem Make. Motivo: cada cenário rodava 48×/dia e consumia
> ~2 operações por rodada mesmo quando o delta voltava vazio — ~11.500 ops/mês só de ociosidade
> entre os quatro. Ver [`ingestao-sob-demanda.md`](../../ingestao-docs/updates/ingestao-sob-demanda.md).
>
> **Este documento continua valendo como registro** do desenho, da query e do mapeamento — a
> query GraphQL daqui é a que a rota nova usa. O que mudou é quem chama e a partir de quando: a
> variável `since = now − 35min` deu lugar a uma marca d'água em `sync_state`, porque uma janela
> fixa de 35 minutos só funciona colada num agendamento fixo.
>
> ⚠️ **Desligue o cenário no Make só depois de validar o botão** (ver o checklist no doc novo).
> Os dois caminhos rodando juntos não duplicam nada — a ingestão é idempotente.


Clone do cenário do CS ([`make-integracao-cs.md`](../../painelcs-docs/updates/make-integracao-cs.md)),
apontando pro pipe **"2.0 - Financeiro"** (id `304386356`). É o que mantém as entradas do painel do
CEO atualizadas depois da carga histórica. **Montado pelo dono em 2026-07-31**; este doc segue como
referência da config.

> **Pré-requisitos — todos cumpridos em 31/jul:** migration
> [`20260731_financeiro_schema.sql`](../../../supabase/migrations/20260731_financeiro_schema.sql)
> aplicada · `npm run import:financeiro` rodado (4.549 cards → 5.348 pagamentos) ·
> `NEXT_PUBLIC_CEO_ENABLED=1`. A conferência `npm run verify:financeiro` bateu 100% depois da carga.

**Este cenário é mais simples que o do CS.** O Financeiro não tem série de movimentação: cada card é
um lançamento de pagamento. Nada de `phases_history`, `comments`, `assignees` ou `child_relations` —
só o card e os campos.

---

## O cenário (5 módulos)

```
Schedule (30min, 24/7) → GraphQL allCards (filtro delta) → Iterator (edges)
  → JSON: Transform to JSON (node) → HTTP POST rpc/ingest_financeiro_card
```

Aprendizados que valem aqui igual: mapear os campos do Make pelos **pills** (clicar), nunca digitar
`{{ }}` na mão; e o header `Content-Type: application/json` é obrigatório, senão o PostgREST devolve
`PGRST202`.

### 1. Schedule
`At regular intervals` · **Minutes 30** · sem Advanced scheduling (roda 24/7 — o delta deixa cada
rodada quase grátis fora do expediente).

### 2. GraphQL (app do Pipefy — Execute a GraphQL Query)
- **Operation Name**: `FinanceiroDelta`
- **Query** (idêntica à do backfill, `scripts/import-financeiro.mjs`, mais o filtro delta):
```graphql
query FinanceiroDelta($pipeId: ID!, $since: String!, $cursor: String) {
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
  | `pipeId` | `304386356` |
  | `since` | `{{formatDate(addMinutes(now; -35); "YYYY-MM-DDTHH:mm:ssZ")}}` |
  | `cursor` | *(vazio)* |

> A janela de 35 min pra um poll de 30 min é o overlap de segurança — reprocessar é inofensivo
> porque a RPC é idempotente (upsert por `pipefy_card_id` + as `fin_entries` do card são regeradas).

### 3. Iterator
- **Array**: `{{<GraphQL>.body.data.allCards.edges}}` — cada iteração é um `edge`; o card está em `.node`.

### 4. JSON → Transform to JSON
- **Object**: mapeia o **`node` inteiro** (clica no pill verde do Iterator; não digita).
- *Por quê:* sem isso o POST volta `PGRST102 Empty or invalid json`.

### 5. HTTP → Make a request
| Campo | Valor |
|---|---|
| Method | `POST` |
| URL | `https://wtkdyuhospcdkytcuxzu.supabase.co/rest/v1/rpc/ingest_financeiro_card` |
| Headers | `apikey`: *service_role* · `Authorization`: `Bearer` *service_role* |
| Body content type | `Raw` · Content type `application/json` |
| Request content | `{"node": {{<Transform to JSON>.json}}}` |

Retorno esperado (200): `{ "fin_card_id": "…", "entries": 1, "skipped": 0, "category": "Homologação" }`.

> ⚠ **service_role** (não anon). Vive só no Make — é ela que autoriza a escrita (a função é
> `SECURITY DEFINER` e ignora RLS; `authenticated` não tem permissão nenhuma nessas tabelas).

---

## O que a RPC garante (feito no banco)

O mapeamento de field-ids vive **só no SQL** — o Make e o backfill mandam o node cru e não conhecem
campo nenhum. Trocar um campo no mapeamento não exige mexer no cenário.

- **`entries`** — quantas linhas de pagamento o card gerou. Desde 10/ago é **0 ou 1**: um card, uma
  entrada, de `copy_of_valor_do_pagamento_bruto` ("Valor do Pagamento Líquido") +
  `data_do_pagamento`. Os campos de parcela **não são mais lidos** — ver
  [`financeiro-valor-liquido.md`](financeiro-valor-liquido.md). (Até 09/ago: uma linha por parcela
  nos cards de 2024/25 e uma de `valor_de_contrata_o` nos de 2026.)
- **`skipped` / `motivo`** — card que não virou entrada. `motivo = 'sem_liquido'` (o campo do
  líquido está vazio ou zerado — o card aparece no aviso `missingNet` da aba) ou `'sem_data'` (sem
  `data_do_pagamento`; a RPC não inventa data). Se esses números crescerem, é dado faltando no
  Pipefy, não bug.
- **Categoria** = `COALESCE` dos 3 campos de "referência" (Comercial / Negociação / Quitação).
- **Departamento normalizado**: `"Departamento - Jurídico"` (nome antigo) vira
  `"Departamento - Negociação"`.
- **Sinal**: desconto e devolução entram **negativos**; distrato e reversão, positivos.
- **Datas** em `DD/MM/YYYY` (é o que este pipe manda; `datetime_value` vem sempre `null`).
- **Idempotência**: upsert por `pipefy_card_id`; as `fin_entries` do card são apagadas e regeradas,
  então parcela removida no Pipefy some daqui também.

## Carga histórica

`scripts/import-financeiro.mjs` (`npm run import:financeiro`) — pagina o pipe inteiro e chama
`ingest_financeiro_card` com o node cru, mesmo caminho do Make. Precisa de `PIPEFY_TOKEN` +
`SUPABASE_SERVICE_ROLE_KEY` no `.env.local` (`FINANCEIRO_PIPEFY_PIPE_ID` default `304386356`).

Rodar **uma vez antes** de ligar o cenário agendado, pra não competir com o volume inicial
(~4.500 cards).

## Checklist do bootstrap — concluído em 31/jul

- ✅ Migration `20260731_financeiro_schema.sql` aplicada.
- ✅ `npm run import:financeiro` (carga histórica): 4.549 cards → 5.348 pagamentos, com as duas
  convenções presentes (`parcela` 3.212 · `card` 2.136).
- ✅ Cenário montado no Make.
- ✅ `NEXT_PUBLIC_CEO_ENABLED=1`.
- ✅ `npm run verify:financeiro`: 0 divergências card a card, 32/32 meses batendo.

## Monitorar daqui pra frente

O backfill deixou tudo em dia, então uma falha do cenário agendado não aparece na hora — o painel
só vai parando no tempo. Dois sinais baratos:

- **Frescor:** `SELECT max(synced_at) FROM public.fin_cards;` — se ficar horas parado em horário
  comercial, o cenário caiu.
- **Reconferir quando quiser:** `npm run verify:financeiro` é read-only e pode rodar a qualquer
  momento; ele relê o pipe inteiro e compara. É o mesmo comando do aceite.
