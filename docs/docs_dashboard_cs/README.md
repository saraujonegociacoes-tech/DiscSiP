# Painel de Sucesso do Cliente (CS)

Silo de documentação do **painel de CS** — domínio **separado** do discador e do
dashboard de Leads (comercial). Nada aqui se mistura com as docs do discador
([`../reference`](../reference), [`../updates`](../updates), [`../fixes`](../fixes)) nem
com as do dashboard de leads ([`../docs_dashboard_pipefy`](../docs_dashboard_pipefy)).

> **Estado (15/jul/2026): Sprint 1 em andamento.** Sprint 0 (navegação/permissões)
> entregue — ver [`../updates/painel-sucesso-cliente-cs.md`](../updates/painel-sucesso-cliente-cs.md)
> pro roadmap completo em sprints e todas as decisões travadas.

## Pipe Pipefy
- **Nome:** "3.3 - Customer Success" · **id:** `305801110`
- **Formato do funil:** Triagem → Apresentação → Negociação do Cliente → 24 fases
  mensais de acompanhamento (1° a 24° Mês) → saídas: Quitados, Concluído, Distratos,
  Acordos Vencidos, Arquivado (maior balde), Falta de Contato, Distribuição Processual,
  Pendente envio de carta de quitação. 35 fases no total — lista completa (ids +
  ordem) seedada na migration `20260715_cs_pipeline_schema.sql`.
- **Achado importante:** o "contato periódico" já é rastreado por campos próprios em
  cada fase mensal (ex.: *"Data do atendimento"* / *"Data do [próximo] atendimento"*),
  não pela API de `activities`. O id desses campos muda a cada mês
  (`data_do_atendimento_1`, `_2`, `_3`...) — a Sprint 3 vai precisar de uma pequena
  tabela de mapeamento fase → campo (não dá pra hardcodar 24 ids na aplicação).

## Schema + ingestão (Sprint 1)
- [`../../supabase/migrations/20260715_cs_pipeline_schema.sql`](../../supabase/migrations/20260715_cs_pipeline_schema.sql) —
  tabelas `cs_phases`/`cs_agents`/`cs_cards`/`cs_card_events`, RLS (só CS + manager/admin
  enxergam qualquer linha; dentro do CS, agente vê o próprio, supervisor vê o
  departamento), RPCs `ingest_cs_card`/`ingest_cs_event`.
- [`make-integracao-cs.md`](make-integracao-cs.md) — cenário Pipefy → Make → Supabase
  (mesmo desenho do comercial, pipe diferente).
- `scripts/import-cs-cards.mjs` (`npm run import:cs-cards`) — carga histórica, manda o
  node cru do Pipefy pra `ingest_cs_card` (mesmo caminho do Make; field-mapping mora só
  no SQL, sem duplicar em JS).

## Decisão de dado sensível
O pipe tem dado pessoal de clientes reais (CPF, RG, endereço, telefone, dados
financeiros) — é uma esteira de negociação de dívida. Decisão do dono: **ingerir tudo**
em `cs_cards.metadata` (jsonb, por field-id do Pipefy), em vez de selecionar só campos
operacionais. Por isso o RLS de `cs_cards`/`cs_card_events` é mais estrito que o de
`cs_phases`/`cs_agents`: só quem é do departamento de CS (ou manager/admin) lê qualquer
linha — ver a migration.
