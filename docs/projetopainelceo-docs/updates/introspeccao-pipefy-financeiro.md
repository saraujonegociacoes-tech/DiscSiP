# Introspecção do pipe Financeiro (Pipefy) — resultado

> ⚠️ **O MAPEAMENTO DE VALOR MUDOU EM 10/ago.** A entrada do painel é o **"Valor do Pagamento
> Líquido"** (`copy_of_valor_do_pagamento_bruto`), não mais `valor_de_contrata_o`, e **os campos
> de parcela não são mais lidos** — um card, uma entrada. Ver
> [`financeiro-valor-liquido.md`](financeiro-valor-liquido.md). O documento abaixo continua
> valendo como **mapa do pipe** (todos os field-ids, os parsers, os achados); o que envelheceu é
> qual campo alimenta `fin_entries`, marcado nos dois pontos afetados.

> Criado e **executado** em 2026-07-31. As queries do fim deste arquivo devolvem, numa rodada, o
> **pipe ID** e **todos os field-ids** de um pipe. Rodadas contra o Financeiro, elas destravaram o
> [Sprint 1](painel-ceo-sprints.md#sprint-1--financeiro-entradas-do-mês) — o mapeamento abaixo é o
> que entra em `ingest_financeiro_card`. **As queries continuam válidas para o Sprint 2** (pipe de
> Negociação): é só trocar o `pipeId`.

## Resultado — o que o Sprint 1 precisava

**Pipe:** `304386356` — "2.0 - Financeiro" (org `301324031`, Araújo Negociações) →
`FINANCEIRO_PIPEFY_PIPE_ID=304386356`.

### Modelo: `fin_cards` + `fin_entries`

O pipe **mudou de convenção no meio de 2025** (achado 3), então um card pode valer 1 ou até 4
pagamentos, cada um com data própria. O card vira uma linha em `fin_cards` (contexto: cliente,
categoria, departamento) e cada pagamento vira uma linha em **`fin_entries`** (valor + data). É
`fin_entries` que alimenta o KPI e a série mensal.

**`fin_cards` — contexto do card**

| Coluna | Field-id | Tipo | Observação |
|---|---|---|---|
| `charged_value` | `valor_total_da_cobran_a` | `currency` | o que foi cobrado; difere do pago quando há desconto |
| `paid_value` | `valor_de_contrata_o` | `currency` | "Valor que o Cliente Pagou?" — era a fonte da entrada até 10/ago; hoje só contexto |
| `net_value` | `copy_of_valor_do_pagamento_bruto` | `currency` | label diz "Líquido", o id diz "bruto" (herança de um `copy_of`) — **é a entrada do painel desde 10/ago** |
| `paid_date` | `data_do_pagamento` | `date` | **`DD/MM/YYYY`** — ver parsers |
| `category` | `COALESCE` de 3 campos | `select` | achado 1 |
| `department` | `informe_o_seu_departamento` | `radio_vertical` | normalizado — achado 2 |
| `payment_method` | `forma_de_pagamento` | `radio_horizontal` | Pix/Boleto/Link/Dinheiro/Maquininha |
| `contract_ref` | `n_mera_o_do_pagamento_id` | `number` | **não é chave única** — achado 4 |

**`fin_entries` — um pagamento por linha** (`fin_card_id`, `entry_value`, `entry_date`, `seq`)

> ⚠️ **Desatualizado desde 10/ago.** As duas convenções abaixo descrevem o que a Sprint 1
> implementou. Hoje a ingestão gera **uma linha por card**, de `copy_of_valor_do_pagamento_bruto`
> ("Valor do Pagamento Líquido") + `data_do_pagamento`, e ignora os campos de parcela — decisão do
> dono. Fica aqui porque explica **por que a tabela-filha existe** e o que há no pipe.

A ingestão gerava as linhas assim, e era o **único** ponto que precisava saber das duas convenções:

- **Card com campo de parcela preenchido** (convenção antiga): uma linha por parcela, de
  `informe_o_valor_pago_referente_a_N_parcela` + `informe_a_data_do_pagamento_da_N_parcela`.
  Descartar parcela com valor `0,00`. **Ignorar `valor_de_contrata_o` nesses cards** — ele é
  inconsistente (achado 3).
- **Card sem nenhum campo de parcela** (convenção nova, todo 2026): uma linha só, de
  `valor_de_contrata_o` + `data_do_pagamento`.

Os ids da 4ª parcela são `copy_of_informe_o_valor_pago_referente_a_4_parcela` e
`copy_of_informe_a_data_do_pagamento_da_3_parcela` — o segundo diz "3" mas é a data da **4ª**
(herança de `copy_of`). Copiar dos ids, não do nome.

**Sinal** (`fin_entry_sign(category)`): `-1` para categoria de desconto/devolução, `+1` para o
resto — distrato e reversão são entradas normais (decisão do dono, 31/jul). Categoria nova nasce
positiva; virar negativa exige entrar na lista, que é o default seguro.

### Fases

| Fase | ID | Cards | Conta como entrada? |
|---|---|---|---|
| Triagem de pagamentos | `326516174` | 90 | ✅ |
| Assinatura em Andamento | `327103358` | 14 | ✅ |
| Análise de finalização | `328102698` | 0 | ✅ |
| Pagamento finalizado | `326516176` | 4.435 | ✅ |
| **Pagamento cancelado** | `327456661` | 10 | ❌ **excluir** |

Decisão do dono (31/jul): conta tudo menos "Pagamento cancelado" — o dinheiro entra quando o card
nasce; as fases seguintes são conferência interna. A RPC filtra por `current_phase_id <> '327456661'`.

### Parsers — e por que **não** dá pra clonar os dois do CS

Verificado no dado real (`datetime_value` e `array_value` vêm **`null`**; só existe `value`):

```
data_do_pagamento        [date]     value="10/07/2026"  datetime_value=null
valor_de_contrata_o      [currency] value="1.500,00"    datetime_value=null
```

- **`fin_parse_money` = clone fiel de `cs_parse_money`.** O ramo brasileiro dele (`,[0-9]{1,2}$` →
  tira o ponto de milhar, vírgula vira ponto) já converte `"1.500,00"` → `1500.00` e
  `"2.327,87"` → `2327.87`. Nada a mudar.
- **`fin_parse_date` NÃO pode ser clone de `cs_parse_date`.**
  [`cs_parse_date`](../../../supabase/migrations/20260727_cs_minutas.sql#L53) faz
  `left(trim(raw),10)::date`, que pressupõe ISO — com `"10/07/2026"` ele estoura e cai no
  `EXCEPTION → NULL`. Como **100% dos cards** vêm em `DD/MM/YYYY` (0 de 180 em ISO), o clone
  zeraria a data de **todas** as entradas e o painel mostraria o mês vazio, sem erro nenhum.
  `fin_parse_date` precisa de `to_date(s, 'DD/MM/YYYY')`, mantendo o fallback ISO por segurança.

> Este é o item que só a **amostra de valores reais** pega — a lista de field-ids sozinha diria
> `type: date` e a gente teria clonado o parser errado.
>
> **Não é hipótese: o CS levou exatamente esse bug em produção no dia anterior.** O
> `data_da_quita_o` também vem em `DD/MM/YYYY`, o `::date` castou em MDY e o vencimento das
> minutas apareceu com dia e mês trocados (08/04 virou 04/08) — ver
> [`correcao-data-quitacao-ddmmyyyy.md`](../../painelcs-docs/fixes/correcao-data-quitacao-ddmmyyyy.md).
> No Financeiro o erro não chegou a acontecer porque a amostra veio antes do parser.
> **Regra pra todo pipe novo: campo `date` do Pipefy não vem em ISO.**

**Confirmado ao vivo no banco (31/jul), depois da migration aplicada:**

| chamada | resultado |
|---|---|
| `fin_parse_date('10/07/2026')` | `2026-07-10` |
| `fin_parse_date('08/04/2026')` | `2026-04-08` (sem troca dia/mês) |
| `fin_parse_money('1.500,00')` | `1500.00` |
| `fin_entry_sign('Desconto - Devolução')` | `-1` |
| `fin_entry_sign('Pagamento - Distrato')` | `1` |

## Achados que mudaram o plano do Sprint 1

Medidos com `node scripts/probe-financeiro-fields.mjs 304386356 --scan N`. **Atenção à amostra:** a
primeira varredura (180 cards) pegou só cards recentes e produziu uma conclusão **errada** sobre
parcelas, corrigida no achado 3 com 1.200 cards. Os números abaixo dizem de qual amostra vêm.

1. **"Categoria" são três campos, não um.** Qual está preenchido depende do departamento:
   `refer_ncia_do_pagamento` (Comercial) · `refer_ncia_do_pagamento_juridico` (Negociação) ·
   `copy_of_refer_ncia_do_pagamento_juridico` (Quitação). Logo `category` é um
   `COALESCE(NULLIF(...))` das três, na ordem acima — não um `CASE` por departamento.
   *Ressalva (360 cards):* **2 cards** têm **duas** referências preenchidas ao mesmo tempo, e aí a
   ordem do `COALESCE` é que decide. São 0,6% e as duas escolhas são defensáveis; não vale
   complicar, mas está registrado.
2. **"Departamento - Jurídico" é o nome ANTIGO de "Departamento - Negociação"** (confirmado pelo
   dono, 31/jul) — o campo foi renomeado e o histórico ficou com o nome velho, que por isso não
   aparece nas opções atuais do `radio_vertical`. Era 45 de 180 cards na primeira amostra. **A
   ingestão normaliza** (`'Departamento - Jurídico'` → `'Departamento - Negociação'`), senão o
   mesmo departamento vira duas fatias no gráfico. Isso também explica por que os dois usam o mesmo
   campo de referência.
3. ⚠️ **CORRIGIDO — "1 card = 1 entrada" só vale para 2026.** Com 180 cards recentes, nenhum tinha
   campo de parcela preenchido e a conclusão foi que a tabela-filha era desnecessária. **Com 1.200
   cards, 222 têm 2, 3 ou 4 parcelas preenchidas** — o card é vários pagamentos, às vezes em
   **meses diferentes**:

   ```
   #1000451470  valor_de_contrata_o = 2.000,00
      1ª parcela: 1.000,00  em 27/09/2024
      2ª parcela: 1.000,00  em 27/10/2024   ← outro mês
   ```

   | campos de parcela preenchidos | cards (de 1.200) |
   |---|---|
   | nenhum (convenção nova) | 317 |
   | 1 | 661 |
   | **2 a 4** | **222** |

   Por ano de criação: **2024** → 679 com / 52 sem · **2025** → 204 / 161 · **2026** → **0 com** /
   104 sem. A convenção virou no meio de 2025; hoje é 1 card por parcela, via
   `esse_pagamento_referente_a_qual_parcela`.

   Pior, `valor_de_contrata_o` nesses cards antigos é **inconsistente**: bate com a 1ª parcela em
   773 casos e diverge em 102 — às vezes é a soma, às vezes só a primeira. Por isso `fin_entries`
   ignora esse campo quando há parcela preenchida. **É este achado que criou a tabela-filha.**
4. **`n_mera_o_do_pagamento_id` NÃO é id do pagamento** — é referência de contrato/cliente, e
   vários pagamentos apontam pra ela. A chave de dedupe da ingestão é **`pipefy_card_id`**, como no
   CS. Em 360 cards, 22 contratos aparecem em mais de um card, e **a maioria é legítima**:

   | classificação | grupos | leitura |
   |---|---|---|
   | mesma categoria, valor/dia diferentes | 13 | parcelas ou pagamentos distintos |
   | **categorias diferentes** | 7 | entradas legítimas distintas |
   | mesmo valor + mesma categoria + mesmo dia | **2** | suspeita forte de duplicata |

   Foi o dono quem apontou que a categoria precisa entrar na regra: dois cards do mesmo contrato
   podem ser um pagamento e um desconto, por exemplo. Daí o alerta ser **só** para o trio
   valor + categoria + dia iguais — e ser **aviso, nunca dedupe automático**:
   `ok 1254893007: 1.000,00 Homologação | 1.889,00 Contratação - Redução` é dado bom.
   Os 2 suspeitos da amostra: `1336145071` (915,00 · Antecipação Quitação · 14/07/2026, em dois
   departamentos) e `1248853638` (1.754,00 · Homologação · 24/11/2025, no mesmo departamento).
5. **Categorias e sinal** (360 cards). As duas maiores são `Contratação - Redução` (151 cards) e
   `Homologação` (95). `Desconto - Devolução` apareceu 1×, `Pagamento - Distrato` 9×, `Reversão`
   nenhuma vez. Regra do dono: **distrato e reversão são positivos; desconto e devolução são
   negativos.**
6. **Higiene boa:** 0 cards sem data, 0 sem valor pago, formato de data 100% uniforme.

## Decisões do dono (31/jul)

| Pergunta | Resposta |
|---|---|
| Qual valor é "a entrada" | ~~`valor_de_contrata_o` — "Valor que o Cliente Pagou?"~~ → **revisto em 10/ago: `copy_of_valor_do_pagamento_bruto`, "Valor do Pagamento Líquido", para todo card** |
| Quais fases contam | todas menos "Pagamento cancelado" (`327456661`) |
| Mês civil ou ciclo 11→10 | **ambos** — `PeriodPicker` com toggle; **default mês civil** |
| Até onde vai o histórico | **tudo**, com a tabela-filha `fin_entries` |
| Estornos | **distrato e reversão positivos; desconto e devolução negativos** |
| "Departamento - Jurídico" | nome antigo de "Negociação" → normalizar na ingestão |
| Duplicidade | ~~**avisar**, nunca deduplicar — e a regra tem que olhar a categoria~~ → **o aviso saiu da aba em 10/ago** (pedido do dono). Nunca houve dedupe |

O "ambos" é barato porque a RPC já recebe `p_start`/`p_end`: quem define a janela é o frontend.
O ciclo reusa [`src/lib/period.ts`](../../../src/lib/period.ts); o mês civil é `date_trunc('month')`.

---

## As queries (reutilizáveis — Sprint 2 troca só o `pipeId`)

**Onde rodar:** <https://app.pipefy.com/graphiql> (logado). Endpoint por token:
`POST https://api.pipefy.com/graphql` com `Authorization: Bearer $PIPEFY_TOKEN`.

**Atalho:** `npm run probe:financeiro` roda tudo isto com o `PIPEFY_TOKEN` do `.env.local` e imprime
um resumo compacto —
[`scripts/probe-financeiro-fields.mjs`](../../../scripts/probe-financeiro-fields.mjs). Sem pipe ID
configurado, lista os pipes da org sozinho; com `--scan N`, roda a análise de risco de schema
(achados 1–6 acima) sobre N páginas de 30 cards.

### 1. Achar o pipe ID

```graphql
query MeusPipes {
  organizations {
    id
    name
    pipes { id name }
  }
}
```

> Se `organizations` reclamar de permissão: `query { me { organizations { id name pipes { id name } } } }`.

### 2. A principal — pipe ID + todos os field-ids

```graphql
query IntrospeccaoPipe($pipeId: ID!) {
  pipe(id: $pipeId) {
    id
    name
    start_form_fields { id label type required options }
    phases {
      id
      name
      cards_count
      fields { id label type required options }
    }
    labels { id name }
  }
}
```

Variables: `{ "pipeId": "304386356" }`

| Campo | Para que serve |
|---|---|
| `pipe.id` | a env do backfill + do cenário Make |
| `start_form_fields[].id` | onde valor/data/categoria moram neste pipe (todos os 44 estão aqui) |
| `phases[].fields[].id` | campos que só existem depois que o card entra na fase |
| `type` | escolhe o parser (`currency` → money, `date` → date) |
| `options` | os valores possíveis da categoria |
| `labels` | plano B se "categoria" for etiqueta em vez de campo |
| `phases[].cards_count` | onde os cards estão — e qual fase excluir |

> **`id` é o slug, e é ele que importa:** a ingestão indexa `metadata` por `f->'field'->>'id'`
> (ver [`20260715_cs_pipeline_schema.sql:285`](../../../supabase/migrations/20260715_cs_pipeline_schema.sql#L285)),
> então o mapeamento em `ingest_financeiro_card` referencia exatamente essas strings — nunca o
> `internal_id` nem o label.
>
> Se a query inteira falhar, tire `cards_count`, `options` e `labels`: o Pipefy derruba a query
> toda quando um campo não existe na versão da API da conta.

### 3. Amostra — os valores reais

Sem ela o mapeamento fica certo e o **parser errado** (foi o que pegou o `DD/MM/YYYY`).

```graphql
query AmostraCards($pipeId: ID!) {
  allCards(pipeId: $pipeId, first: 5) {
    edges {
      node {
        id
        title
        created_at
        current_phase { id name }
        fields {
          name
          value
          array_value
          datetime_value
          field { id type }
        }
      }
    }
  }
}
```

Olhe os **três** sub-valores: `value` costuma vir localizado (`"10/07/2026"`, `"1.500,00"`),
`datetime_value` traz o ISO **quando existe** (neste pipe, nunca) e `array_value` aparece em
conector/anexo/checklist.

> ⚠️ **`first: 5` só mostra os cards mais novos.** Foi assim que a conclusão errada do achado 3
> nasceu: pipe antigo muda de convenção no meio do caminho, e a amostra recente não denuncia. Antes
> de fechar o schema, rode `--scan` com páginas suficientes para alcançar os anos anteriores e
> confira a quebra **por ano de criação** que ele imprime.

## Referências

- [`painel-ceo-sprints.md`](painel-ceo-sprints.md) — roadmap; o Sprint 1 consome este resultado.
- [`painel-ceo-indice.md`](painel-ceo-indice.md) — índice/estado do painel.
- [`scripts/probe-cs-connection.mjs`](../../../scripts/probe-cs-connection.mjs) — probe equivalente
  do CS (molde deste).
- [`make-integracao-cs.md`](../../painelcs-docs/updates/make-integracao-cs.md) — cenário
  Pipefy → Make → Supabase que o Financeiro vai clonar.
