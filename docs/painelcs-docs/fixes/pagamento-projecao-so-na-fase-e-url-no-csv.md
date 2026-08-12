# Página 4 (Pagamento) — projeção só na fase + URL em toda exportação

**Data:** 2026-08-11 · **Pedido do dono (duas coisas, um pedido só)** ·
**Migration:** `supabase/migrations/Migrations_painelcs/20260811_cs_pagamento_projecao_so_na_fase.sql`
✅ **aplicada em 12/ago/2026** · **Frontend:** `CsPagamento.tsx`, `CsMatrix.tsx`, `CsMinutas.tsx`,
`MinutasLista.tsx`, `src/lib/csv.ts` (novo), `src/lib/types/database.ts`.

> **No ar.** A migration foi aplicada pelo dono em 12/ago: a projeção passou a valer só dentro da
> fase "Aguardando Pagamento" e o `naFase` chega no payload. Nada precisou de backfill — o plano é
> resolvido na leitura (ver "Aplicação" no fim).

## 1. Projeção estava contando card que já saiu da fase

### Sintoma (relato do dono)

> "Quando o card não está na fase de aguardando pagamento, ainda está puxando as informações
> dele. Isso não deveria acontecer."

### Causa-raiz

A `get_cs_pagamento_projecao()` da `20260730b` montava a coorte **por campo, não por fase**:

```sql
WHERE NULLIF(c.metadata->'1_parcela_valor'->>'value', '') IS NOT NULL
   OR EXISTS (SELECT 1 FROM public.cs_card_payments p WHERE p.cs_card_id = c.id)
```

Os campos do plano (`1_parcela_valor`, `copy_of_1_parcela_valor`, …) são criados na fase
"Aguardando Pagamento", mas ficam gravados no `cs_cards.metadata` **para sempre**. Quando o
card anda pra "1° Mês", "Quitados" ou "Arquivado", eles vão junto — e a RPC continuava lendo.
Resultado: card que já saiu da fase entrava na carteira com **previsto**, **em aberto** e até
**parcela atrasada**, inflando o KPI "A receber", o calendário de recebimento e os insights.

**É o mesmo erro que a [`20260805_negociacao_so_campos_da_fase.sql`](../../../supabase/migrations/Migrations_projetopainelceo/20260805_negociacao_so_campos_da_fase.sql)
corrigiu na Negociação do painel do CEO** — lá era o campo errado, aqui é a fase errada.
Padrão que vale guardar: **campo de fase é dado de fase; fora dela ele é histórico, não
projeção.**

### Regra aplicada (a que o dono ditou)

| | Conta quando | Filtro de fase? |
|---|---|---|
| **Projeção** (plano de parcelas: valor + vencimento previstos) | o card **está** em "Aguardando Pagamento" (`343781769`) | **sim** |
| **Realizado** (pagamento conectado do pipe do Financeiro) | sempre, em qualquer fase | não |

> "Para as projeções funcionam assim; agora os pagamentos realizados podem continuar
> contabilizando."

### Correção

A migration faz duas coisas:

1. **`cs_is_pagamento_phase(text)`** — a fase num lugar só, espelhando o `neg_is_waiting_phase`
   do painel do CEO. Se o id mudar no Pipefy, muda **aqui e só aqui**, e dá pra conferir com um
   `SELECT`.
2. **`get_cs_pagamento_projecao()` reescrita** — coorte com o filtro de fase no plano
   (`cs_is_pagamento_phase(...) AND 1_parcela_valor IS NOT NULL`), os 6 campos do plano lidos
   dentro de um `CASE` pela fase, e um `naFase` novo no payload. O `OR EXISTS (pagamento)`
   continua **sem** filtro de fase: é ele que mantém o realizado visível.

**✅ Não precisa re-rodar backfill nem reingestão.** Diferente da `20260805` (que tinha
`proj_*` gravado na ingestão e exigiu um UPDATE de recálculo), aqui o plano é resolvido **na
leitura**, direto do `metadata`. Trocar a função já muda a aba na próxima chamada.

### O que muda na tela

- Card com plano no metadata, fora da fase e **sem** pagamento conectado: **some da aba**.
- Card fora da fase **com** pagamento conectado: **continua na lista**, agora com status
  **"Fora da fase"** (novo), `plano: []`, previsto 0 e em aberto 0. O pago dele segue somando
  em "Já recebido" — é exatamente o pedido.
- KPI "Em pagamento" passa a mostrar **quantos estão na fase**, com o resto no subtítulo
  (`N fora (só realizado)`), pra o número não misturar as duas populações.
- "A receber", calendário (barra de previsto) e insights de atraso: só de card na fase.
  A barra de **recebido** do calendário não muda.

## 2. Exportação — URL em todas, e a de Pagamento completa

> "Todas as abas que têm o botão de exportação, quando exportar, precisam exportar também a
> URL."

### `src/lib/csv.ts` (novo)

