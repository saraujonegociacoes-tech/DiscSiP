# Painel do CEO

Índice da documentação do **Painel do CEO** — a visão executiva do Blue Desk. É uma
**camada de leitura/agregação** por cima das verticais isoladas (Financeiro, CS,
Negociação, Leads, Monday/Projetos, Discador): consulta cada domínio e compõe em
RPCs/actions, **sem fundir os schemas**. Acesso restrito por um papel novo `ceo`. Ver
[`painel-ceo-sprints.md`](painel-ceo-sprints.md) para o roadmap completo e as decisões
travadas, e [`../links.md`](../../links.md) (índice geral por domínio).

> **Estado (31/jul/2026): Sprint 0 entregue e commitada** (`f336c17`). Papel `ceo` (migrations
> + RBAC no app), rota `/ceo` com as 4 abas em placeholder, helper `ceo_current_role()` e docs.
> A flag `NEXT_PUBLIC_CEO_ENABLED` nasce **desligada** — a rota existe mas mostra "Em breve" até
> haver dado. Nenhuma RPC de leitura ainda.
>
> **Banco pronto:** `20260729_ceo_role.sql` e `20260730_ceo_role_check.sql` aplicadas e
> confirmadas por introspecção.
>
> **Teste manual da trava: feito pelo dono em 31/jul** — `ceo` cai em `/ceo`, `agent` é barrado e
> volta para `/softphone`, `admin` entra. Verificado automaticamente antes disso: `tsc` limpo, lint
> sem erro novo, app sobe, `/ceo` compila e o middleware roda nela (sem sessão → `/login`).
> **O Sprint 0 está fechado.**
>
> **Sprint 1 — código entregue e NO AR (31/jul).** Vertical do Financeiro completa: migration
> [`20260731_financeiro_schema.sql`](../../../supabase/migrations/20260731_financeiro_schema.sql)
> (`fin_cards` + `fin_entries` + parsers + `ingest_financeiro_card` + `get_ceo_financeiro`),
> backfill `npm run import:financeiro`, aba Financeiro construída e doc do cenário Make.
> Mapeamento e achados em [`introspeccao-pipefy-financeiro.md`](introspeccao-pipefy-financeiro.md).
>
> **✅ SPRINT 1 FECHADA (31/jul) — testada pelo dono na tela, funcionando.** Ele aplicou a
> migration, rodou a carga histórica, montou o cenário Make, ligou
> `NEXT_PUBLIC_CEO_ENABLED=1` e abriu o painel: a aba Financeiro traz dado real.
>
> **Três camadas de verificação, todas verdes:**
> 1. **Ingestão** — `npm run verify:financeiro`: **4.549/4.549 cards**, **5.348 pagamentos**
>    (3.212 `parcela` + 2.136 `card` — as duas convenções), **0 divergências card a card**,
>    **32/32 meses**, total **R$ 7.310.222,27** idêntico ao Pipefy recomputado.
> 2. **Funções no banco (chamadas ao vivo, 31/jul)** — `fin_parse_date('10/07/2026')` →
>    `2026-07-10` e `('08/04/2026')` → `2026-04-08` (sem troca dia/mês);
>    `fin_parse_money('1.500,00')` → `1500.00`; `fin_entry_sign` → `-1` em desconto/devolução e
>    `1` em distrato.
> 3. **Tela** — aberta pelo dono, com sessão real. Era a única camada que dependia dele.

## Roadmap em sprints — estado atual

| Sprint | Entrega | Base de dado | Estado |
|---|---|---|---|
| 0 | **Fundação & trava** — papel `ceo`, rota `/ceo` (esqueleto multi-abas), helper `ceo_current_role()`, docs | — | ✅ **fechada** (30/jul) · trava testada pelo dono em 31/jul |
| 1 | **Financeiro — entradas do mês** (carro-chefe) — pipe Financeiro novo (vertical isolada), KPIs + série mensal | `fin_cards` + `fin_entries` (pipe `304386356`) | ✅ **fechada** (31/jul) — no ar, conferida e testada na tela |
| 2 | **Projeções de pagamento** — CS reusado + pipe Negociação novo (fase "Aguardando pagamento") | `neg_cards` (pipe `304370275`) + plano do CS | ✅ **fechada** (03/ago) — no ar, conferida (3.343/3.343, 0 divergências) e concluída pelo dono |
| 3 | **Saúde da empresa** — scorecard compondo Financeiro + Leads + CS + Monday + Discador | Agregação multi-domínio | ⏳ não iniciada |
| 4 | **Saúde da equipe / colaboradores** — saúde por pessoa (CS + Leads + Monday + Discador) | Agregação multi-domínio | ⏳ não iniciada |

