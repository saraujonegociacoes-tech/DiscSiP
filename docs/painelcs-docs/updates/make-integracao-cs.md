# Integração Pipefy → Make → Supabase (Sucesso do Cliente)

Mesmo desenho do cenário do comercial ([`make-integracao-pipefy.md`](../../painelleads-docs/updates/make-integracao-pipefy.md)),
apontando pro pipe de CS. **Montado e testado no Make em 2026-07-23** — a RPC `ingest_cs_card`
retornou `200 {"cs_card_id":…,"duplicate":false}` (6 cards na primeira rodada). Este doc segue
como referência da config. Aprendizados do bootstrap: **(1)** mapear os campos do Make pelos
**pills** (clicar), nunca digitar `{{ }}` na mão — Iterator `Array` = pill de
`allCards.edges`, Transform `Object` = pill do `node` do Iterator, HTTP body =
`{"node": {{<Transform>.json}}}` (texto + 1 pill, sem wrapper); **(2)** header
`Content-Type: application/json` obrigatório, senão o PostgREST devolve `PGRST202`.

> **Atualizado em 2026-07-21 (reformulação do painel).** O cenário agora precisa alimentar
> a página de **Equipe** (série temporal): além do card e das transições de fase, passa a
> capturar **comentários** (base de `atualização = comentário`) e a RPC passa a **snapshotar
> os 5 campos de negociação** pra detectar update relevante. Ver
> [`painel-sucesso-cliente-cs.md`](painel-sucesso-cliente-cs.md).

> Pré-requisito: migration [`20260715_cs_pipeline_schema.sql`](../../../supabase/migrations/20260715_cs_pipeline_schema.sql)
> aplicada **+ a migration nova da reformulação** (tabela `cs_card_comments`, snapshot de
> negociação, e a RPC `ingest_cs_card` estendida — a criar).

---

## O cenário (5 módulos — config quase inalterada)

```
Schedule (30min, 24/7) → GraphQL allCards (filtro delta) → Iterator (edges)
  → JSON: Transform to JSON (node) → HTTP POST rpc/ingest_cs_card
```

Poll agendado (não webhook) com filtro delta pra manter a chamada GraphQL barata, rodando
24/7 porque o delta deixa cada rodada praticamente grátis fora do expediente.

**A grande diferença da reformulação:** o Make continua mandando **o node inteiro** pra
`ingest_cs_card` — a config dos módulos quase não muda. O que muda é: **(1)** a query passa
a pedir `comments {}` dentro do node, e **(2)** a RPC (no banco) faz mais coisa com esse
node (persiste comentários + snapshot de negociação). Nenhum módulo novo no Make.

### 1. Schedule
`At regular intervals` · **Minutes 30** · sem Advanced scheduling (roda 24/7).

