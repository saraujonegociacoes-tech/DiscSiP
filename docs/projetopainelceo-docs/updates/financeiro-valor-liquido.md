# Financeiro: a entrada passa a ser o **Valor do Pagamento Líquido**

> Pedido do dono em **10/ago/2026**: "o painel do CEO está puxando do financeiro o campo
> *Valor que o cliente pagou* mas eu quero que mude para *Valor do Pagamento Líquido*".
> Implementado em
> [`20260810_financeiro_valor_liquido.sql`](../../../supabase/migrations/Migrations_projetopainelceo/20260810_financeiro_valor_liquido.sql).
>
> ⚠️ **Mexe no histórico inteiro da aba Financeiro e, por tabela, na Saúde da Equipe** (as duas
> leem o mesmo `fin_entries`). Os números de 2024/2025 mudam de valor **e de mês**. Leia
> "O que muda no histórico" antes de comparar com qualquer print antigo.

## Os dois campos

| Rótulo no Pipefy | field-id | Papel |
|---|---|---|
| "Valor que o Cliente Pagou?" | `valor_de_contrata_o` | era a entrada do painel; agora só contexto (`fin_cards.paid_value`) |
| **"Valor do Pagamento Líquido"** | **`copy_of_valor_do_pagamento_bruto`** | **é a entrada do painel** (`fin_cards.net_value`) |

O field-id diz **bruto** e o rótulo diz **líquido**. Não é engano de leitura: o campo nasceu
de um `copy_of` no Pipefy e o id ficou com o nome do original. **O rótulo é que vale** — já
estava assim desde a introspecção de 31/jul
([`introspeccao-pipefy-financeiro.md`](introspeccao-pipefy-financeiro.md)), e a coluna
`net_value` sempre foi ingerida; ela só não era usada para somar.

Consequência boa: **nenhum dado novo precisou ser buscado no Pipefy.** A migration regerou
`fin_entries` a partir do que já estava no banco.

## A segunda mudança: um card = uma entrada

O líquido é **um número por card**. Não existe líquido por parcela. Os cards de 2024/2025
guardam até 4 pagamentos no mesmo card (`informe_o_valor_pago_referente_a_N_parcela`), com
datas em meses diferentes — foi por isso que `fin_entries` nasceu como tabela-filha.

Perguntado sobre isso, o dono decidiu: **"pegue apenas o campo de valor líquido de cada card,
ignorando o valor das parcelas"**. Então:

- os campos de parcela **deixaram de ser lidos** pela ingestão;
- cada card gera **uma** linha: `net_value` + `data_do_pagamento`;
- `fin_entries.source` agora é sempre `'liquido'` (antes: `'card'` ou `'parcela'`).

A alternativa descartada era ratear o líquido entre as parcelas — ela manteria os meses, mas o
valor de cada parcela passaria a ser **calculado**, não lido do Pipefy.

## O que muda no histórico (medido na base em 10/ago, 4.609 cards)

| | antes (valor pago + parcelas) | depois (líquido) |
|---|---|---|
| entradas em `fin_entries` | 5.398 | **4.591** |
| total histórico (33 meses) | R$ 7.419.648,70 | **R$ 5.924.936,20** |
| jul/2026 | R$ 185.404,52 (161) | **R$ 174.727,19 (161)** |
| ago/2026 (parcial) | R$ 108.176,66 (59) | **R$ 107.769,01 (59)** |

Duas leituras diferentes escondidas nessa tabela:

- **2026 é só troca de valor.** O ano inteiro já usava a convenção de 1 card por pagamento, então
  a contagem de entradas não muda — só o número, que cai porque o líquido é menor ou igual ao pago.
- **2024/2025 é redistribuição.** 516 cards têm parcelas em meses diferentes e **796 entradas
  mudam de mês**: o dinheiro todo passa a cair no mês da `data_do_pagamento` do card. Um card que
  somava 3 parcelas agora soma um líquido só — daí a queda de R$ 1,49 mi no acumulado.

**Isso é esperado, não é bug.** Quem comparar a aba com um print de antes de 10/ago vai encontrar
meses antigos diferentes.

## Líquido vazio: fica de fora, mas aparece na tela

Decisão do dono no mesmo dia: **card sem líquido não gera entrada** (o painel mostra o líquido,
sem substituto) — **e o painel avisa** quais são. A RPC devolve `missingNet`, e a aba mostra um
bloco com o card, o valor que ele declara em outro campo e o link do Pipefy.