## Pipes envolvidos

O painel puxa de **3 pipes** (mais os domínios já ingeridos para a saúde da empresa/equipe):

- **Financeiro** — pipe dedicado (só entradas gerais), **ainda não integrado**. Ingestão do
  zero como vertical isolada (`fin_cards` + `ingest_financeiro_card`). É o Sprint 1.
- **CS** — já integrado (pipe "3.3 - Customer Success", id `305801110`). **Reusado** para as
  projeções (fase "Aguardando Pagamento", id `343781769`, já seedada/ingerida). Ver
  [`dashboard-cs-indice.md`](../../painelcs-docs/updates/dashboard-cs-indice.md).
- **Negociação** — pipe **`304370275`** ("3.0 Negociação", 3.342 cards), **mapeado em 31/jul**
  ([`introspeccao-pipefy-negociacao.md`](introspeccao-pipefy-negociacao.md)), ainda não integrado.
  Ingestão nova como vertical isolada (`neg_cards` + `ingest_negociacao_card`), só o essencial das
  fases de espera de pagamento. É o **único a construir do zero** na parte de projeção.
  ⚠️ O **realizado** desse pipe já cai no pipe do Financeiro (conector `lan_ar_pagamento`), então
  `neg_cards` fornece **só a projeção** — somar os dois contaria o mesmo dinheiro duas vezes.

## Trava de acesso (papel `ceo`) — implementado no Sprint 0

Um papel novo `ceo` (novo valor permitido em `profiles.role`, que é `text` + CHECK, não enum —
ver abaixo). O acesso do CEO é centralizado
nas **RPCs de leitura do painel** (`SECURITY DEFINER` com guarda interna `IF
ceo_current_role() NOT IN ('ceo','admin') THEN RETURN`) em vez de espalhar `'ceo'` pelo RLS de
cada domínio — assim o Sprint 0 **não tocou em nenhuma policy em produção**. Helper
`ceo_current_role()` criado em
[`supabase/migrations/20260729_ceo_role.sql`](../../../supabase/migrations/20260729_ceo_role.sql).

**`ceo` é uma trava LATERAL, não um nível acima de `admin`.** Ele não opera o discador nem
gere usuários; nada herda dele e ele não herda de ninguém. No middleware isso virou o inverso
dos outros gates: em vez de listar quem entra numa área, listamos o que o `ceo` alcança
(`CEO_ROUTES = ['/ceo', '/ajuda']`) e todo o resto volta para `/ceo` — incluindo `/` e o
pós-login, que para os outros papéis vai para `/softphone`.

