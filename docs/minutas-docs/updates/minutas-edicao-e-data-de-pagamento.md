# Minutas Processuais — edição, dados bancários/PIX, data de pagamento real e totais no calendário

Quatro pedidos do dono (26/ago/2026) sobre a área `/minutas`. Base:
[`painel-minutas-processuais.md`](painel-minutas-processuais.md) (a área) e
[`../../links.md`](../../links.md) (índice mestre).

> ⚠️ **Domínio SEPARADO das "Minutas" do CS** (aba dentro de `/cs`, tabelas `cs_*`). Aqui é
> `proc_*`, rota `/minutas`. Não misturar.

## Estado: código pronto · ⚠️ migration PENDENTE de aplicação

**Pendências do dono, nesta ordem:**

1. **Aplicar [`20260826_minutas_edicao_dados_bancarios.sql`](../../../supabase/migrations/Migrations_minutas/20260826_minutas_edicao_dados_bancarios.sql)**
   no SQL Editor. Sem ela: os campos de dados bancários/PIX aparecem vazios e **"Nova minuta"
   quebra** (o app chama `proc_create_acordo` com dois parâmetros que a função antiga não tem).
   A edição de parcelas e a data de pagamento funcionam sem a migration — não dependem de schema novo.
2. **Corrigir as datas de pagamento já gravadas erradas** (ver [O viés do relatório](#o-viés-do-relatório-pago-na-janela) —
   é o motivo do pedido). O código só conserta dali pra frente; o passado se conserta no diálogo
   "Editar minuta".

Continua valendo a pendência antiga: aplicar `20260803b_proc_can_access_tester.sql` e atribuir os
usuários do jurídico ao departamento `juridico`.

## 1 · O viés do relatório: "Pago na janela"

**O sintoma que o dono descreveu:** filtrando por mês civil, "Pago na janela" mostrava muito mais
do que a empresa realmente pagou no mês.

**A causa não era o cálculo, era o dado.** O KPI sempre recortou pela `data_pagamento` — o que
está certo: o mês precisa mostrar o que saiu do caixa nele. O errado era como essa data chegava ao
banco: o ✓ da aba Minutas gravava `data_pagamento = hoje`, então a coluna guardava **"quando alguém
clicou"**, não **"quando a cliente pagou"**. Uma parcela quitada em junho e marcada em agosto virava
pagamento de agosto e inflava o mês.

**A correção é na origem:** marcar como paga agora abre o diálogo
[`MinutaPagamentoDialog`](../../../src/features/minutas/components/MinutaPagamentoDialog.tsx), que
**pergunta a data**. Hoje segue como default (é o caso comum), mas é editável antes de gravar.
Avisos, não bloqueios: data futura vira alerta e pagamento antes do vencimento vira nota — antecipar
é legítimo, e quem decide é o jurídico.

Nenhuma mudança de schema: `proc_parcelas.data_pagamento` já existia e sempre foi a data do
pagamento. E nenhuma mudança de fórmula — o cálculo estava certo o tempo todo.

> ⚠️ **O que já foi marcado antes de 26/ago continua com a data do clique.** Não dá para inferir a
> data real retroativamente (a informação nunca foi coletada). Corrija no diálogo "Editar minuta",
> parcela a parcela — a coluna "Pago em" é editável lá. Enquanto isso, meses antigos seguem
> enviesados.

Estorno (↺) continua direto: não há data a escolher.

## 2 · Editar a minuta

Novo [`MinutaEditDialog`](../../../src/features/minutas/components/MinutaEditDialog.tsx), aberto
pelo ✏️ da coluna de ações. Duas seções:

- **Dados da minuta** (o acordo): cliente, número do processo, título, dados bancários, PIX,
  observações.
- **Parcelas**: valor, vencimento, **"Pago em"**, observações — uma linha por parcela, com
  **acrescentar** e **remover**.

**Decisões:**

- **Recorrência e nº de parcelas NÃO são editáveis.** Mudá-los significaria regerar o plano de
  pagamento, e regerar apaga `data_pagamento` — o histórico de quem já pagou. Quem precisa de mais
  (ou menos) parcelas usa "Acrescentar parcela" / a lixeira da linha, que mexem só na parcela pedida.
  A recorrência aparece como informação, com o motivo escrito na tela.
- **Nada grava antes de "Salvar alterações".** O rascunho vive no estado local, então dá para
  ajustar várias linhas e desistir sem ter gravado nada pela metade. No salvamento a ordem é
  **remove → atualiza → acrescenta**, e só as parcelas que **realmente mudaram** viram `UPDATE`.
- **Sem RPC nova.** As policies `proc_acordos_rw` / `proc_parcelas_rw` são `for all` com
  `proc_can_access()`, então o app faz UPDATE/INSERT/DELETE direto pelo PostgREST com a RLS
  aplicada — mesmo caminho que `updateParcela` já usava.
- **`parcela_total` é reacertado no servidor** a cada acrescentar/remover (`syncParcelaTotal` em
  [`app/actions/minutas.ts`](../../../src/app/actions/minutas.ts)) — senão a coluna "Parcela 4/3"
  mente. ⚠️ **De propósito NÃO é um trigger:** a carga da planilha grava um total *maior* que o nº
  de linhas de propósito (um "Parcela 02/03" declara 3 mesmo com só 2 linhas carregadas), e um
  trigger achataria esse total toda vez que a carga rodasse. Na tela a intenção é inequívoca; na
  carga, não.
- **Remover não renumera** as demais: mudar o rótulo "Parcela 3/5" de linhas que ninguém pediu para
  mexer confundiria mais do que ajuda. O `num` da parcela nova é o maior que sobrou + 1 (a tabela
  tem `unique (acordo_id, num)` — reaproveitar número sobrescreveria parcela existente).

## 3 · Dados bancários + PIX (opcionais)

Duas colunas novas em `proc_acordos`: **`dados_bancarios`** e **`pix`**, ambas `text` e **não
obrigatórias**. Hoje essa informação vive solta dentro de `observacoes` — a planilha de origem
misturava CNPJ, agência e chave PIX no campo livre (foi inclusive a causa do bug de numeração da
carga; ver o doc da área). Vira campo próprio: quem paga precisa ler a chave sem garimpar texto
corrido.

Onde aparecem:

- **"Nova minuta"** e **"Editar minuta"** — dois campos, marcados "(opcional)".
- **Aba Minutas** — botão 🏦 na coluna de ações (só quando há dado). O `title` mostra o conteúdo;
  clicar **copia o PIX** (ou os dados bancários, quando não há PIX). Clipboard bloqueada não
  interrompe com alerta: o `title` já permite copiar à mão.
- **Calendário** — na agenda do dia, embaixo do nome da cliente. É ali que se olha "o que eu pago
  hoje".
- **Export CSV** — duas colunas novas no fim.

## 4 · Calendário: total lançado + mês civil / ciclo

A aba Calendário navegava só por **mês civil fixo** e não somava nada. Agora:

- **Toggle de recorte** — **Mês civil** (bate com extrato e contabilidade) e **Ciclo 11→10** (a
  convenção da operação), os mesmos dois do resto do painel. Trocar de recorte reposiciona na janela
  **corrente** daquele modo — a chave de um ciclo não existe na lista de meses (mesma decisão do
  `CeoPeriodPicker`).
- **Total lançado na janela** + quebra em **Pago / A pagar / Vencido**, com valor e contagem.
- A grade passou a ser montada a partir de `periodBounds(period)` em vez de
  `startOfMonth`/`endOfMonth`: o ciclo **atravessa dois meses civis** (11/ago → 10/set), e os dias
  fora da janela ficam esmaecidos.

**Decisões:**

- ⚠️ **Tudo no calendário é ancorado no VENCIMENTO — inclusive o "Pago".** Esta aba responde *"o que
  está lançado para vencer nesta janela e quanto disso já foi quitado"*, não *"quanto saiu do caixa
  neste mês"* (essa é a leitura da Visão Geral, que recorta a parcela paga pela data de pagamento).
  Misturar as duas âncoras num painel só faria os números não fecharem entre si. O rodapé da barra
  diz qual âncora está em uso.
- **"Ocultar pagas" não mexe nos totais.** É um filtro visual da grade; se mudasse o total, o número
  deixaria de responder "quanto foi lançado" e viraria "quanto sobrou na tela".
- **`ymdToLocalDate`** em vez de `new Date('2026-08-01')`: o construtor interpreta a string como UTC
  e, em BRT (UTC−3), cairia no dia 31/07 — a grade começaria um dia antes.
- O `capitalize` do cabeçalho saiu: o rótulo vem pronto de [`lib/period.ts`](../../../src/lib/period.ts)
  e é o mesmo texto dos seletores das outras abas.

Na **Visão Geral**, os dois primeiros KPIs passaram a dizer qual data leem ("por vencimento" / "por
data de pagamento") — sem isso, "A pagar + Pago" era lido como o total da janela, o que não é.

## Migration — `20260826_minutas_edicao_dados_bancarios.sql`

Idempotente. Faz três coisas:

1. `add column if not exists` de `dados_bancarios` e `pix` em `proc_acordos`.
2. **`proc_create_acordo` ganha dois parâmetros.** ⚠️ Acrescentar argumento **não substitui** a
   função — cria uma segunda sobrecarga e a chamada vira "function is not unique" (armadilha do
   [README das migrations](../../../supabase/migrations/README.md)). Por isso o `DROP FUNCTION` da
   assinatura antiga (9 args) vem **antes** do `CREATE`.
3. `proc_ingest_acordo` (carga da planilha) passa a mapear as duas chaves novas. Mesma assinatura
   `jsonb`, então `CREATE OR REPLACE` basta. O `coalesce(...)` no UPDATE garante que re-rodar a
   carga **não apaga** o que foi digitado no painel.

O script `scripts/import-minutas.mjs` não mudou (a planilha não tem essas colunas hoje); se um dia
tiver, basta emitir `dados_bancarios`/`pix` no nó JSON.

## Verificação

1. `npm run build` verde. ✅ (26/ago — `/minutas` em 16,5 kB)
2. Aplicar a migration e conferir a armadilha da sobrecarga:
   `SELECT pg_get_function_identity_arguments(oid) FROM pg_proc WHERE proname='proc_create_acordo';`
   → **uma** linha, terminando em `p_dados_bancarios text, p_pix text`.
3. **Data de pagamento:** marcar uma parcela como paga → o diálogo abre com hoje; trocar para um mês
   anterior e confirmar → a coluna "Pagamento" mostra a data escolhida, e o KPI "Pago na janela"
   soma no **mês escolhido**, não no atual.
4. **Edição:** ✏️ numa minuta → mudar cliente, preencher PIX, corrigir o "Pago em" de duas parcelas,
   acrescentar uma parcela e salvar → tudo persiste, e "Parcela N/M" mostra o total novo.
5. **Remover parcela:** lixeira numa linha → confirma → some; o `M` de "Parcela N/M" das demais cai
   em 1.
6. **Dados bancários:** 🏦 aparece só nas minutas com dado; clicar copia o PIX (ícone vira ✓).
   Conferir as duas colunas novas no CSV exportado.
7. **Calendário:** alternar Mês civil ↔ Ciclo 11→10 → o cabeçalho vira "11 ago – 10 set", a grade
   atravessa dois meses e os dias de fora ficam esmaecidos. **Total lançado = Pago + A pagar +
   Vencido** (confere na soma). Ligar "Ocultar pagas" → os chips somem da grade e **os totais não
   mudam**.
