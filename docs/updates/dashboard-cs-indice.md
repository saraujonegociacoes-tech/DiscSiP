# Painel de Sucesso do Cliente (CS)

Índice da documentação do **painel de CS**. O código e os dados continuam em **domínio
separado** do discador e do dashboard de Leads (RLS, tabelas e RPCs próprios — ver
decisões abaixo) — só a documentação foi consolidada numa pasta só (`docs/updates/`),
junto com a do discador e a do Leads, porque os três já fazem parte do mesmo sistema em
construção (a discadora deixa de ser só "discadora" e vira o **Sistema da Araújo**; este
painel e o de Leads são os primeiros passos). Ver também
[`dashboard-leads-indice.md`](dashboard-leads-indice.md) (painel irmão) e
[`../links.md`](../links.md) (índice geral por domínio).

> **Estado (21/jul/2026): dashboard reformulado — começar do zero.** Sprint 0
> (navegação/permissões) e Sprint 1 (schema/ingestão, 1484 cards) entregues e válidas. O
> dashboard antigo (cards por fase / tempo em fase / contato periódico) foi **substituído**
> por um painel em **4 páginas** (Visão Geral+Janelas, Equipe, Minutas, Pagamentos+Insights),
> com ciclo 11→10 e filtros de período. Ver
> [`painel-sucesso-cliente-cs.md`](painel-sucesso-cliente-cs.md) pra a reformulação completa,
> o mapeamento de campos real e as pendências.

## Painel em 4 páginas (reformulação 2026-07-21)

| Aba | Página | Base de dado |
|---|---|---|
| 1 | **Visão Geral + Janelas** — pizza por idade do card (1-30/31-90/91-180/181+ dias), drill-down janela → responsável → lista com URL | Snapshot (pronto) |
| 2 | **Equipe** — movimentação por responsável no ciclo (movido c/ ou s/ comentário, só comentário, parado) + completude de negociação | **Série temporal — dado não existe ainda** |
| 3 | **Controle de Minutas** — URL/valor/resguardo/% desconto, buckets Vencidas/Mensal/Trimestral/Semestral + insights | Snapshot (pendente mapear "minuta") |
| 4 | **Pagamento + Insights** — projeções, quando/quanto vão pagar, histórico | Snapshot + série temporal |

> A **Equipe** depende de ingestão nova (comentários + histórico de campo) e do cenário do
> Make rodando — só acumula a partir de quando for ligada. As páginas 1, 3 e 4 rendem do
> snapshot atual. `atualização = comentário no card` (decisão do dono).

## Pipe Pipefy
- **Nome:** "3.3 - Customer Success" · **id:** `305801110`
- **Formato do funil:** Triagem → Apresentação → Negociação do Cliente → 24 fases
  mensais de acompanhamento (1° a 24° Mês) → saídas: Quitados, Concluído, Distratos,
  Acordos Vencidos, Arquivado (maior balde), Falta de Contato, Distribuição Processual,
  Pendente envio de carta de quitação. 35 fases no total — lista completa (ids +
  ordem) seedada na migration `20260715_cs_pipeline_schema.sql`.
- **Campos de negociação (base da reformulação):** os 5 campos que classificam uma
  negociação existem no `metadata` e estão ~70% preenchidos — Q.D
  (`q_d_valor_da_quita_o_com_desconto`), Q.A
  (`q_a_valor_da_quita_o_atualizada_sem_desconto`), P.A (`p_a_parcelas_em_atraso`), P.P
  (`p_p_parcelas_a_pagar`), P.V (`p_v_parcelas_vencer`). Mapeamento completo + prioridade
  em [`painel-sucesso-cliente-cs.md`](painel-sucesso-cliente-cs.md).
- **Superado:** o antigo "contato periódico" (campos `data_do_proximo_atendimento_N` por
  fase mensal) deixou de ser o eixo do painel na reformulação. Os campos continuam no
  `metadata` e podem servir a métricas futuras, mas não são mais prioridade.
- **Fases finais (sinal):** Quitado = **Bom**, Distratos = **Ruim**, Arquivado /
  Concluído / Distribuição = Neutro.

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
- **Ingestão nova (reformulação, a criar):** tabela `cs_card_comments` + snapshot dos 5
  campos de negociação (anti "update insignificante") + `ingest_cs_card` estendida. Base
  da página de Equipe. Detalhes em [`make-integracao-cs.md`](make-integracao-cs.md).

## Decisão de dado sensível
O pipe tem dado pessoal de clientes reais (CPF, RG, endereço, telefone, dados
financeiros) — é uma esteira de negociação de dívida. Decisão do dono: **ingerir tudo**
em `cs_cards.metadata` (jsonb, por field-id do Pipefy), em vez de selecionar só campos
operacionais. Por isso o RLS de `cs_cards`/`cs_card_events` é mais estrito que o de
`cs_phases`/`cs_agents`: só quem é do departamento de CS (ou manager/admin) lê qualquer
linha — ver a migration.
