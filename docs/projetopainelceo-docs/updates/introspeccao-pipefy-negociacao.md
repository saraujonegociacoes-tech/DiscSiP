# Introspecção do pipe de Negociação (Pipefy) — resultado

> Criado e **executado** em 2026-08-03, com as mesmas queries de
> [`introspeccao-pipefy-financeiro.md`](introspeccao-pipefy-financeiro.md) trocando o `pipeId`.
> Destrava a metade "Negociação" do
> [Sprint 2](painel-ceo-sprints.md#sprint-2--projeções-de-pagamento-cs-reusado--negociação-novo).
> **O mapeamento está fechado**; o que falta são 3 decisões do dono, listadas no fim.

## Resultado — o pipe

**Pipe:** `304370275` — "3.0 Negociação" (org `301324031`, Araújo Negociações) →
`NEGOCIACAO_PIPEFY_PIPE_ID=304370275`. **3.342 cards**, 25 fases.

**O candidato alternativo está descartado.** `306994213` ("2.1 - Controle de Vendas") tem **0 cards
em todas as 8 fases** e nenhuma fase de "aguardando pagamento" — é um pipe montado e nunca usado.
Não há ambiguidade a resolver.

### A fase da projeção

**"Aguardando pagamento ⏳💰" — id `326422800`, 14 cards.** Campos próprios que interessam:

| Coluna | Field-id | Tipo | Preenchimento |
|---|---|---|---|
| `proj_value` | `informe_o_valor_do_pagamento` | `currency` | 8 dos 14 cards da fase (1.113 no pipe todo) |
| `proj_date` | `informe_a_data_agendada_para_o_pagamento_1` | **`datetime`** | 8 dos 14 (968 no pipe todo) |
| `proj_paid` | `o_pagamento_foi_reaizado` | `radio_vertical` (Sim/Não) | 9 dos 14 — *sic*, o id tem o typo ("reaizado") |
| `proj_method` | `forma_de_pagamento_do_cliente` | `radio_vertical` | 2 dos 14 |
| — | `lan_ar_pagamento` | `connector` | **aponta para o pipe Financeiro** — ver achado 1 |

### Contexto do card (start form)

| Coluna | Field-id | Tipo | Observação |
|---|---|---|---|
| `product` | `sele_o_de_lista` | `select` | "Produto contratado" — **100% preenchido** (3.342/3.342). É a categoria deste pipe |
| `client_name` | `nome_completo` | `short_text` | 3.340/3.342 |
| `total_value` | `valor_da_cobran_a` | `currency` | "Valor do Pagamento Total" — 1.664 |
| `sale_date` | `data_do_pagamento` | **`datetime`** | "Data do Pagamento." — 487 |
| `has_2nd` | `cliente_possui_2_parcela_de_pagamento` | `radio_vertical` | 1.672 (490 "Sim" / 1.182 "Não") |
| `p2_value` | `valor_do_pagamento_da_2_parcela` | `currency` | 491 |
| `p2_date` | `data_do_pagamento_da_parcela_2` | `date` | 498 |
| `seller` | `vendedor` | `connector` | 385 — aponta para "Data Base - Colaboradores" (`306916343`) |
| `department` | `informe_o_seu_departamento` | `radio_vertical` | **84,2% VAZIO — não usar** (achado 5) |

## Parsers — `neg_parse_date` é clone fiel de **`fin_parse_date`** (não do CS)

Medido no pipe inteiro (3.342 cards, 112 páginas):

```
informe_a_data_agendada_para_o_pagamento_1  968× "DD/MM/YYYY HH:MM"   datetime_value: 968 presentes
data_do_pagamento                           487× "DD/MM/YYYY HH:MM"   datetime_value: 487 presentes
data_do_pagamento_da_parcela_2              498× "DD/MM/YYYY"         datetime_value: 0   (sempre null)
data_da_quita_o_final_do_cliente             38× "DD/MM/YYYY"         datetime_value: 0   (sempre null)
informe_o_valor_do_pagamento               1113× "1.234,56" / "123,45" / "0,00"
valor_da_cobran_a                          1664× "1.234,56" / "123,45"
```

- **`neg_parse_money` = clone fiel** de `fin_parse_money`/`cs_parse_money`. Formato brasileiro em
  100% dos casos. **Confirmado por chamada ao vivo** (03/ago): `fin_parse_money('1.166,66')` →
  `1166.66`, `('374,50')` → `374.50`, `('1.823,90')` → `1823.90`.
- **`neg_parse_date` = clone fiel de `fin_parse_date`** — e isso **não é óbvio**, porque este pipe
  tem um formato a mais (`DD/MM/YYYY HH:MM`) que o Financeiro não tem. O `fin_parse_date` engole os
  dois porque a regex dele **não é ancorada no fim** (`^[0-9]{2}/[0-9]{2}/[0-9]{4}`, sem `$`) e ele
  faz `to_date(left(s,10), 'DD/MM/YYYY')`, descartando a hora. **Confirmado por chamada ao vivo**:

  | chamada | resultado |
  |---|---|
  | `fin_parse_date('06/08/2026 21:00')` | `2026-08-06` ✅ |
  | `fin_parse_date('09/08/2026 21:00')` | `2026-08-09` ✅ |
  | `fin_parse_date('31/07/2026 11:18')` | `2026-07-31` ✅ |
  | `fin_parse_date('07/08/2026')` | `2026-08-07` ✅ |

## ⚠️ Achado 2 — a armadilha nova: `datetime_value` existe, e está em **UTC**

Esta é a "surpresa do formato" deste pipe, o equivalente do `DD/MM/YYYY` no Financeiro. **Ela é o
oposto do que a experiência anterior sugere**, e por isso é perigosa:

- No Financeiro, `datetime_value` vinha **sempre null** e a regra virou "use `value`, é a única
  coisa que existe".
- Aqui, os campos `datetime`/`due_date` trazem `datetime_value` **em 100% dos casos** — parece o
  campo "melhor", já em ISO, pronto pra castar. **É uma armadilha:** ele vem em **UTC**, enquanto o
  `value` vem no horário local (BRT, −03). Um pagamento agendado pra 21:00 vira **o dia seguinte**
  em UTC:

  ```
  informe_a_data_agendada_para_o_pagamento_1
     value          = "06/08/2026 21:00"
     datetime_value = "2026-08-07T00:00:54+00:00"    ← 7 de agosto, não 6
  ```

- **79 dos 968 cards (8,2%)** com esse campo preenchido têm o **dia divergente** entre `value` e
  `datetime_value`. Em `data_do_pagamento`, 4 de 487.
- Demonstrado ponta a ponta ao vivo: `fin_parse_date('2026-08-07T00:00:54+00:00')` → `2026-08-07`,
  o dia **errado**; `fin_parse_date('06/08/2026 21:00')` → `2026-08-06`, o certo.

> **Regra da ingestão do Negociação: ler sempre `metadata->campo->>'value'`, nunca
> `->>'datetime_value'`.** É uma linha de código e é a diferença entre a projeção cair no mês certo
> ou no mês seguinte. Um agendamento em **31/07 às 21:00** vira **agosto** pelo caminho errado — e
> ninguém percebe, porque o número continua plausível.

Isto **generaliza** a lição do Financeiro. A regra do repo agora tem duas metades:
> **Campo de data do Pipefy: `value` é a verdade local. `datetime_value` ou não existe (`date`) ou
> está em UTC (`datetime`/`due_date`). Nas duas situações a resposta é a mesma — parse o `value`.**

## Achados que mudam o desenho do Sprint 2

### 1. ⚠️ O realizado da Negociação **já está no Financeiro** — risco de contagem dupla

O conector `lan_ar_pagamento` ("Lançar pagamento") da fase aponta para o **pipe `304386356` — "2.0 -
Financeiro"**, que é exatamente o pipe já ingerido no Sprint 1. Verificado seguindo as conexões: os
cards ligados estão na fase "Pagamento finalizado" do Financeiro. É o mesmo desenho do CS
(relação "Subir pagamento", ver [`20260730b_cs_pagamento.sql`](../../../supabase/migrations/20260730b_cs_pagamento.sql)).

**Consequência:** a Negociação **não deve trazer o realizado** — ele já está em `fin_entries` e
somar os dois contaria o mesmo dinheiro duas vezes, entre a aba Financeiro e a aba Projeções. A
vertical `neg_cards` fornece **só a projeção** (dinheiro que ainda não entrou).

### 2. ✅ `o_pagamento_foi_reaizado` é o sinal anti-dupla-contagem — e ele é confiável

Verificado card a card em 24 cards — os 14 de `326422800` mais os 10 que na época eu achava que
entrariam (`338815768`). A fase extra saiu da projeção, mas a correlação vale para as duas:

> **`o_pagamento_foi_reaizado = 'Sim'` ⟺ o card tem conexão "Lançar pagamento" — em 24/24 cards.**

Correlação perfeita, sem exceção. Ou seja: o flag no card diz, com precisão, se aquele dinheiro já
virou card do Financeiro. Dá pra usar o flag (barato, está no `metadata`) em vez de ingerir
`child_relations` (caro).

**Isto muda o número da projeção de forma grande:**

| leitura | total |
|---|---|
| tudo que está na fase "Aguardando pagamento" | R$ 10.500,00 |
| **só o que ainda não foi pago** (`<> 'Sim'`) | **R$ 4.000,00** |

Os outros R$ 6.500,00 **já entraram** e já estão contados na aba Financeiro. Projetar os 14 cards da
fase inflaria a projeção em **160%**.

### 3. A fase "Aguardando pagamento" está **meio vazia** — e existe uma segunda fonte melhor

Dos 14 cards parados na fase, **6 não têm nem valor nem data** nos campos da fase. O que eles têm é
a **2ª parcela da venda** (do start form), e ela está **vencida**:

```
#1347033921  proj=—                          | 2ª parcela= 2.000,00 em 05/06/2026  VENCIDA
#1357431880  proj=—                          | 2ª parcela= 1.050,00 em 10/06/2026  VENCIDA
#1370819205  proj=—                          | 2ª parcela=   750,00 em 07/07/2026  VENCIDA
#1373709872  proj=—                          | 2ª parcela=   550,00 em 22/06/2026  VENCIDA
#1410636392  proj=—                          | 2ª parcela=   400,00 em 24/07/2026  VENCIDA
```

**11 dos 14 cards da fase têm data de 2ª parcela, e as 11 estão vencidas** (maio–julho). Sobem
R$ 8.545,60 em 2ª parcela nessa fase.

E existe uma fase que o plano do sprint **não previa**:

**"Pré - Triagem - 2° Parcela📝" — id `338815768`.** Campo próprio
`data_do_pagamento_da_2_parcela` (`due_date`) + `valor_do_pagamento_da_2_parcela` (start form).
Era a fase mais bem preenchida do pipe: **10 de 10 com valor e data**, **0 com conexão de
pagamento**, **0 marcados como pagos**, R$ 6.860,50.

> ## ❌ ERRO MEU — esta fase NÃO entra na projeção
>
> Eu recomendei usar as duas fases, com o argumento de que "Aguardando pagamento" é o atraso e
> "Pré - Triagem" é o que está em dia. **O dono corrigiu em 03/ago: `338815768` é do COMERCIAL.**
> Os cards ali são acompanhamento de 2ª parcela de venda, não cobrança em negociação — não são
> projeção deste painel. Removida em
> [`20260803_negociacao_fase_unica.sql`](../../../supabase/migrations/20260803_negociacao_fase_unica.sql).
>
> **A lição: densidade de preenchimento não é sinal de pertencimento.** Eu inferi relevância de
> "10/10 preenchidos, todos a vencer, nenhum pago" — que é um perfil de dado bonito — e li isso
> como "esta fase é a boa". Era o contrário: a fase mais bem preenchida das duas era justamente a
> que não era pra estar aqui. **Nenhuma query ia dizer isso.** O nome da fase, a contagem, o
> formato, o preenchimento — nada distingue "espera de pagamento da Negociação" de "espera de
> pagamento do Comercial dentro do pipe da Negociação". Só quem conhece o processo.
>
> Onde eu devia ter parado: quando um achado **amplia o escopo** que o dono definiu (o plano dizia
> "fase Aguardando Pagamento", singular), isso não é um detalhe de implementação — é pergunta,
> mesmo quando o dado parece obviamente bom.

### 4. O histórico guarda opções de `select` que não existem mais

`sele_o_de_lista` ("Produto contratado") está preenchido em **100%** dos 3.342 cards:

| produto | cards |
|---|---|
| Contratação - Redução | 2.840 (85,0%) |
| Contratação - Quitação | 454 (13,6%) |
| Contratação - Limpa Nome | 27 (0,8%) |
| Contratação - Imóvel | 8 (0,2%) |
| **Contratação - Homologação de acordo.** | 8 (0,2%) |
| **Contratação - Laudo Pericial** | 5 (0,1%) |

As duas últimas **não estão nas opções atuais do campo** (hoje só há Redução/Quitação/Imóvel/Limpa
Nome). São opções aposentadas que sobreviveram no histórico — **exatamente o padrão do
`"Departamento - Jurídico"` no Financeiro**. São 13 cards (0,4%); não precisam de normalização
agora, mas a lista de categorias do painel tem que ser lida do **dado**, nunca das `options` do
campo.

### 5. `informe_o_seu_departamento` não serve como dimensão aqui

84,2% vazio (2.814 de 3.342). No Financeiro esse mesmo campo era a dimensão do breakdown; **aqui
não é**. A dimensão deste pipe é `sele_o_de_lista` (produto), que é 100%.

### 6. Valores `0,00` existem e precisam ser descartados

`informe_o_valor_do_pagamento` tem 199 valores de 1 dígito. Investigados: **78× `"0,00"`, 2×
`"0,01"`, 1× `"1,11"`** (na amostra de 1.200). **Nenhum deles está numa fase viva** — estão em
"Distratos - Finalizados" (39), "Reversão 1°" (31), "Falta de contato" (8), "Pós-Fase" (2),
"Contrato de Agência" (1). Mesma regra do Financeiro: **descartar entrada de valor 0**.

### 7. Os campos da fase **ficam no card depois que ele sai** da fase

Cards em "Reversão 1° ⚔️" ainda carregam `informe_o_valor_do_pagamento` preenchido (ex.: `#992560830`
R$ 2.500,00, `#1021571572` R$ 1.166,66). **A RPC tem que filtrar por
`current_phase_id = '326422800'`**, nunca por "tem valor de projeção preenchido" — senão a projeção
puxa cards mortos. É o espelho do filtro de fase do Financeiro.

### 8. Formato uniforme ao longo dos anos — mas a adoção não

Diferente do Financeiro, **não há quebra de convenção de formato** por ano. O que muda é o quanto os
campos são usados:

| ano de criação | cards | com valor de projeção | com data da 2ª parcela |
|---|---|---|---|
| 2024 | 1.949 | 267 (13,7%) | 84 |
| 2025 | 962 | 571 (59,4%) | 259 |
| 2026 | 431 | 275 (63,8%) | 155 |

Como a projeção só olha o **presente** (cards parados na fase), isso não afeta o schema — mas
explica por que um backfill histórico deste pipe tem pouco valor: em 2024 o processo mal usava a
fase.

> A varredura cobriu o **pipe inteiro** (3.342 cards, 112 páginas), não uma amostra — a lição do
> Financeiro ("amostra recente esconde mudança de convenção") foi aplicada e, desta vez, não havia
> quebra escondida.

## Decisões do dono — **fechadas** (03/ago)

| # | Pergunta | Resposta |
|---|---|---|
| 1 | A projeção sai só de "Aguardando pagamento" (`326422800`) ou também de "Pré - Triagem - 2° Parcela" (`338815768`)? | **SÓ `326422800`** — a outra é do Comercial (ver o erro registrado no achado 3) |
| 2 | Card com `o_pagamento_foi_reaizado = 'Sim'` entra? | **Não** — já está em `fin_entries` |
| 3 | 2ª parcela vencida é projeção ou inadimplência? | **Projeção**, em janela própria "vencidas" — para os cards que estão em `326422800` |
| 4 | Vale escrever `get_ceo_projecoes_cs()` com o CS sem dado? | **Sim** — escrita; volta vazia hoje e acende sozinha quando a operação adotar a fase |

### Uma decisão de desenho que veio junto: COALESCE, não soma

Um card pode ter os **dois** sinais preenchidos, e eles **não são dívidas somáveis**. Real
(`#1348129801`): venda total R$ 890,00, 2ª parcela R$ 590,00 vencida em 28/05, e um pagamento
agendado de R$ 1.500,00 pra 09/08. Somar daria R$ 2.090,00 "a receber" num contrato de R$ 890,00 — o
agendamento da fase **supersede** a parcela antiga. Por isso `neg_projection()` é um COALESCE por
prioridade (1º o campo da fase, 2º a 2ª parcela), e por isso **não há tabela-filha** aqui: 1 card
parado numa fase de espera = 1 próximo pagamento. (O Financeiro precisou de `fin_entries` porque lá
um card carregava até 4 pagamentos **históricos já ocorridos**, em meses diferentes — problema
diferente.)

## O número — conferido contra o banco carregado (03/ago)

`npm run verify:negociacao` reimplementa as regras em JS, recomputa do Pipefy cru e compara card a
card com `neg_cards`. Resultado **depois** da migration aplicada e do backfill rodado (3.343 cards),
já com a fase única:

| | valor | cards |
|---|---|---|
| **Projeção total** | **R$ 10.000,00** | **8** |
| vencidas | R$ 4.750,00 | 5 |
| a vencer em até 30 dias | R$ 5.250,00 | 3 |
| 31–90 dias / mais de 90 | R$ 0,00 | 0 |

**3.343/3.343 cards, 0 faltando, 0 divergências de dado, e o total bate dos dois lados.**

Por sinal: **5** de `parcela2` (são as 5 vencidas — cards em `326422800` cujo único sinal é a 2ª
parcela atrasada) e **3** de `fase` (os agendamentos futuros: 06/08, 07/08, 09/08).

**O filtro anti-dupla-contagem em número:** 6 cards na fase estão marcados como pagos, somando
**R$ 7.398,60**. Esse dinheiro já está em `fin_entries`. Sem o filtro a projeção seria R$ 17.398,60
em vez de R$ 10.000,00 — **74% de inflação**.

**Alarme de fuso:** 79 campos de data em que o dia local ≠ o dia do `datetime_value`. O verify
imprime esse número toda vez, de propósito: se alguém "melhorar" a ingestão pra usar o
`datetime_value`, as divergências de dado saem de 0 e o script reprova.

> **Defasagem de fase não reprova.** O script separa "divergência de dado" (valor/data/sinal/pago —
> erro de ingestão, reprova) de "card mudou de fase depois da carga" (o poll do Make ainda não
> passou — normal, não reprova). Ele só chama atenção quando a fase defasada é a de projeção, aí a
> aba está mostrando número velho. Na conferência de 03/ago: 1 card defasado, fora da fase de
> projeção.

**O filtro anti-dupla-contagem em número:** 7 cards nas fases de espera estão marcados como pagos,
somando **R$ 7.898,60**. Esse dinheiro já está em `fin_entries`. Sem o filtro a projeção seria
R$ 23.509,10 em vez de R$ 15.610,50 — **50% de inflação**.

**Alarme de fuso:** 79 campos de data em que o dia local ≠ o dia do `datetime_value`. O verify
imprime esse número toda vez, de propósito: se alguém "melhorar" a ingestão pra usar o
`datetime_value`, as divergências card a card explodem junto.

## O probe

`node scripts/probe-negociacao-fields.mjs` — irmão de `probe-financeiro-fields.mjs`.
[`scripts/probe-negociacao-fields.mjs`](../../../scripts/probe-negociacao-fields.mjs)

```
--fase        os 14 cards parados em "Aguardando pagamento", crus (valor, data, pago?, 2ª parcela)
--scan [N]    varre N páginas de 30 cards e mede: formato por campo (máscara + divergência
              value×datetime_value), preenchimento por ano, fase atual, produto, 2ª parcela
```

**Por que um script novo em vez de reusar o `--scan` do Financeiro:** aquele probe é agnóstico de
pipe **na listagem de campos** (`node scripts/probe-financeiro-fields.mjs 304370275` funciona e foi
o que fechou a tabela de fases acima), mas o `--scan` dele tem os field-ids do Financeiro **cravados
na constante `CAMPOS`** — rodado neste pipe ele devolve tudo zerado, sem erro. O `--scan` daqui mede
os riscos **deste** pipe, incluindo a divergência de fuso do achado 2, que o do Financeiro nem
procura (lá `datetime_value` nunca existe).

## Referências

- [`introspeccao-pipefy-financeiro.md`](introspeccao-pipefy-financeiro.md) — o irmão; as queries
  GraphQL reutilizáveis estão lá.
- [`painel-ceo-sprints.md`](painel-ceo-sprints.md) — roadmap; o Sprint 2 consome este resultado.
- [`painel-ceo-indice.md`](painel-ceo-indice.md) — índice/estado do painel.
- [`20260730b_cs_pagamento.sql`](../../../supabase/migrations/20260730b_cs_pagamento.sql) — o lado
  CS da projeção (P4), que já existe e usa o mesmo desenho de conector.
- [`correcao-data-quitacao-ddmmyyyy.md`](../../painelcs-docs/fixes/correcao-data-quitacao-ddmmyyyy.md)
  — o bug de data que originou a regra.
