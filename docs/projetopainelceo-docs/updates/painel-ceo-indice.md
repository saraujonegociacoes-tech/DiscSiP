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
> **O dono executou em 31/jul:** migration aplicada · carga histórica rodada · cenário Make
> montado · `NEXT_PUBLIC_CEO_ENABLED=1` no `.env`. A aba está servindo dado real.
>
> **Conferência numérica: ✅ passou (31/jul)** — `npm run verify:financeiro` recomputa as entradas
> do Pipefy cru e compara com o banco: **4.549/4.549 cards**, **5.348 pagamentos** (3.212 por
> parcela + 2.136 por card — as duas convenções), **0 divergências card a card**, **32/32 meses
> batendo**, total geral **R$ 7.310.222,27** idêntico dos dois lados.

## Roadmap em sprints — estado atual

| Sprint | Entrega | Base de dado | Estado |
|---|---|---|---|
| 0 | **Fundação & trava** — papel `ceo`, rota `/ceo` (esqueleto multi-abas), helper `ceo_current_role()`, docs | — | ✅ **fechada** (30/jul) · trava testada pelo dono em 31/jul |
| 1 | **Financeiro — entradas do mês** (carro-chefe) — pipe Financeiro novo (vertical isolada), KPIs + série mensal | `fin_cards` + `fin_entries` (pipe `304386356`) | ✅ **código entregue** (31/jul) · falta aplicar migration + backfill + Make |
| 2 | **Projeções de pagamento** — CS reusado + pipe Negociação novo (fase "Aguardando Pagamento") | Snapshot (CS + Negociação) | ⏳ não iniciada |
| 3 | **Saúde da empresa** — scorecard compondo Financeiro + Leads + CS + Monday + Discador | Agregação multi-domínio | ⏳ não iniciada |
| 4 | **Saúde da equipe / colaboradores** — saúde por pessoa (CS + Leads + Monday + Discador) | Agregação multi-domínio | ⏳ não iniciada |

## Pipes envolvidos

O painel puxa de **3 pipes** (mais os domínios já ingeridos para a saúde da empresa/equipe):

- **Financeiro** — pipe dedicado (só entradas gerais), **ainda não integrado**. Ingestão do
  zero como vertical isolada (`fin_cards` + `ingest_financeiro_card`). É o Sprint 1.
- **CS** — já integrado (pipe "3.3 - Customer Success", id `305801110`). **Reusado** para as
  projeções (fase "Aguardando Pagamento", id `343781769`, já seedada/ingerida). Ver
  [`dashboard-cs-indice.md`](../../painelcs-docs/updates/dashboard-cs-indice.md).
- **Negociação** — pipe próprio, **ainda não integrado**. Ingestão nova como vertical isolada
  (`neg_cards` + `ingest_negociacao_card`), só o essencial da fase "Aguardando Pagamento". É o
  **único a construir do zero** na parte de projeção.

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

**A Sprint 2 (Projeções de pagamento) é a próxima.** Ela tem duas metades bem diferentes:

- **CS — reusar (não bloqueado).** A fase "Aguardando Pagamento" (`343781769`) já é ingerida; falta
  só a RPC de leitura `get_ceo_projecoes_cs()` com a guarda `ceo`/`admin`. Dá pra escrever agora.
- **Negociação — integrar do zero (bloqueado em 1 input).** Precisa do **pipe ID + field-ids + id da
  fase "Aguardando Pagamento"** desse pipe. Mesmo caminho do Financeiro, que agora é mecânico:
  `node scripts/probe-financeiro-fields.mjs <pipeId>` (o probe é agnóstico de pipe) e
  `--scan N` pra medir os riscos de schema antes de escrever a migration. Candidato na org:
  **`304370275` — "3.0 Negociação"** (confirmar; há também `306994213` "2.1 - Controle de Vendas").

**Lição do Sprint 1 a repetir no 2:** rodar o `--scan` com páginas suficientes pra alcançar os anos
antigos **antes** de fechar o schema. Foi assim que apareceu a mudança de convenção do Financeiro,
que uma amostra só de cards recentes tinha escondido.

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