`NEXT_PUBLIC_CEO_ENABLED` nasce desligada e controla só o **lançamento** (a rota mostra "Em
breve"), não o acesso — quem barra é o middleware e, do Sprint 1 em diante, a guarda no banco.

### Pontos que o plano original não previu (achados na execução)

- **`/ajuda` quebrava para o papel `ceo`**: [`RoleBadge`](../../../src/features/ajuda/components/RoleBadge.tsx)
  faz `ROLES.find(...)!` e estouraria em `meta.color` (TypeError) com um papel ausente do
  array — e `/ajuda` é liberado a todos. Corrigido em
  [`src/features/ajuda/content/roles.ts`](../../../src/features/ajuda/content/roles.ts), que
  ganhou a entrada `ceo` e uma coluna na matriz de acesso.
- **`roleIncludes()`** é a escada da *operação* e `ceo` fica fora dela de propósito. Passou a
  devolver `false` explicitamente para papéis fora da escada (antes dependia do `indexOf` −1
  por acidente, que um reorder do array quebraria em silêncio).
- **Duas listas de papéis atribuíveis**, não uma: `ROLES` em
  [`src/app/actions/admin.ts`](../../../src/app/actions/admin.ts) valida no servidor, mas o
  select é populado por `ROLE_OPTIONS` em
  [`src/app/admin/AdminClient.tsx`](../../../src/app/admin/AdminClient.tsx). Só a primeira
  estava no plano — sem a segunda o papel ficaria inatribuível pela UI.
- **`profiles.role` não é enum** — é `text` (typtype=b) com o CHECK `profiles_role_check`
  limitando aos 5 papéis. Descoberto por introspecção ao vivo em 30/jul. A `20260729` tratava só
  o caso enum: detectou o não-enum e retornou sem fazer nada, o que era **correto quanto ao enum
  e incompleto quanto ao CHECK** — que rejeita `'ceo'` do mesmo jeito. Fechado por
  [`20260730_ceo_role_check.sql`](../../../supabase/migrations/20260730_ceo_role_check.sql).
  A lição: "não é enum" não significava "nada a fazer", significava "procure o CHECK".

## Arquitetura (decisões travadas)

- **Verticais isoladas, não schema genérico multi-pipe** (decisão reafirmada do CS): cada pipe
  tem tabelas/RLS/RPCs próprios. Financeiro e Negociação são clones do molde do CS.
- **Painel do CEO = camada de leitura/agregação** por cima das verticais — compõe em RPCs/actions,
  não funde schemas.
- **Ingestão**: Pipefy → Make (poll agendado) → RPC `ingest_*` no Supabase. O app só **lê** sob
  RLS. Migrations e cenários Make são **aplicados à mão pelo dono** (padrão do repo).

## Riscos & dependências

- ~~**Financeiro**: pipe ID + mapeamento de field-ids~~ — **resolvido em 31/jul** por introspecção
  ao vivo (pipe `304386356`); ver [`introspeccao-pipefy-financeiro.md`](introspeccao-pipefy-financeiro.md).
  **Negociação** (Sprint 2) segue pendente — mesmas queries, outro `pipeId`.
- ~~**Papel `ceo`**: confirmar o nome do enum~~ — resolvido (30/jul): **não é enum**, é `text` com
  o CHECK `profiles_role_check`. **As duas migrations foram aplicadas em 30/jul**: a `20260729`
  criou `ceo_current_role()` e a
  [`20260730_ceo_role_check.sql`](../../../supabase/migrations/20260730_ceo_role_check.sql)
  liberou `'ceo'` no CHECK (confirmado por `pg_get_constraintdef`). O lado do banco está fechado.
- **`supabase/` voltou a ser versionado** (decisão do dono, 29/jul): a pasta ignorada existia só
  no worktree `discsip`, e como migrations são um log append-only aplicado a **um** banco, as
  cópias divergiam em silêncio (git não avisa sobre untracked). Efeito colateral bom: os links
  relativos destes docs para `supabase/migrations/*.sql` voltaram a resolver.
- **Leads não versionado** (Sprints 3/4): RPCs/tabelas base só na base ao vivo — extrair antes de
  depender. Confirmado na execução do Sprint 0: `supabase/manual/` não existe em nenhum worktree.
- **Identidade não unificada** (Sprint 4): `lead_agents`/`cs_agents` por `pipefy_user_id`;
  Monday/Discador por `profiles`; a ponte `lead_agents.profile_id` está vazia.

## Próximo passo (retomar daqui)

**Os três bloqueios da Sprint 1 caíram em 31/jul.** A introspecção do Pipefy foi escrita, rodada e
documentada em [`introspeccao-pipefy-financeiro.md`](introspeccao-pipefy-financeiro.md) — leia lá o
mapeamento completo. Resumo:

1. ~~ID do pipe~~ → **`304386356`** ("2.0 - Financeiro"), env `FINANCEIRO_PIPEFY_PIPE_ID`.
2. ~~Field-ids~~ → valor = `valor_de_contrata_o`, data = `data_do_pagamento`, categoria =
   `COALESCE` de **três** campos de "referência".
3. ~~Mês civil ou ciclo~~ → **ambos**, toggle no `PeriodPicker`, default mês civil.

Mais quatro decisões do dono saíram da conversa sobre os achados: histórico **completo** (com
`fin_entries`), estornos **com sinal** (desconto/devolução negativos), "Jurídico" **normalizado**
para "Negociação", e duplicidade como **aviso** que leva a categoria em conta.

**Achados que mudaram o desenho** (nenhum era visível na lista de field-ids — vieram da amostra de
valores reais e da varredura de até 1.200 cards):

- **`fin_parse_date` não pode ser clone do `cs_parse_date`.** O do CS faz `left(raw,10)::date`
  (ISO); este pipe manda `DD/MM/YYYY` em **100%** dos cards e `datetime_value` sempre `null`. O
  clone zeraria toda data **em silêncio** (o parser engole a exceção e devolve `NULL`) e o painel
  mostraria mês vazio. `fin_parse_money`, esse sim, é clone fiel — já trata `"1.500,00"`.
- **O pipe tem duas convenções de parcelamento.** Card de 2026 = 1 pagamento; card de 2024/2025
  pode carregar até 4, **com datas em meses diferentes** (222 de 1.200 cards), e nesses o
  `valor_de_contrata_o` é inconsistente. Por isso o modelo é `fin_cards` + a tabela-filha
  **`fin_entries`** (um pagamento por linha), decisão do dono de cobrir o histórico inteiro.
  ⚠️ A primeira varredura (180 cards, todos recentes) concluiu o **oposto** — "1 card = 1 entrada" —
  e a conclusão só caiu ao ampliar a amostra. Amostra recente não revela mudança de convenção.
- **Categoria são três campos**, escolhidos pelo departamento → `COALESCE`, nunca `CASE`.
  `"Departamento - Jurídico"` é o **nome antigo** de "Negociação" (o campo foi renomeado e o
  histórico ficou com o velho), então a ingestão normaliza os dois para o mesmo valor.
- **Sinal por categoria:** desconto e devolução entram **negativos**; distrato e reversão, positivos.
- **`n_mera_o_do_pagamento_id` não é chave do pagamento** — repete entre cards com valores
  diferentes (é referência de contrato). Dedupe da ingestão continua por `pipefy_card_id`, e o
  mesmo contrato em vários cards é quase sempre legítimo: só mesmo valor + mesma categoria + mesmo
  dia vira **aviso** de duplicidade (2 casos em 360 cards).

**A Sprint 1 está fechada (31/jul):** código entregue, migration aplicada, carga histórica rodada,
Make montado, flag ligada e conferência batendo 100%. A aba Financeiro serve dado real.

**A Sprint 2 (Projeções de pagamento) — NO AR desde 03/ago.** As 4 decisões do dono foram tomadas
(a #1 **contra** a minha recomendação — ver abaixo) e a vertical foi construída:
[`20260731b_negociacao_schema.sql`](../../../supabase/migrations/20260731b_negociacao_schema.sql)
(`neg_cards` + parsers + `ingest_negociacao_card` + `get_ceo_projecoes_negociacao` +
`get_ceo_projecoes_cs` + `get_ceo_projecoes`), backfill `npm run import:negociacao`, conferência
`npm run verify:negociacao`, aba `CeoProjecoes` e doc do Make.

**Executado pelo dono em 03/ago:** ✅ [`20260731b`](../../../supabase/migrations/20260731b_negociacao_schema.sql)
(schema/ingestão/RPCs) · ✅ [`20260731c`](../../../supabase/migrations/20260731c_ceo_guard_null_safe.sql)
(guarda) · ✅ `npm run import:negociacao` (3.343 cards) · ✅ cenário Make ·
✅ card de teste órfão do CS removido.

✅ [`20260803`](../../../supabase/migrations/20260803_negociacao_fase_unica.sql) (fase única)
aplicada e confirmada ao vivo — `neg_is_waiting_phase('338815768')` → `false`.

⚠️ Ela **rodou sem efeito na primeira tentativa**: a `20260731b` redefine a mesma função com a
versão de duas fases, então reexecutar aquele arquivo desfaz a correção **em silêncio**. Os dois
ganharam aviso no ponto exato. Conferência que pega:
`SELECT public.neg_is_waiting_phase('338815768');` → **false**.

**A Sprint 2 está fechada (03/ago):** código entregue, 3 migrations aplicadas, backfill rodado,
Make montado, conferência batendo e o dono deu por concluída.

**Conferência: ✅ passou** (`npm run verify:negociacao`, 03/ago) — 3.343/3.343 cards, 0 faltando,
**0 divergências de dado**, e o total bate dos dois lados: **R$ 10.000,00 em 8 cards**
(R$ 4.750,00 vencidos em 5 cards · R$ 5.250,00 a vencer em até 30 dias em 3). Por sinal: 5 de
`parcela2`, 3 de `fase`.

⚠️ Também em 03/ago, a conferência achou um **bug de segurança na guarda** das RPCs do painel —
`ceo_current_role()` devolvia NULL e `NULL NOT IN (...)` não bloqueia. Afetava as 4 RPCs, inclusive
a do Financeiro **em produção**. Corrigido e aplicado
([`20260731c`](../../../supabase/migrations/20260731c_ceo_guard_null_safe.sql), [fix
documentado](../fixes/correcao-guarda-ceo-null.md)); confirmado ao vivo que as 4 voltam `NULL` para
quem não é `ceo`/`admin`.

O mapeamento completo está em
[`introspeccao-pipefy-negociacao.md`](introspeccao-pipefy-negociacao.md). Resumo:

1. ~~ID do pipe~~ → **`304370275`** ("3.0 Negociação", 3.342 cards), env `NEGOCIACAO_PIPEFY_PIPE_ID`.
   O candidato alternativo `306994213` ("2.1 - Controle de Vendas") está **descartado**: 0 cards em
   todas as 8 fases, pipe montado e nunca usado.
2. ~~Field-ids + fase~~ → fase **`326422800`** ("Aguardando pagamento ⏳💰", 14 cards); valor =
   `informe_o_valor_do_pagamento`, data = `informe_a_data_agendada_para_o_pagamento_1`, flag de pago
   = `o_pagamento_foi_reaizado`, categoria = `sele_o_de_lista` ("Produto contratado", 100%
   preenchido).
3. Parsers → **clones fiéis dos do Financeiro** (`fin_parse_date` já engole `DD/MM/YYYY HH:MM`,
   confirmado por chamada ao vivo).

**Três achados que mudaram o desenho** (nenhum aparecia na lista de field-ids):

- ⚠️ **O realizado da Negociação já está no Financeiro.** O conector `lan_ar_pagamento` da fase
  aponta para o pipe `304386356` — o mesmo do Sprint 1, e os cards ligados estão em "Pagamento
  finalizado". `neg_cards` fornece **só a projeção**; somar o realizado contaria o mesmo dinheiro
  duas vezes entre as abas Financeiro e Projeções.
- ⚠️ **`o_pagamento_foi_reaizado = 'Sim'` ⟺ tem conexão com o Financeiro — em 24/24 cards.**
  Correlação perfeita, então o flag é o sinal anti-dupla-contagem, e é barato (está no `metadata`).
  Sem ele a projeção da fase é R$ 10.500,00; com ele, **R$ 4.000,00**.
- **A fase de projeção é `326422800`, e só ela.** 6 dos 14 cards não têm valor nem data nos campos
  da fase — nesses o sinal é a 2ª parcela da venda, quase sempre vencida. ❌ Eu havia recomendado
  incluir também **"Pré - Triagem - 2° Parcela📝"** (`338815768`) por estar mais bem preenchida;
  **o dono corrigiu em 03/ago — aquela fase é do Comercial.** Removida na
  [`20260803`](../../../supabase/migrations/20260803_negociacao_fase_unica.sql). Lição:
  **densidade de preenchimento não é sinal de pertencimento.**

**A armadilha de formato deste pipe é o INVERSO da do Financeiro.** Lá `datetime_value` vinha sempre
`null` e a regra virou "use `value`, é o que existe". Aqui os campos `datetime`/`due_date` trazem
`datetime_value` em **100%** dos casos — e **em UTC**, enquanto o `value` é local. **79 de 968 cards
(8,2%)** caem no **dia errado** por isso (`"06/08/2026 21:00"` → `"2026-08-07T00:00Z"`). Demonstrado
ao vivo: `fin_parse_date('2026-08-07T00:00:54+00:00')` → `2026-08-07`, errado;
`fin_parse_date('06/08/2026 21:00')` → `2026-08-06`, certo. A regra do repo vira:
> **Campo de data do Pipefy: parse sempre o `value`. O `datetime_value` ou não existe (`date`) ou
> está em UTC (`datetime`/`due_date`).**

⚠️ **A metade do CS não está bloqueada por código, está sem dado.** A P4 do painel de CS **já foi
construída** ([`20260730b_cs_pagamento.sql`](../../../supabase/migrations/20260730b_cs_pagamento.sql),
aplicada, com `get_cs_pagamento_projecao()`), e este índice dizia que ela não existia. Mas conferido
ao vivo em 31/jul: a fase "Aguardando Pagamento" (`343781769`) tinha **1 card, "teste filipe"**, e
**1 de 1.493 `cs_cards`** com plano de pagamento preenchido — o mesmo card, que o dono depois
apagou. Ou seja: **o CS hoje contribui zero para a projeção.**

Mesmo assim `get_ceo_projecoes_cs()` **foi escrita** (decisão do dono): ela é mecânica, os slugs já
estão provados pela migration aplicada, e assim a aba soma CS + Negociação sem retrabalho no dia em
que a operação adotar a fase. Ela volta vazia hoje, e **isso é esperado, não bug** — a aba mostra o
total **por origem** justamente pra que o zero do CS apareça como causa explícita, em vez de virar
um número que "parece baixo". Os field-ids que este índice listava estavam errados (eram os das
**minutas**); os certos são `1_parcela_valor`/`1_parcela_data_do_pagamento` + os `copy_of_*`.

**A lição do Sprint 1 foi aplicada:** a varredura cobriu o **pipe inteiro** (3.342 cards, 112
páginas), não uma amostra recente. Desta vez não havia quebra de convenção escondida — o formato é
uniforme desde 2024; o que muda por ano é só o quanto os campos são usados.

~~**Falta decidir (bloqueia a migration)**~~ — **as 4 decisões saíram em 31/jul**, todas pelas
recomendações: projeção das **duas** fases de espera · card já pago **fora** · 2ª parcela vencida
**é** projeção (em janela própria) · RPC do CS **escrita** mesmo sem dado.

**Próximo passo daqui: Sprint 3 (Saúde da empresa).** O risco conhecido dela continua de pé e é o
primeiro bloqueio a atacar: as RPCs/tabelas base de **Leads não estão versionadas** no repo (só na
base ao vivo, `supabase/manual/leads_dashboard_setup.sql` ausente em todos os worktrees) — extrair
do Supabase antes de depender delas.

**Ponto menor em aberto:** se os campos de desconto de um pagamento normal
(`informe_a_soma_total_dos_descontos_conforme_a_listagem_acima` + a checklist) deveriam afetar o
sinal. Hoje só a **categoria** `Desconto - Devolução` entra negativa. Se mudar, é uma linha em
`fin_entry_sign`.

~~**Também pendente:** o teste manual da trava (3 casos por papel)~~ — **feito pelo dono em 31/jul**.

## Referências

- [`painel-ceo-sprints.md`](painel-ceo-sprints.md) — roadmap em sprints + decisões travadas (fonte
  de verdade do projeto).
- [`introspeccao-pipefy-financeiro.md`](introspeccao-pipefy-financeiro.md) — **mapeamento do pipe
  Financeiro** (resultado da introspecção) + as queries reutilizáveis para o pipe de Negociação.
- [`dashboard-cs-indice.md`](../../painelcs-docs/updates/dashboard-cs-indice.md) — painel de CS
  (molde a reutilizar; fase de projeção).
- [`make-integracao-cs.md`](../../painelcs-docs/updates/make-integracao-cs.md) — cenário Pipefy →
  Make → Supabase (clone p/ Financeiro/Negociação).
- [`../links.md`](../../links.md) — índice mestre da documentação.