### 2. GraphQL (app do Pipefy — Execute a GraphQL Query)
- **Operation Name**: `CsDelta`
- **Query** (agora com `comments`):
```graphql
query CsDelta($pipeId: ID!, $since: String!, $cursor: String) {
  allCards(pipeId: $pipeId, first: 50, after: $cursor,
           filter: { field: "updated_at", operator: gte, value: $since }) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id title created_at updated_at finished_at done
      current_phase { id name }
      phases_history { phase { id } lastTimeIn }
      assignees { id name email }
      fields { name value array_value datetime_value field { id } }
      comments { id text created_at author_name author { id name } }
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

> Nota: `comments` traz **todos** os comentários do card a cada poll — a dedup mora na RPC
> (por `pipefy_card_id` + `created_at` + hash do texto), então reprocessar no overlap do
> delta não duplica.

### 3. Iterator
- **Array**: `{{<GraphQL>.body.data.allCards.edges}}` — cada iteração é um `edge`; o card está em `.node`.

### 4. JSON → Transform to JSON
- **Object**: mapeia o **`node` inteiro** (clica no pill verde do Iterator; não digita).
- *Por quê:* sem isso o POST volta `PGRST102 Empty or invalid json`.

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

**Já implementado (Sprint 1):**
- **Responsável** = último elemento de `assignees` quando há 2+ (a confirmar; se errado,
  trocar `jsonb_array_length - 1` → `0` em `ingest_cs_card`).
- **Metadata** = todos os campos do card, por field-id.
- **Transição de fase** = grava evento em `cs_card_events` **só quando `phase_id` muda**
  (compara por id, não por nome — rename de fase não vira transição falsa). `occurred_at`
  = `updated_at` do card. Esta é a base de "movido no ciclo" da página de Equipe.
- **Idempotência**: upsert por `pipefy_card_id` + dedup de evento.

**Reformulação — Página 1 (migration `20260721_cs_age_windows.sql`, já implementado):**
- **Tempo real na fase** → a query passa a pedir `phases_history { phase { id } lastTimeIn }`
  e a RPC grava `cs_cards.current_phase_entered_at` = `lastTimeIn` da fase atual. A matriz
  Fase × Tempo na fase usa isso (dwell = `now − current_phase_entered_at`). Sem esse campo o
  dwell caía em `updated_at` (evento sintético do backfill) — bug. **Re-rodar o backfill**
  depois de aplicar a migration pra popular os cards existentes.

**Reformulação — Página 2 (migration `20260722_cs_team.sql`, implementado):**
- **Comentários** → upsert em `cs_card_comments` (dedup por `pipefy_card_id` +
  `created_at` + hash do texto). Base de `atualização = comentário`. Guarda o autor
  (`author_name` + `author.id`) — decisão do dono: qualquer comentário conta como
  atualização, mas o autor fica registrado pra drill-down.
- **Snapshot de negociação** → a cada ingestão, compara os 5 campos (Q.D, Q.A, P.A, P.P,
  P.V) com o último snapshot; grava a linha-base (1ª vez) ou quando **qualquer** valor
  mudou, em `cs_negotiation_snapshots` (valores + quais mudaram + `top_priority_changed`).
  Decisão do dono: **sem epsilon** — relevância pela ordem de prioridade (Q.D=1 … P.V=5),
  ajustável na leitura. Base do controle de negociação e do histórico de pagamento.
- **Troca de responsável** → registra em `cs_card_assignee_events` quando o assignee muda
  (ou num card novo já atribuído). Base de "cards recebidos no ciclo".
- **Fase nova tolerada** → `ingest_cs_card` faz upsert defensivo em `cs_phases` (evita
  quebra de FK quando o pipe ganha fase, ex.: "Aguardando pagamento").

## Vieses (camada de dashboard, NÃO de ingestão)

As regras de viés da Equipe ficam no cálculo do dashboard, não aqui — a ingestão grava
tudo cru:
- **"Aguardando pagamento": ignorar** entrada e saída no cálculo de movimento.
- **"Negociação": separar** do movimento geral (tem controle próprio).

Ver [`painel-sucesso-cliente-cs.md`](painel-sucesso-cliente-cs.md) — inclui as pendências
de reconciliar os ids dessas fases no pipe.

## Carga histórica
`scripts/import-cs-cards.mjs` (`npm run import:cs-cards`) — pagina o Pipefy e chama
`ingest_cs_card` com o node cru, mesmo caminho do Make. **Atualizar** pra incluir
`comments {}` na query quando a RPC estendida estiver pronta (senão o histórico de
comentário/negociação começa só quando o Make ligar). Precisa de `PIPEFY_TOKEN` +
`SUPABASE_SERVICE_ROLE_KEY` no `.env.local` (`CS_PIPEFY_PIPE_ID` default `305801110`).

## Pendências antes de montar no Make
- Aplicar a migration nova da reformulação (`cs_card_comments` + snapshot + RPC estendida).
- Confirmar "responsável = último assignee" com um caso real de card com 2+ assignees.
- Rodar `npm run import:cs-cards` uma vez (carga histórica) antes de ligar o cenário
  agendado, pra não competir com o volume inicial.
- Reconciliar os ids das fases "Aguardando pagamento" e "Negociação" no pipe.
