# `supabase/manual/` — scripts consolidados (NÃO são migrations)

Dois arquivos que o repo perdeu em 10/jul/2026 (commit `bf62847`, "chore: remover
supabase/ do repo") e que voltaram em 04/ago/2026 junto com as 21 migrations base — ver
[`../migrations/README.md`](../migrations/README.md).

Eles **não** entram na fila de execução por data. São scripts de setup do domínio de
leads, escritos para rodar de uma vez no SQL Editor.

| Arquivo | O que é | Já aplicado? |
|---|---|---|
| `leads_dashboard_setup.sql` | O schema de leads inteiro (tabelas + views + ingestão), equivalente às migrations `20260702_leads_pipefy.sql` + `20260702_leads_pipefy_views.sql` + `20260703_leads_pipefy_ingest.sql` juntas | Sim, desde jul/2026 — a base está no ar com ~5,2 mil leads |
| `ingest_lead_card.sql` | A RPC `ingest_lead_card(node)`, que o cenário do Make chama. Traduz o node cru do Pipefy e delega ao `ingest_lead_event` | Sim |

## ⚠️ `leads_dashboard_setup.sql` é DESTRUTIVO — não rode

Ele **dropa e recria** o schema de leads do zero. Rodar hoje apagaria os ~5,2 mil leads e
os ~9,3 mil eventos que estão no ar. Ele está aqui como **registro do que foi aplicado**,
não como algo a executar.

Isso importa neste repositório em particular: as migrations são aplicadas **à mão**, sem
registro de quais já rodaram, e já aconteceu de um arquivo antigo ser reexecutado e desfazer
uma correção em silêncio (`neg_is_waiting_phase`, 03/ago — ver
[`../migrations/Migrations_projetopainelceo/20260803_negociacao_fase_unica.sql`](../migrations/Migrations_projetopainelceo/20260803_negociacao_fase_unica.sql)).
A diferença é que lá o estrago era um número errado; aqui seria a perda dos dados.

Para alterar o schema de leads hoje, escreva uma **migration nova e incremental** em
`../migrations/Migrations_painelleads/`, como fizeram `20260706_leads_sla.sql` e as
seguintes.

`ingest_lead_card.sql` é `CREATE OR REPLACE` de uma função e pode ser reaplicado sem risco —
mas confira antes se alguma migration posterior redefiniu a mesma função, porque quem roda
por último vence.
