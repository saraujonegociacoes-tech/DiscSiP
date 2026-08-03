# RBAC / Acessos + papel `tester`

Refatoração do controle de acesso do Blue Desk (03/ago/2026): escopo por departamento em toda a
navegação + papel novo `tester`. Ver [`../../links.md`](../../links.md) (índice mestre).

## Estado: NO AR — migration aplicada, build verde

- **✅ Migration [`20260803_tester_role.sql`](../../../supabase/migrations/20260803_tester_role.sql)
  aplicada** pelo dono (03/ago): libera o papel `tester` no `profiles_role_check` (mesma pegadinha
  do `ceo`/`20260730_ceo_role_check.sql` — `role` é text + CHECK, não enum).
- **Pendente do dono:** marcar um usuário como **Tester** no Admin; garantir o `department_id`
  correto em cada usuário (é o que faz todo o escopo abaixo funcionar).

## Princípio

`supervisor` é um papel GENÉRICO; o **departamento é a variável**. Cada supervisor vê só os painéis
da PRÓPRIA equipe (e os dados só do seu departamento, via RLS de cada vertical). Manager/admin veem
tudo; `ceo` é trava lateral (só `/ceo`).

## Matriz de acesso

| Papel / depto | Vê |
|---|---|
| Agente **Comercial** | Discador + Painel de Leads (só os próprios) |
| Agente **CS / Negociação / Jurídico** | só o próprio painel (/cs, /negociacao, /minutas). **Sem Discador** |
| Supervisor **Comercial** | Discador, Painel da Discadora, Painel de Leads, Warmup, Campanhas |
| Supervisor **CS / Negociação** | só o painel da própria vertical |
| **Gerente** | tudo em geral (incl. CS + Minutas) |
| **Admin** | tudo |
| **CEO** | só `/ceo` (+ ajuda) |
| **Tester** | acesso total + seletor "ver como" (troca só a navegação/gates no cliente) |

## Como está implementado

- **Sidebar** ([`src/components/Sidebar.tsx`](../../../src/components/Sidebar.tsx)): "Dashboard"→
  **Painel da Discadora** e "Leads"→**Painel de Leads**, ambos sob o grupo **Comercial**. Itens de
  operação comercial (Discador, Warmup, Campanhas) ganharam `depts:['comercial']`. A visibilidade usa
  papel/depto EFETIVOS — o tester sem seleção age como admin; com seleção, navega como o escolhido.
- **Tester / "ver como"**: estado `viewAsRole`/`viewAsSlug` no
  [`softphoneStore`](../../../src/store/softphoneStore.ts) +
  [`ViewAsSelector`](../../../src/components/bluedesk/ViewAsSelector.tsx) no header do AppShell (só
  aparece para tester). É CLIENT-SIDE: muda menu + gates de página, nunca os dados reais.
- **Middleware** ([`src/lib/supabase/middleware.ts`](../../../src/lib/supabase/middleware.ts)): a
  query de perfil pega `role` + slug do depto num embed só (`departments(slug)`). `homeFor()` manda
  cada papel/depto pra própria casa no pós-login. `managerLevel` inclui `tester`. Gates:
  `comercialOps` (/dashboard, /campaigns, /aquecimento) exige managerLevel ou supervisor comercial;
  `/softphone` barra CS/Negociação/Jurídico; `VERTICAL_GATES` barra por URL o painel de outra
  vertical. `/admin` e `/ceo` liberam admin + tester.
- **Papel `tester`** também liberado nos gates de página `/projects` e `/minutas`, e na lista de
  papéis atribuíveis (admin) + `roles.ts` da ajuda (RoleBadge/roleIncludes → equivale a admin).

## Pendente (camada de DADOS, fora deste sprint)

O "supervisor comercial vê só o time dele" no **Painel da Discadora** e "campanhas só as que criou +
as do departamento" é escopo de LINHAS — mora nas queries/RLS de
[`supervisor.ts`](../../../src/app/actions/supervisor.ts) e das campanhas. **Não foi alterado** aqui
(só menu + rota). Verificar/implementar como próxima etapa.
