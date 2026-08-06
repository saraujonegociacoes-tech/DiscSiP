# Cards órfãos no Financeiro — R$ 8.000,00 de um card que não existe mais no Pipefy

> Encontrado em 2026-08-04, durante a conferência da Sprint 3. Afetava a **aba Financeiro em
> produção** (Sprint 1) e, por tabela, o bloco financeiro da aba Saúde da Empresa.
> **Não há correção de código**: a limpeza é um `DELETE` manual, e evitar a reincidência é
> uma decisão do dono, não um detalhe de implementação.
>
> ## ✅ LIMPO em 2026-08-05 pelo dono
>
> Os dois cards saíram de `fin_cards`. A prova é as duas conferências, que discordavam,
> passarem a dar o mesmo número:
>
> | | `verify:financeiro` (lê o Pipefy) | `verify:saude-empresa` (lê o banco) |
> |---|---|---|
> | julho, **antes** | R$ 185.404,52 (161) | R$ 185.404,**75** (**162**) |
> | julho, **depois** | R$ 185.404,52 (161) | R$ 185.404,**52** (**161**) |
> | agosto, depois | R$ 21.346,00 (11) | R$ 21.346,00 (11) |
>
> **É essa igualdade que atesta a limpeza** — foi a divergência entre as duas que revelou o
> problema, e é o desaparecimento dela que o fecha. O resto deste documento fica como
> registro do caso e da decisão que continua em aberto no fim.

## O sintoma

Duas conferências que deveriam concordar não concordaram:

| Script | Julho/2026 | O que ele lê |
|---|---|---|
| `npm run verify:financeiro` | R$ 185.404,52 em **161** pagamentos | o **Pipefy** |
| `npm run verify:saude-empresa` | R$ 185.404,75 em **162** pagamentos | o **banco** |

R$ 0,23 e um pagamento de diferença. Nenhum dos dois está errado: eles leem fontes
diferentes, e a fonte diverge.

## A causa

`fin_cards` tem **4.560** cards; o pipe do Financeiro tem **4.558**. Os dois excedentes
existem no Supabase e **não existem mais no Pipefy** — a API responde `Acesso negado`
(`PERMISSION_DENIED`) para os dois ids, a mesma resposta que o card apagado da Sprint 2
(`1421641222`, "teste filipe" do CS) devolvia.

```
1421643991 · "teste filipe"             · R$     0,23 · 29/07 · sincronizado 31/jul
1424109818 · "RICARDO DOS SANTOS SILVA" · R$ 8.000,00 · 03/08 · sincronizado 03/ago 20:14
```

Os dois estão na fase `326516174`, que **conta** (só `327456661`, "Pagamento cancelado",
fica de fora). Então os dois estão sendo somados na aba.

A mecânica já estava registrada como risco desde 03/ago, em
[`painel-ceo-sprints.md`](../updates/painel-ceo-sprints.md): a ingestão é `upsert` por
`pipefy_card_id` e o poll do Make só enxerga o que **existe**. Não há sincronização de
exclusão — card apagado no Pipefy fica no banco para sempre e continua contando. O que
mudou em 04/ago é que deixou de ser risco teórico.

## Por que este caso importa mais que o da Sprint 2

O card órfão da Sprint 2 era um teste de R$ 0,00 numa aba que ainda estava sendo montada.
Este é **R$ 8.000,00, com nome de cliente real, lançado ontem, numa aba que o CEO já usa**.

No mês corrente (agosto/2026, medido em 04/ago) o total do Financeiro é R$ 27.132,00 em 9
pagamentos. R$ 8.000,00 desses — **29,5%** — vêm do card órfão. Sem ele o mês seria
R$ 19.132,00.

⚠️ Vale a ressalva honesta: `Acesso negado` significa "este token não alcança este card".
Apagado é a explicação mais provável (é a mesma resposta do caso conhecido, e o card também
não voltou na varredura do pipe inteiro), mas mover para um pipe fora do alcance do token
produziria o mesmo erro. Em qualquer dos dois casos **o card não está mais no pipe do
Financeiro**, então não deveria estar somando na aba.

## Limpeza (manual, do dono)

Confira os dois cards no Pipefy antes — se o de R$ 8.000,00 foi apagado por engano, o certo
é recriá-lo lá, não apagar aqui.

```sql
-- Confere antes de apagar (deve trazer as 2 linhas descritas acima)
SELECT pipefy_card_id, title, paid_value, paid_date, current_phase_id
FROM public.fin_cards
WHERE pipefy_card_id IN ('1421643991', '1424109818');

-- Apaga. As fin_entries somem junto (FK ON DELETE CASCADE).
DELETE FROM public.fin_cards
WHERE pipefy_card_id IN ('1421643991', '1424109818');
```

Depois, `npm run verify:financeiro` e `npm run verify:saude-empresa` passam a dar o mesmo
número — é essa a conferência de que a limpeza funcionou.

## Como saber que voltou a acontecer

`npm run verify:financeiro` já mostra as duas contagens lado a lado (`cards no Pipefy` ×
`cards no banco`). **Banco > Pipefy = tem órfão.** Hoje ele não reprova por isso, só
informa — ele foi escrito para achar erro de *ingestão*, e órfão não é erro de ingestão.

⚠️ **Cuidado para não confundir com o caso inverso, que é normal.** Depois da limpeza, a
rodada de 05/ago acusou `faltando no banco: 1 → #1425148765` e terminou com "HÁ
DIVERGÊNCIAS ✗". Não é órfão nem erro: é **defasagem de ingestão**. O card
("Waldeir Siqueira Damasceno", R$ 665,00) tinha sido criado no Pipefy **duas horas antes**,
e o poll do Make ainda não tinha passado. Some sozinho na próxima rodada.

A regra para ler o número: **banco > Pipefy = órfão (age)** · **Pipefy > banco = poll
atrasado (espere)**. Os totais por mês continuaram idênticos justamente porque o card que
faltava ainda não tinha entrado em nenhum dos dois lados da soma.

## A decisão que fica em aberto

Fazer o backfill marcar `deleted_at` em quem não voltou na varredura completa resolveria de
vez. Mas isso torna o backfill **autoridade sobre exclusão**: uma varredura que falhe no
meio, ou um token que perca acesso a parte do pipe, apagaria dado bom. É decisão do dono, e
vale para os quatro domínios (`fin_cards`, `neg_cards`, `cs_cards`, `leads`) — hoje só o
Financeiro tem órfão (Negociação 3.344/3.344 e CS 1.492/1.492 batem exatamente).
