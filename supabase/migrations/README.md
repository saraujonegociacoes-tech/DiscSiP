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

## Schemas que NÃO estão aqui

Nem tudo que está no banco está versionado. Aplicados direto no Supabase ao vivo:

- **Base do Discador** (`profiles`, `campaigns`, `campaign_contacts`, `lists`, `call_logs`) — as
  migrations `20260610`–`20260619` citadas no README principal não estão neste repositório.
- **Base do Painel de Leads** (`v_lead_progress`, `lead_agents`, `get_leads_dashboard` e RPCs).

Consequência prática: **não dá para auditar índices e RLS dessas tabelas a partir do repo.** É por
isso que `20260803b_dialer_queue_indexes.sql` usa `IF NOT EXISTS` — não havia como saber daqui o
que já existia na base.