Eram **quatro cópias** do mesmo trecho (`cell()` + BOM + `<a download>`), uma por aba. Aplicar
"toda exportação sai com URL" em quatro lugares é o tipo de regra que se esquece num deles sem
ninguém ver. As **colunas** continuam sendo decisão de cada aba (o dado é diferente); o que
foi centralizado é o **formato** — separador `;`, BOM UTF-8, aspas só quando precisa. Mesma
saída de antes: nenhuma planilha existente quebra.

### Por aba

| Aba | Export | URL |
|---|---|---|
| CS · Visão Geral (Matriz) | cards do recorte | ✅ `URL do card` (1ª coluna) |
| CS · Minutas | cards com minuta | ✅ `URL do card` (1ª coluna) + coluna `Fase` |
| CS · Pagamento — **projeção** | reescrita (abaixo) | ✅ `URL do card` (1ª coluna) |
| CS · Pagamento — **realizado** | **novo botão** no Histórico de recebimento | ✅ URL do card + URL do comprovante |
| Minutas processuais | inalterado | ❌ **não tem URL** — ver nota |

> **Minutas processuais não ganham coluna de URL** porque não existe URL: são registro nosso
> (tabelas `proc_*`, criado no formulário da própria página), não card do Pipefy. A chave que
> serve de identificador ali é o número do processo, que já sai no CSV. Se um dia essas minutas
> ganharem página própria, a coluna entra.

### A exportação da projeção (o "campo de exportação" pedido)

Botão **Exportar** no cabeçalho da tabela "Cards em pagamento" (antes era um "CSV" pequeno no
cartão do calendário — lugar errado: ele exporta a tabela, não o calendário). Uma linha por
card, com **tudo** o que a aba sabe, incluindo o cronograma parcela a parcela que a tela só
mostra no drill:

`URL do card` · `ID` · `Cliente` · `Responsável` · `Fase` · `Na fase Aguardando Pagamento` ·
`Situação` · `Status` · `Forma` · `Total previsto` · `Total pago` · `Em aberto` ·
`Parcelas previstas` · `Parcelas pagas` · `Próxima parcela (venc.)` ·
`Próxima parcela (valor)` · e, por parcela **N**: `PN previsto` · `PN vencimento` · `PN pago` ·
`PN pago em` · `PN situação` · `PN comprovante`.

O número de blocos de parcela é **dinâmico** (o maior número de parcela que aparecer no
recorte). O plano tem teto 3, mas o campo do Financeiro que diz a qual parcela o pagamento se
refere é livre — fixar em 3 comeria dado em silêncio.

### ⚠️ Pendência conhecida (não mexida): decimal do CSV

Os valores saem como número cru (`1234.5`, ponto decimal) — comportamento **pré-existente nas
quatro abas**, não foi alterado aqui pra não mudar em silêncio o que já entra em planilha de
alguém. O Excel em pt-BR pode ler essas células como texto. Se o dono quiser, a troca é de uma
linha no `src/lib/csv.ts` (formatar número com vírgula) e passa a valer para todas as abas de
uma vez — é justamente o ganho de ter um escritor só.

## Aplicação — feita

Migration e frontend estão os dois no ar desde **12/ago/2026**. Não houve backfill nem reingestão:
o plano é resolvido **na leitura**, direto do `metadata`, então trocar a função já mudou a aba na
chamada seguinte.

> Registro de como os dois lados se comportavam separados, caso um rollback parcial aconteça: com
> a **RPC velha**, `naFase` chega `undefined` (falsy) e todo card aparece como "Fora da fase" — a
> aba não quebra, mas os números ficam errados. Com o **frontend velho**, o `naFase` é ignorado e
> os cards fora da fase aparecem como "Sem plano" — já sem previsto, que é o efeito principal.

## Reconferir

As queries completas estão comentadas no fim da migration. Valem principalmente **depois de
qualquer mexida na `get_cs_pagamento_projecao`**:

```sql
-- a fase é a certa?
SELECT public.cs_is_pagamento_phase('343781769');   -- true

-- sobrou projeção de card fora da fase? (tem que ser ZERO)
SELECT count(*)
FROM jsonb_array_elements(public.get_cs_pagamento_projecao()->'cards') c
WHERE (c->>'naFase')::boolean IS FALSE
  AND jsonb_array_length(c->'plano') > 0;
```

E `node scripts/verify-cs-pagamento.mjs` (read-only, sem PII).

> ⚠️ **Armadilha viva:** a `20260730b` tem um `CREATE OR REPLACE` da **mesma**
> `get_cs_pagamento_projecao`, na versão sem filtro de fase. Reexecutar aquele arquivo **desfaz
> esta correção em silêncio** — sem erro, os cards fora da fase só voltam a somar. Se precisar
> reaplicar a `20260730b`, rode a `20260811` logo em seguida e refaça a conferência acima. É a
> mesma armadilha que já mordeu o painel do CEO na `20260731b`/`20260803` e que a `20260812`
> herdou na `get_cs_minutas()`.