Hoje são **7 cards em toda a base** (8 com líquido zerado, 1 deles sem valor nenhum em lugar
algum). Os três de 2026:

```
#1331093662  03/04/2026  pago R$  7.500,00   CLAUDIA RODRIGUES
#1347089664  06/05/2026  pago R$ 14.000,00   DOMINGOS SOUZA COELHO
#1366831075  05/06/2026  pago R$    600,00   Robson Felipe Dos Santos Bezerra
```

Preenchido o campo no Pipefy, o card entra sozinho na próxima sincronização — o aviso é
pendência de cadastro, não erro de ingestão.

## Também em 10/ago: saiu o aviso de duplicidade

Pedido do dono no mesmo dia — **tirar o bloco de "possíveis lançamentos em duplicata"** do fim da
aba. Como a chave `duplicates` não tinha mais nenhum leitor, o agrupamento saiu da RPC junto, em vez
de virar payload calculado a cada carga e descartado.

O que **não** mudou: nunca houve dedupe automático, e a regra que o alerta implementava continua
registrada (mesmo contrato + mesmo valor + mesma categoria + mesmo dia; contrato repetido com
categorias diferentes é lançamento legítimo). **Para trazer de volta**, o SQL está íntegro em
[`20260805c_financeiro_serie_por_ciclo.sql`](../../../supabase/migrations/Migrations_projetopainelceo/20260805c_financeiro_serie_por_ciclo.sql)
— é copiar a CTE `duplicados` e a chave `duplicates` de lá.

## O que foi tocado

| Arquivo | O quê |
|---|---|
| [`20260810_financeiro_valor_liquido.sql`](../../../supabase/migrations/Migrations_projetopainelceo/20260810_financeiro_valor_liquido.sql) | `ingest_financeiro_card` (entrada = líquido), rebuild de `fin_entries`, `get_ceo_financeiro` (+`missingNet`, −`duplicates`), helper `fin_valor_parcelas` |
| [`CeoFinanceiro.tsx`](../../../src/features/ceo/components/CeoFinanceiro.tsx) | bloco de aviso "sem valor líquido" + textos da aba; **saiu** o bloco de duplicidade |
| [`ceo.ts`](../../../src/app/actions/ceo.ts) · [`database.ts`](../../../src/lib/types/database.ts) | `missingNet` / `missingNetTotal` no contrato da action; `CeoFinanceiroDuplicate` removido |
| [`verify-financeiro.mjs`](../../../scripts/verify-financeiro.mjs) | conferência reimplementa a regra nova + lista os cards sem líquido |
| [`import-financeiro.mjs`](../../../scripts/import-financeiro.mjs) | resumo passa a distinguir `sem_liquido` de `sem_data` |

**Não precisou mexer** no cenário do Make: ele manda o node cru para a mesma RPC, e o mapeamento
de field-ids vive só no SQL.

## Aplicar

1. Rodar a migration no SQL editor do Supabase. Ela **já regenera** `fin_entries` — não é preciso
   `npm run import:financeiro` (o backfill continua válido, só é mais lento).
2. Conferir com as queries do rodapé da migration.
3. `npm run verify:financeiro` — as contagens por mês devem bater com o Pipefy recomputado pela
   regra nova, e a seção **2b** lista os cards sem líquido.
4. Abrir a aba com sessão de `ceo`/`admin` (só o dono consegue: a guarda exige sessão real).

## Duas coisas que ficaram de fora de propósito

- **A aba de Projeções não muda.** Ela projeta o que ainda não entrou (`neg_cards` + plano do CS);
  não existe "líquido" antes do pagamento acontecer.
- **O CS continua com `valor_de_contrata_o`.** O campo "Valor que o Cliente Pagou?" ainda é o que
  o painel de CS lê para pagamento realizado (`CsPagamentoRealizado`) — o pedido foi sobre o painel
  do CEO, e mudar o CS junto seria decisão que ninguém tomou.

## Referências

- [`introspeccao-pipefy-financeiro.md`](introspeccao-pipefy-financeiro.md) — mapeamento do pipe e
  a origem do nome "bruto" no id.
- [`painel-ceo-indice.md`](painel-ceo-indice.md) — estado do painel.
- [`make-integracao-financeiro.md`](make-integracao-financeiro.md) — o cenário que alimenta a RPC.
