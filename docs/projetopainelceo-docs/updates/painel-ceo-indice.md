# Painel do CEO

Índice da documentação do **Painel do CEO** — a visão executiva do Blue Desk. É uma
**camada de leitura/agregação** por cima das verticais isoladas (Financeiro, CS,
Negociação, Leads, Monday/Projetos, Discador): consulta cada domínio e compõe em
RPCs/actions, **sem fundir os schemas**. Acesso restrito por um papel novo `ceo`. Ver
[`painel-ceo-sprints.md`](painel-ceo-sprints.md) para o roadmap completo e as decisões
travadas, e [`../links.md`](../../links.md) (índice geral por domínio).

> **Estado (29/jul/2026): Sprint 0 entregue.** Papel `ceo` (migration + RBAC no app), rota
> `/ceo` com as 4 abas em placeholder, helper `ceo_current_role()` e docs. A flag
> `NEXT_PUBLIC_CEO_ENABLED` nasce **desligada** — a rota existe mas mostra "Em breve" até
> haver dado. Nenhuma RPC de leitura ainda. O primeiro entregável real é o **Financeiro —
> entradas do mês** (Sprint 1), que depende de input do dono (id do pipe + field-ids).

## Roadmap em sprints — estado atual

| Sprint | Entrega | Base de dado | Estado |
|---|---|---|---|
| 0 | **Fundação & trava** — papel `ceo`, rota `/ceo` (esqueleto multi-abas), helper `ceo_current_role()`, docs | — | ✅ entregue (29/jul) |
| 1 | **Financeiro — entradas do mês** (carro-chefe) — pipe Financeiro novo (vertical isolada), KPIs + série mensal | Snapshot (pipe novo) | ⏳ não iniciada |
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

- **Financeiro & Negociação**: pipe IDs + mapeamento de field-ids são **input do dono**. É o que
  bloqueia o Sprint 1 hoje.
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

## Referências

- [`painel-ceo-sprints.md`](painel-ceo-sprints.md) — roadmap em sprints + decisões travadas (fonte
  de verdade do projeto).
- [`dashboard-cs-indice.md`](../../painelcs-docs/updates/dashboard-cs-indice.md) — painel de CS
  (molde a reutilizar; fase de projeção).
- [`make-integracao-cs.md`](../../painelcs-docs/updates/make-integracao-cs.md) — cenário Pipefy →
  Make → Supabase (clone p/ Financeiro/Negociação).
- [`../links.md`](../../links.md) — índice mestre da documentação.
