# Painel do CEO

Índice da documentação do **Painel do CEO** — a visão executiva do Blue Desk. É uma
**camada de leitura/agregação** por cima das verticais isoladas (Financeiro, CS,
Negociação, Leads, Monday/Projetos, Discador): consulta cada domínio e compõe em
RPCs/actions, **sem fundir os schemas**. Acesso restrito por um papel novo `ceo`. Ver
[`painel-ceo-sprints.md`](painel-ceo-sprints.md) para o roadmap completo e as decisões
travadas, e [`../links.md`](../../links.md) (índice geral por domínio).

> **Estado (28/jul/2026): planejamento aprovado, execução não iniciada.** Pasta de docs
> criada (Sprint 0, parte de docs). Nenhuma migration, rota ou RPC construída ainda. O
> primeiro entregável real é o **Financeiro — entradas do mês** (Sprint 1).

## Roadmap em sprints — estado atual

| Sprint | Entrega | Base de dado | Estado |
|---|---|---|---|
| 0 | **Fundação & trava** — papel `ceo`, rota `/ceo` (esqueleto multi-abas), helper `ceo_current_role()`, docs | — | ⏳ só docs criados |
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

## Trava de acesso (papel `ceo`)

Um papel novo `ceo` (novo valor no enum de `profiles.role`). Estratégia recomendada:
centralizar o acesso do CEO nas **RPCs de leitura do painel** (`SECURITY DEFINER` com guarda
interna `IF ceo_current_role() NOT IN ('ceo','admin') THEN RETURN`) em vez de espalhar `'ceo'`
pelo RLS de cada domínio. Gate de rota em
[`src/lib/supabase/middleware.ts`](../../../src/lib/supabase/middleware.ts) (espelhando o de
`/admin`). Enquanto não pronto, `NEXT_PUBLIC_CEO_ENABLED` mantém a rota oculta.

## Arquitetura (decisões travadas)

- **Verticais isoladas, não schema genérico multi-pipe** (decisão reafirmada do CS): cada pipe
  tem tabelas/RLS/RPCs próprios. Financeiro e Negociação são clones do molde do CS.
- **Painel do CEO = camada de leitura/agregação** por cima das verticais — compõe em RPCs/actions,
  não funde schemas.
- **Ingestão**: Pipefy → Make (poll agendado) → RPC `ingest_*` no Supabase. O app só **lê** sob
  RLS. Migrations e cenários Make são **aplicados à mão pelo dono** (padrão do repo).

## Riscos & dependências

- **Financeiro & Negociação**: pipe IDs + mapeamento de field-ids são **input do dono**.
- **Papel `ceo`**: confirmar o nome do enum de `profiles.role` na base ao vivo (setup core não
  versionado); `ALTER TYPE ADD VALUE` rodado isolado.
- **Leads não versionado** (Sprints 3/4): RPCs/tabelas base só na base ao vivo — extrair antes de
  depender.
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
