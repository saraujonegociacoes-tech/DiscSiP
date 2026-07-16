# Integração Pipefy → Make → Supabase (Sucesso do Cliente)

Mesmo desenho do cenário do comercial ([`../docs_dashboard_pipefy/make-integracao-pipefy.md`](../docs_dashboard_pipefy/make-integracao-pipefy.md)),
apontando pro pipe de CS. **Ainda não montado no Make** — este doc é o roteiro pra montar.

> Pré-requisito: migration [`20260715_cs_pipeline_schema.sql`](../../supabase/migrations/20260715_cs_pipeline_schema.sql)
> aplicada (tabelas + RPCs `ingest_cs_card`/`ingest_cs_event`).

---

## O cenário (5 módulos)

```
Schedule (30min, 24/7) → GraphQL allCards (filtro delta) → Iterator (edges)
  → JSON: Transform to JSON (node) → HTTP POST rpc/ingest_cs_card
```

Mesma razão de ser do cenário do comercial: poll agendado (não webhook) com filtro
delta pra manter a chamada GraphQL barata, rodando 24/7 porque o delta deixa cada
rodada praticamente grátis fora do expediente.

**Diferença em relação ao comercial:** aqui o Make manda o **node inteiro** pra
`ingest_cs_card` e a RPC guarda **todos os campos** em `cs_cards.metadata` (decisão do
dono, por causa da variedade de campos por fase — 24 fases mensais com ids de campo
diferentes cada uma). Não existe um `ingest_cs_card` fazendo mapeamento seletivo de
campo por campo, como o comercial faz com `respons_vel`/`capta_o_do_lead`/etc.

### 1. Schedule
`At regular intervals` · **Minutes 30** · sem Advanced scheduling (roda 24/7).

### 2. GraphQL (app do Pipefy — Execute a GraphQL Query)
- **Operation Name**: `CsDelta`
- **Query**:
```graphql
query CsDelta($pipeId: ID!, $since: String!, $cursor: String) {
  allCards(pipeId: $pipeId, first: 50, after: $cursor,
           filter: { field: "updated_at", operator: gte, value: $since }) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id title created_at updated_at finished_at done
      current_phase { id name }
      assignees { id name email }
      fields { name value array_value datetime_value field { id } }
    } }
  }
}
```
- **Variables** (Map desligado, Add item):
  | Key | Value |
  |---|---|
  | `pipeId` | `305801110` |
  | `since` | `{{formatDate(addMinutes(now; -35); "YYYY-MM-DDTHH:mm:ssZ")}}` |
  | `cursor` | *(vazio)* |

### 3. Iterator
- **Array**: `{{<GraphQL>.body.data.allCards.edges}}` — cada iteração é um `edge`; o card está em `.node`.

### 4. JSON → Transform to JSON
- **Object**: mapeia o **`node` inteiro** (clica no pill verde do Iterator; não digita).
- *Por quê:* mesmo motivo do comercial — sem isso o POST volta `PGRST102 Empty or invalid json`.

### 5. HTTP → Make a request
| Campo | Valor |
|---|---|
| Method | `POST` |
| URL | `https://wtkdyuhospcdkytcuxzu.supabase.co/rest/v1/rpc/ingest_cs_card` |
| Headers | `apikey`: *service_role* · `Authorization`: `Bearer` *service_role* |
| Body content type | `Raw` · Content type `application/json` |
| Request content | `{"node": {{<Transform to JSON>.json}}}` |

Retorno esperado (200): `{ "cs_card_id": "…", "agent_id": "…", "duplicate": false }`.

> ⚠ **service_role** (não anon). Vive só no Make. É ela que autoriza a escrita (a
> função ignora RLS).

---

## O que a RPC garante (feito no banco)
- **Responsável** = último elemento de `assignees` quando há 2+ (mesma assunção do
  comercial — "mais recente" = último; a confirmar. Se estiver errado, trocar
  `jsonb_array_length - 1` → `0` em `ingest_cs_card`).
- **Metadata** = todos os campos do card, por field-id (`{name, value, array_value,
  datetime_value}`), decisão do dono de ingerir tudo em vez de selecionar campos.
- **Idempotência**: upsert por `pipefy_card_id` + dedup de evento por (`pipefy_card_id`,
  `to_phase_id`, `occurred_at`).
- **Poll**: `from_phase` vem do que já estava salvo (não do node); `occurred_at` =
  `updated_at`.

## Carga histórica
`scripts/import-cs-cards.mjs` (`npm run import:cs-cards`) — pagina o Pipefy e chama
`ingest_cs_card` com o node cru, mesmo caminho do Make (sem duplicar mapeamento de
campo em JS, ao contrário do `import-leads.mjs`). Precisa de `PIPEFY_TOKEN` +
`SUPABASE_SERVICE_ROLE_KEY` no `.env.local` (`CS_PIPEFY_PIPE_ID` já tem default
`305801110`).

## Pendências antes de montar no Make
- Confirmar a assunção de "responsável = último assignee" com um caso real de card com
  2+ assignees.
- Rodar `npm run import:cs-cards` uma vez (carga histórica) antes de ligar o cenário
  agendado, pra não competir com o volume inicial.
