# Integração Pipefy → Make → Supabase

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


O cenário do Make que mantém o dashboard de leads sincronizado. **Está montado e no ar.**
O trabalho pesado (traduzir o card, registrar agentes, upsert, classificar fase, marcar
duplicado) roda **no banco** — o Make só busca os cards que mudaram e repassa o node cru.

> Pré-requisito: [`../../supabase/manual/leads_dashboard_setup.sql`](../../../supabase/manual/leads_dashboard_setup.sql)
> aplicado (tabelas + views + RPCs `ingest_lead_event` e `ingest_lead_card`).

---

## O cenário (5 módulos)

```
Schedule (30min, 24/7) → GraphQL allCards (filtro delta) → Iterator (edges)
  → JSON: Transform to JSON (node) → HTTP POST rpc/ingest_lead_card
```

Por que assim:
- **Poll agendado, não webhook** — o Pipefy cobra a GraphQL por requisição; puxar só o delta a cada 30 min é barato e simples.
- **Filtro delta** (`updated_at >= now-35min`) — evita re-varrer as ~142 páginas de 4.247 cards toda rodada; traz só o que mudou (normalmente < 1 página, ~poucos cards).
- **24/7** — como o delta deixa cada rodada baratíssima (fora de expediente volta ~0 card), rodar o dia todo fecha o furo de leads que entram de madrugada / fim de semana. Sem restrição de horário, o `now-35min` sempre cobre o gap de 30 min.
- **`ingest_lead_card(node)`** — o Make manda o node cru; a tradução (campos por id, responsáveis, classificação) é feita em SQL. Assim não se monta payload no Make.

### 1. Schedule
`At regular intervals` · **Minutes 30** · **sem** Advanced scheduling (roda 24/7).

### 2. GraphQL (app do Pipefy — Execute a GraphQL Query)
- **Operation Name**: `LeadsDelta`
- **Query**:
```graphql
query LeadsDelta($pipeId: ID!, $since: String!, $cursor: String) {
  allCards(pipeId: $pipeId, first: 50, after: $cursor,
           filter: { field: "updated_at", operator: gte, value: $since }) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id title created_at updated_at finished_at done
      current_phase { id name }
      assignees { id name email }
      fields { value array_value datetime_value field { id } }
    } }
  }
}
```
- **Variables** (Map desligado, Add item — o `since` aceita fórmula):
  | Key | Value |
  |---|---|
  | `pipeId` | `307104305` |
  | `since` | `{{formatDate(addMinutes(now; -35); "YYYY-MM-DDTHH:mm:ssZ")}}` |
  | `cursor` | *(vazio)* |
  - Com **Map ligado**, o formato é array de pares: `[{ "key": "pipeId", "value": "307104305" }, …]` (não objeto `{}`).

### 3. Iterator
- **Array**: `{{<GraphQL>.body.data.allCards.edges}}` — cada iteração é um `edge`; o card está em `.node`.

### 4. JSON → Transform to JSON
- **Object**: mapeia o **`node` inteiro** (clica no pill verde do Iterator; não digita).
- Saída: campo `json` (o node já serializado como texto JSON válido).
- *Por quê:* o Make **não serializa** um objeto aninhado num body raw — sem isso o POST volta `PGRST102 Empty or invalid json`.

### 5. HTTP → Make a request
| Campo | Valor |
|---|---|
| Method | `POST` |
| URL | `https://wtkdyuhospcdkytcuxzu.supabase.co/rest/v1/rpc/ingest_lead_card` |
| Headers | `apikey`: *service_role* · `Authorization`: `Bearer` *service_role* |
| Body content type | `Raw` · Content type `application/json` |
| Request content | `{"node": {{<Transform to JSON>.json}}}` |

Retorno esperado (200): `{ "lead_id": "…", "agent_id": "…", "duplicate": false }`.

> ⚠ **service_role** (não anon). Vive só no Make. É ela que autoriza a escrita (a função ignora RLS).

---

## Paginação (só se precisar)
Com o delta, quase sempre cabe em 1 página (50 cards). Se numa rodada mudarem **>50**, aí sim
adicionar o loop: repetir a query passando `pageInfo.endCursor` no `cursor` enquanto `hasNextPage=true`.
No volume normal de 30 min, não é necessário.

## Custo (o que otimizamos)
- Sem filtro: ~142 créditos Pipefy + milhares de ops Make **por rodada** (inviável).
- Com filtro delta: **1 requisição** + poucos POSTs por rodada. Rodada de teste real: **13 cards, 13 POSTs, todos 200**.
- Alternativa futura se o Make apertar: RPC em lote `ingest_lead_cards` (1 POST por página, sem Iterator).

---

## O que a RPC garante (feito no banco)
- **Responsável** = campo `respons_vel` (`array_value` = ids; `value` = nomes), email cruzado do `assignees`. Último = mais recente; 2+ → `duplicate_responsible`. Fallback: `assignees` se `respons_vel` vazio.
- **Classificação** produtiva × morta por `pipefy_phase_id` (lookup `lead_phases`).
- **Campos por id** (estável, não label): `nome`, `capta_o_do_lead` (canal), `1_acionamento_hora.datetime_value` (1º contato), `motivo_descarte`/`informe_o_motivo*` (descarte).
- **Idempotência**: upsert por `pipefy_card_id` + dedup de evento por (`card_id`, `to_phase_id`, `occurred_at`) — reprocessar no overlap não duplica.
- **Poll**: `from_phase` fica `null` (não sabe a fase anterior); `occurred_at` = `updated_at`.

## Assunção a confirmar
> **"Mais recente" = último elemento de `respons_vel`.** Se no Pipefy for o *primeiro*, trocar
> `jsonb_array_length - 1` → `0` no `ingest_lead_event`.

## Carga histórica (one-time, já feito)
`scripts/import-leads.mjs` (`npm run import:leads`) faz a mesma coisa em lote, direto do repo
(GraphQL paginado → `ingest_lead_card`). Precisa de `PIPEFY_TOKEN` + `SUPABASE_SERVICE_ROLE_KEY` no `.env.local`.
