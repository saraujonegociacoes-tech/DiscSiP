# Financeiro: card **Diária**, meta esperada e a aba reordenada

> Pedido do dono em **02/set/2026**, com o motivo junto: *"na aba Financeiro, sobe os cards
> de categoria, por departamento e forma de pagamento para cima do gráfico dos últimos 12
> ciclos. Cria um card de Diária, que mostra quanto precisamos bater para alcançar a meta,
> com o valor da meta esperada no mesmo card."*
>
> Implementado em
> [`20260902_ceo_meta_financeira.sql`](../../../supabase/migrations/Migrations_projetopainelceo/20260902_ceo_meta_financeira.sql)
> + `src/features/ceo/components/CeoFinanceiro.tsx`.
>
> ⚠️ **Precisa de migration aplicada.** Sem ela, `get_ceo_meta()` não existe, a action
> degrada para meta 0 e o card aparece como convite "defina a meta esperada" — a aba **não**
> quebra, mas o número nunca salva.

## O problema: um número que existia só no WhatsApp

Toda manhã o grupo recebe isto, digitado à mão:

```
[09:22] Supervisor: Projeção de Hoje:
        Negociação: 1.000,00
        SC:         8.000,00
        Comercial:    800,00
        Total:      9.800,00
[10:03] CEO: atualiza os números aqui por favor. Junto com a diária
```

E a resposta saía em **três prints** de telas diferentes: o realizado do mês, a quebra por
departamento e a meta (que não estava em tela nenhuma — vinha da cabeça de quem montava).

Duas coisas faltavam para o Blue Desk responder isso com **um print só**:

1. **A meta não existia no banco.** O painel sabia dizer quanto entrou; nunca soube quanto
   *deveria* entrar. Nenhuma tabela guardava alvo de receita.
2. **A ordem da aba escondia a resposta.** Ela era: KPIs → gráfico de 12 ciclos → quebras
   por categoria/departamento/forma. As quebras — exatamente o "Negociação / SC / Comercial"
   pedido — ficavam **abaixo do gráfico**, fora da dobra.

## O que mudou

### 1. Ordem da aba (ajuste visual)

| antes | depois |
|---|---|
| KPIs | KPIs |
| **Gráfico — últimos 12 ciclos/meses** | **Card Diária** ← novo |
| Por categoria · Por departamento · Por forma | Por categoria · Por departamento · Por forma |
| Aviso de líquido faltando | **Gráfico — últimos 12 ciclos/meses** |
| | Aviso de líquido faltando |

O gráfico mudou de papel: virou **contexto histórico**, e contexto vem depois do que se
persegue hoje. A ordem antiga é da Sprint 1 (31/jul), quando a série *era* o assunto da aba.

### 2. Card **Diária** (feature)

A conta é a do dono, sem tradução:

```
meta_atual  = meta_esperada − meta_atingida     (o que falta)
meta_diaria = meta_atual ÷ dias úteis restantes no ciclo
```

O card mostra os quatro números da conta na mesma moldura: a **meta esperada** (editável ali
mesmo, clicando no valor), o **atingido** com barra de progresso e %, o que **falta**, e a
**diária** em número grande — mais "X de Y dias úteis restantes".

Abaixo da diária, quando há o que ratear, vem a linha que fecha o print:

> Negociação **R$ 13.952,01** · Quitação **R$ 4.783,31** · Comercial **R$ 3.351,90**

⚠️ **Esse rateio é derivado.** Ele distribui a diária na proporção do que cada departamento já
realizou no período (`byDepartment`, que a RPC já devolvia); o banco guarda uma meta só, global.
Se um dia o dono quiser metas por departamento, o lugar é uma segunda tabela — a linha de rateio
sai e dá lugar a elas.

**A legenda que explicava isso na tela saiu em 03/set, a pedido do dono.** O card é lido de
relance e vai para print; um rodapé de texto explicando a origem do número competia com os
próprios números. A explicação vive aqui e no comentário do `rateio` em `CeoFinanceiro.tsx`.

### 3. Rodapé de ritmo — como o período vem andando (03/set)

Com a legenda fora, sobrou espaço embaixo do "Atingido / Falta" na coluna esquerda. Ele recebeu
três campos que respondem a pergunta seguinte à diária — *e como estamos indo até aqui?* — sem
nenhuma consulta nova, só com o que o card já tinha em mãos:

| campo | conta | exemplo (03/set) |
|---|---|---|
| **Ritmo até aqui** | `atingido ÷ dias úteis já fechados` | R$ 6.616,28 · média de 17 dias úteis |
| **Nesse ritmo, fecha em** | `atingido + ritmo × dias restantes` | R$ 152.174,33 · 62% da meta |
| **Ritmo necessário** | `diária ÷ ritmo atual` | 3,3× o atual · acima do que vem sendo feito |

`dias úteis já fechados` = `totais − restantes`. Como **hoje conta** entre os restantes, o dia
corrente (ainda pela metade) fica fora da média — incluí-lo puxaria o ritmo para baixo toda
manhã, justo quando o número é pedido.

Os três campos são honestos com o estado do período: enquanto nenhum dia útil fechou (período
recém-começado ou futuro) mostram `—` com a legenda "à espera do 1º dia útil fechado"; com a
meta batida, o terceiro vira "cumprido" em verde; com o período encerrado, o segundo troca o
rótulo para "Fechou em". O bloco ocupa o mesmo espaço nos três casos, então o card mantém a
altura na virada do mês.

## As decisões que o código tomou

