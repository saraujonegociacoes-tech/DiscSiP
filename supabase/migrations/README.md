# Migrations — organização por projeto

Todos os domínios do Blue Desk dividem **o mesmo projeto Supabase** (um único banco, um único
schema `public`). As subpastas aqui são **organização de arquivo, não isolamento**: servem para
achar rápido "de quem é esta migration", espelhando os nomes de [`docs/`](../../docs/links.md).

## Regras

1. **O nome do arquivo é a identidade.** Continua `YYYYMMDD[letra]_assunto.sql`, único no
   repositório inteiro. Mover de pasta não renomeia nada — uma busca pelo nome do arquivo acha
   a migration em qualquer lugar.
2. **A ordem de execução é GLOBAL, por data — não por pasta.** As pastas não são filas
   independentes: `20260729_ceo_role.sql` (CEO) roda antes de `20260730_cs_parse_date_ptbr.sql`
   (CS) porque a data é anterior, mesmo estando em pastas diferentes. Ao aplicar um lote atrasado,
   ordene por nome de arquivo ignorando a pasta.
3. **Idempotente sempre** (`IF NOT EXISTS`, `DROP ... IF EXISTS` + `CREATE`, `CREATE OR REPLACE`).
   Rodar duas vezes tem que ser seguro — é assim que o dono aplica à mão sem levar registro.
4. **Aplicação é manual**, no SQL Editor do Supabase. Não usamos a CLI do Supabase (não existe
   `supabase/config.toml` neste repo). ⚠️ Se um dia adotarem `supabase db push` / `supabase
   migration`, a CLI espera os `.sql` **planos** dentro de `supabase/migrations/` e vai ignorar
   estas subpastas — nesse dia, achatar de volta.
5. **Ao criar migration nova**: coloque na pasta do domínio dela e registre em
   [`docs/links.md`](../../docs/links.md).

## Pastas

| Pasta | Domínio | Docs |
|---|---|---|
| `Migrations_discadora/` | Discador / campanhas / fila de contatos | `docs/discadora-docs/` |
| `Migrations_painelleads/` | Painel de Leads (Pipefy, comercial) | `docs/painelleads-docs/` |
| `Migrations_painelcs/` | Painel de Sucesso do Cliente | `docs/painelcs-docs/` |
| `Migrations_projetopainelceo/` | Painel do CEO — inclui os schemas Financeiro e Negociação, que existem **para** ele | `docs/projetopainelceo-docs/` |
| `Migrations_projetos/` | Projetos / tarefas (`monday_*`) — inclui o feed de notificações in-app, que nasceu das @menções em comentários | `docs/projetos-docs/` |
| `Migrations_minutas/` | Minutas Processuais (Jurídico, `proc_*`) | `docs/minutas-docs/` |
| `Migrations_warmup/` | Aquecimento de números WhatsApp | `docs/warmup-docs/` |
| `Migrations_rbac/` | Plataforma: papéis e departamentos (transversal a todos) | `docs/rbac-docs/` |

### Duas classificações que enganam pelo nome

- **`20260731b_negociacao_schema.sql` e `20260803_negociacao_fase_unica.sql` estão no CEO**, não
  numa pasta de Negociação. O cabeçalho dos dois diz "Painel do CEO, Sprint 2": eles alimentam
  `get_ceo_projecoes()`. A rota `/negociacao` do app é um "Em breve" sem dado nenhum.
- **`20260728_notifications.sql` está em Projetos** porque o feed nasceu das @menções nos
  comentários de tarefa, embora o sino seja global (fica no `AppShell`).

## Os schemas base voltaram (04/ago/2026)

Este README dizia até 03/ago que a base do **Discador** e a do **Painel de Leads** não
estavam versionadas — que existiam só no Supabase ao vivo e teriam que ser extraídas de lá
antes de qualquer coisa depender delas. Era o primeiro bloqueio da Sprint 3 do painel do CEO.

**Elas nunca precisaram ser extraídas: estavam no próprio git.** O commit `bf62847`
(10/jul/2026, "chore: remover supabase/ do repo; schema mantido no Supabase") apagou 23
arquivos, e o commit seguinte que voltou a versionar `supabase/` (`51cc883`, 30/jul)
restaurou só as migrations de 10/jul em diante. As 23 anteriores ficaram no histórico.

Todas voltaram em 04/ago, cada uma na pasta do seu domínio:

| Restaurados | Onde | O que cobrem |
|---|---|---|
| `20260610`–`20260625` (4) + `20260706_dashboard_aggregations` | `Migrations_discadora/` | `campaigns`, `lists`, `campaign_contacts`, `agent_presence`, discagem paralela, views do dashboard |
| `20260611`–`20260615` (5) | `Migrations_rbac/` | `profiles`, `departments`, cutover de identidade `agents`→`profiles`, **todo o RLS por papel** |
| `20260702`–`20260710` (10) | `Migrations_painelleads/` | `leads`, `lead_events`, `lead_phases`, `lead_agents`, `v_lead_progress`, SLA, `get_leads_dashboard` e as RPCs de drill-down/série |
| `leads_dashboard_setup.sql`, `ingest_lead_card.sql` | [`../manual/`](../manual/README.md) | setup consolidado de leads (⚠️ **destrutivo**, ver o README de lá) |

Conferido contra o banco ao vivo em 04/ago: as colunas que `20260702_leads_pipefy.sql` cria
são exatamente as 15 que `leads` tem hoje. O arquivo do histórico é fiel.

⚠️ **São migrations JÁ APLICADAS, restauradas como registro.** Não reexecute nenhuma sem ler.
As `20260612`/`20260613` são o cutover destrutivo de identidade (dropam a tabela `agents`) e
`../manual/leads_dashboard_setup.sql` recria o schema de leads do zero.

**A lição:** "não está no repo" e "não está no git" não são a mesma coisa. Antes de extrair
schema de um banco ao vivo, procure no histórico —
`git log --all --diff-filter=D --name-only -- 'supabase/*'` teria respondido em segundos.
