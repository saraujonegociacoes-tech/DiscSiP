# Financeiro: a variação passa a comparar **os mesmos dias úteis**

> Pedido do dono em **04/set/2026**: *"quando filtrar por uma data, específica ou personalizada,
> quero que o painel compare com a mesma quantidade de dias úteis da data selecionada. Filtrei os
> últimos 15 dias de meta — quero comparar com os últimos 15 dias de meta da meta passada."*
>
> Mudança **só de código** (`src/lib/period.ts`, `src/app/actions/ceo.ts`,
> `CeoFinanceiro.tsx`). Nenhuma migration: a régua nova vive no TypeScript e o Postgres continua
> só somando.

## A régua antiga mentia em dois casos do dia a dia

`get_ceo_financeiro` sempre devolveu um `previousTotal` próprio, medido assim
([`20260810`](../../../supabase/migrations/Migrations_projetopainelceo/20260810_financeiro_valor_liquido.sql)):

```sql
v_days       := GREATEST(v_end - v_start, 1);   -- dias CORRIDOS do período
v_prev_start := v_start - v_days;               -- a janela imediatamente anterior
```

Isso é "o mesmo tanto de dias corridos, colado antes". Onde isso quebra:

| situação | o que era comparado | efeito na pílula |
|---|---|---|
| **Ciclo corrente**, no dia 4 | ~19 dias úteis **decorridos** × ciclo anterior **inteiro** (23) | delta negativo por construção, todo começo de ciclo |
| **Recorte livre de 15 dias** | 15 dias corridos × 15 dias corridos | a base tinha 9, 10 ou 11 dias úteis conforme onde caíam os fins de semana |

Nos dois casos o número existia, parecia legítimo e comparava coisas de tamanhos diferentes.

## A régua nova

> A janela de comparação **começa um ciclo antes** do início do período escolhido e vai até
> completar **a mesma quantidade de dias úteis** que o período tem **até hoje**.

Três detalhes que fazem ela fechar:

- **Um mês atrás é exatamente um ciclo atrás.** O ciclo é ancorado no dia 11, então "menos um
  mês" cai no mesmo ponto do ciclo passado. A mesma conta serve ao recorte de mês civil.
- **Até HOJE.** Período em andamento só realizou o que já passou: a contagem vai até o dia
  corrente, inclusive. É o que faz o ciclo em curso ser comparado com os N primeiros dias úteis
  do ciclo passado, em vez do ciclo passado fechado.
- **A janela começa num dia útil.** Se o dia equivalente cai num sábado, ela anda até a segunda.
  Contar N dias úteis a partir do sábado ou da segunda termina no mesmo dia, então o corte só
  enxuga a ponta — e evita que um pagamento datado no fim de semana entre só de um dos lados.

### Recorte maior que um mês: a janela encosta

Um período de dois meses tem um problema: "um ciclo antes" cairia **dentro** dele, e o mesmo
dinheiro entraria nos dois lados da conta. Nesse caso a janela recua o necessário para terminar
exatamente onde o período começa — vira "os N dias úteis imediatamente anteriores". A tela
avisa, trocando "do ciclo anterior" por "imediatamente anteriores".

O mesmo acontece num mês civil fechado que tenha mais dias úteis que o anterior: julho/2026 tem
23 e junho tem 22, então a janela pega um dia útil de maio para fechar os 23.

## Medido (04/set/2026, sexta, com as funções reais)

| período escolhido | dias úteis | janela de comparação |
|---|---|---|
| custom **21/ago – 04/set** (o caso do pedido) | 11 | 21 jul – 4 ago |
| ciclo **11 ago – 10 set** (correndo) | 19 | 13 jul – 6 ago |
| ciclo **11 jul – 10 ago** (fechado) | 21 | 11 jun – 9 jul |
| mês **set/26** (correndo) | 4 | 3 ago – 6 ago |
| mês **jul/26** (fechado) | 23 | 29 mai – 30 jun *(encostada)* |
| **hoje** (04/set) | 1 | 4 ago |
| custom **01/jul – 31/ago** | 44 | 30 abr – 30 jun *(encostada)* |
| custom **05–06/set** (sábado e domingo) | 0 | sem comparação — a aba omite a variação |
| custom **31/mar** | 1 | 2 mar *(o grampo de fim de mês evita cair em 3/mar)* |

Invariante conferida em todos os casos: a janela devolvida contém **exatamente** o mesmo número
de dias úteis do período escolhido.

## Onde isso aparece na tela

- **Pílula do KPI "Entradas no período"**: `+12,3% vs. ciclo anterior` (ou "mês anterior", ou
  "janela anterior" quando ela encostou). Curta, porque a pílula é estreita.
- **Cabeçalho da aba**, ao lado do seletor: *"Variação medida contra os mesmos **19 dias úteis**
  do ciclo anterior (13 jul – 6 ago)."* — quem confere o número tem as datas exatas, que é o que
  falta principalmente no recorte personalizado, onde a janela é calculada.

## As decisões que o código tomou

### A conta ficou no TypeScript, e não na RPC

A alternativa era reescrever `get_ceo_financeiro` para casar dias úteis no SQL. Custaria duas
coisas: um `CREATE OR REPLACE` daquela função de 130 linhas numa migration nova — a armadilha
que já mordeu este projeto duas vezes ([`README.md`](../../../supabase/migrations/README.md) §6)
— e uma **segunda definição de "dia útil"** no banco, livre para divergir da de `lib/period.ts`
sem ninguém perceber. Uma definição só, testada, e o Postgres seguindo no que faz bem.

### O preço: uma consulta a mais, em paralelo

A janela anterior é buscada com uma **segunda chamada à mesma RPC**, disparada junto com a
principal (`Promise.all`), então não soma latência. Ela calcula série de 12 baldes, breakdowns e
`missingNet` que são jogados fora — só `total` e `count` são lidos. Se um dia isso pesar, o
caminho é uma RPC enxuta de janela; hoje seria otimização sem medição.

### Falhou a janela, some a variação

Se a segunda consulta falhar, a aba fica **sem** delta, em vez de cair no `previousTotal` da RPC.
Os dois números medem coisas diferentes; um delta que troca de régua no meio é pior que delta
nenhum. O motivo vai para o log do servidor, como nas outras actions do painel.

### `previousTotal` da RPC ficou órfão

A função continua calculando o dele, e ele agora é **ignorado** pela action. Remover exigiria
mexer na função; o comentário na action explica por que o valor é descartado. Quem for reescrever
aquela RPC um dia pode tirar as duas linhas.

## O que ficou de fora

- **Feriados.** Continua seg–sex, como no card de Diária
  ([`meta-diaria-financeiro.md`](meta-diaria-financeiro.md)) — a mesma função conta os dois.
- **Comparação nas outras abas.** Projeções é snapshot (não tem período comparável) e Saúde da
  Equipe não mostra variação.
- **Escolher a base na tela** (ciclo anterior × mesmo ciclo do ano passado). Uma régua só.