### A meta é UM número, global

`ceo_meta_config` é singleton (uma linha, `CHECK (id)`), igual a `ceo_custo_config`. Trocar o
seletor de mês civil para ciclo 11→10, ou voltar para julho, **não troca a meta** — troca o
realizado e os dias úteis restantes, que é o que faz a diária mudar.

Isso é simplificação consciente: os dois recortes do seletor valem ~1 mês, e a operação
persegue o mesmo alvo nos dois. O custo é que um período antigo é medido contra a meta de
hoje. Meta por ciclo exigiria uma tabela com chave de período e uma tela para preencher 12
linhas; ficou de fora do pedido.

### "Dia útil" é segunda a sexta, **sem feriados**

Não existe tabela de feriados neste repo. Uma lista incompleta erraria em silêncio justo no
feriado que faltasse, então `businessDaysBetween` conta seg–sex e pronto. O efeito é conhecido
e está escrito no código: **num mês com feriado a diária sai um pouco otimista** (divide por um
dia a mais do que a operação realmente tem). Quando houver calendário de feriados, ele entra em
`src/lib/period.ts` — a aba não muda.

### **Hoje conta** como dia útil restante

`businessDaysLeft` inclui o dia corrente. Ainda dá para faturar hoje; excluir o dia atual
inflaria a diária todas as manhãs — justo o horário em que o CEO pede o número.

### Sem dia útil restante, o card troca de assunto

Período encerrado (ou só fim de semana até o fim dele) → `restantes = 0`. Não se divide por
zero: o card deixa de mostrar diária e passa a dizer **quanto faltou**. Meta já batida →
diária R$ 0,00 e o excedente em verde.

### A divisão fica na tela, a meta fica no banco

O SQL guarda só o alvo. "Dias úteis restantes" depende de **hoje** e do **período
selecionado** — muda a cada clique no seletor, sem tocar no banco. Colocar a conta na RPC
significaria uma ida ao Postgres para uma divisão.

### RPC separada, não uma chave a mais em `get_ceo_financeiro`

`get_ceo_meta()` nasceu como função própria em vez de a meta virar mais um campo do jsonb do
Financeiro. Acrescentar a chave exigiria `CREATE OR REPLACE` daquela função de 130 linhas numa
migration nova — e este projeto já se queimou **duas vezes** com "a última migration que rodar
vence" ([`supabase/migrations/README.md`](../../../supabase/migrations/README.md) §6). O custo
é uma chamada a mais; a aba dispara as duas no mesmo mount, em paralelo, e a meta é buscada
**uma vez** (não a cada troca de período).

## O que foi reaproveitado

Nada aqui nasceu do zero:

| Peça | De onde veio |
|---|---|
| Campo de dinheiro editável (`ValorEditavel`) | era o `CustoInput` local da aba **Saúde da Equipe**; virou arquivo próprio e agora serve às duas |
| Tabela singleton + RLS sem policy + RPC com guarda `ceo/admin` | idioma de `ceo_custo_config` / `set_ceo_custo_geral` (`20260805b`) |
| Degradar para vazio + `console.error` na action | disciplina das 3 actions que já existiam em `app/actions/ceo.ts` |
| Quebra por departamento do rateio | `byDepartment`, que `get_ceo_financeiro` já devolvia |
| Aritmética BRT (`brtParts`, `ymd`, `end` exclusivo) | helpers que já existiam em `src/lib/period.ts` |
| Moldura do card (borda, `bg-gradient-card`, glow, barra de progresso) | mesmo vocabulário visual dos `Breakdown`/`KpiCard` |

## Conferência

Migration (SQL Editor do Supabase, manual como sempre):

```sql
SELECT * FROM public.ceo_meta_config;                       -- 1 linha, meta_mensal = 0
SELECT proname, pg_get_function_identity_arguments(oid)
  FROM pg_proc WHERE proname IN ('get_ceo_meta','set_ceo_meta');   -- 1 linha cada
```

Aritmética dos dias úteis, medida com as funções reais (esbuild + node, 02/set/2026):

| caso | resultado |
|---|---|
| setembro/2026 inteiro | 22 dias úteis |
| mês civil de set, olhando de 02/set (quarta) | 21 restantes de 22 |
| ciclo 11 ago → 10 set, mesmo dia | 7 restantes de 23 |
| julho/2026 (passado) | 0 restantes, `encerrado: true` |
| novembro/2026 (futuro) | 21 de 21, `futuro: true` |
| 30/set 23h30 BRT (= 01/out 02h30 **UTC**) | 1 restante — a virada é em BRT, não em UTC |

Card em produção (03/set, ciclo 11 ago → 10 set, meta de R$ 245.000,00): atingido
R$ 112.476,68 (45,9%), falta R$ 132.523,32, **6 de 23 dias úteis restantes**, diária
**R$ 22.087,22** — conferida contra a mesma conta rodada à parte. O rodapé de ritmo, com os
mesmos números: R$ 6.616,28/dia útil, projeção de R$ 152.174,33 (62% da meta), 3,3× o ritmo
atual para fechar.

`tsc --noEmit` limpo e `eslint` sem apontamento nos arquivos tocados.

## O que ficou de fora

- **Meta por departamento cadastrada.** Hoje o card mostra rateio proporcional ao realizado.
- **Meta por ciclo/histórico de metas.** Um alvo só, o corrente.
- **Feriados.** Ver acima — é a única imprecisão conhecida da conta.
- **Meta de quantidade** (nº de pagamentos). A conta pedida é em dinheiro.
