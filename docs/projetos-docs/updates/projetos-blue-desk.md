# Projetos (Desenvolvimento / TI) — módulo de tarefas/sprints

Área **Desenvolvimento / TI** do Blue Desk: um gerenciador de tarefas/sprints estilo Monday,
portado do app isolado `blueline-monday` para dentro do Blue Desk. Domínio de produto
separado (todas as tabelas com prefixo `monday_`, RLS própria por *membership*), reusando
apenas o `profiles` do Blue Desk (ponte por `profiles.id`).

- **Rotas:** `/projects` (lista), `/projects/[projectId]` (board), `/projects/[projectId]/sprints`,
  `/projects/[projectId]/backlog`, `/projects/daily` (Daily por pessoa).
- **Menu:** grupo "Desenvolvimento / TI" na Sidebar → item "Projetos" (só `manager`/`admin`).

---

## Acesso e permissões

- **Gate de rota:** as páginas de `/projects*` redirecionam quem não é `manager`/`admin`
  (`src/app/projects/page.tsx`, `src/app/projects/[projectId]/layout.tsx`,
  `src/app/projects/daily/page.tsx`); a Sidebar já esconde o item.
- **Escopo de dados (RLS):** por *membership* em `monday_project_members` (papéis de projeto
  `owner`/`admin`/`member`/`viewer`). Helpers `SECURITY DEFINER`: `is_monday_project_member`,
  `can_manage_monday_project`, `can_access_monday_board`, `can_access_monday_task`.
- **Gerência vê tudo:** helper `monday_is_gerencia()` (lê `profiles.role in ('manager','admin')`)
  é somado (`OR`) aos 4 helpers de acesso → admins e gerentes enxergam e trabalham em **todos**
  os projetos sem serem adicionados. `DELETE` de projeto continua **exclusivo do dono**.
- **Membros individuais:** botão "Membros" no cabeçalho do projeto adiciona/remove pessoas
  específicas (ex.: agentes/supervisores) com papel `admin`/`member`/`viewer` — necessário
  para poder **atribuir tarefas** a elas. O `owner` é protegido (nunca alterado/removido pela UI).

---

## Modelo de dados (tabelas `monday_*`)

`monday_projects` (com `owner_id`, `key`, `color`), `monday_project_members`, `monday_boards`,
`monday_groups`, `monday_sprints`, `monday_tasks` (com `status`, `priority`, `assignee_id`,
`due_date`, `completed_at`, `estimate`), `monday_tags`/`monday_task_tags`,
`monday_task_comments`. Views (`security_invoker`): `monday_project_overview`,
`monday_sprint_stats`, `monday_task_last_comment`. RPCs: `monday_sprint_burndown`,
`monday_seed_demo`, `monday_assignable_users`.

O `completed_at` é preenchido pelo trigger `monday_sync_task_completed_at` quando a tarefa
entra em `done` (habilita burndown e a Daily).

---

## Funcionalidades

- **Board kanban** com drag-and-drop (`@dnd-kit`) por status (`todo`/`working`/`review`/
  `done`/`stuck`). O `DragOverlay` é portado para `document.body` (`createPortal`) porque o
  `<main class="fade-up">` do `AppShell` mantém um `transform` permanente (animação com
  `fill-mode: both`), que deslocaria o `position:fixed` do overlay do cursor.
- **Tarefa: visualização × edição.** Clicar no card abre a **visualização** (`TaskDetailDialog`):
  status, prioridade, prazo, responsável, descrição, tags **e comentários**. Um botão
  **"Editar tarefa"** abre o formulário (`TaskDialog`) já preenchido. O "+" cria direto.
- **Comentários por tarefa** (`monday_task_comments`): thread com autor/horário; apaga só o
  próprio (RLS). O **card** mostra um preview do **último comentário** (texto + quem/quando),
  via view `monday_task_last_comment`.
- **Membros do projeto:** diálogo de gestão individual (adicionar/remover/mudar papel).
- **Pastas por pessoa (lista):** `/projects` agrupa os projetos por **dono** em pastas
  colapsáveis (`<details>`), cada uma com avatar + nome + contador ("N projetos de tal pessoa").
- **Daily (`/projects/daily`):** resumo por **responsável (assignee)** cruzando todos os
  projetos — **feito hoje**, **feito ontem** (tarefas concluídas naquele dia, por `completed_at`
  no fuso `America/Sao_Paulo`) e **a entregar** (abertas, com atrasadas destacadas). Uma pasta
  por pessoa; sem responsável → "Sem responsável". Acesso pelo botão "Daily" em `/projects`.
- **Voltar:** link "← Todos os projetos" no cabeçalho de qualquer projeto.

---

## Migrations (aplicar à mão no SQL Editor do Supabase — `supabase/` é gitignored)

| Migração | Conteúdo | Status |
|----------|----------|--------|
| `20260723d_monday.sql` | Base: tabelas/views/RPCs `monday_*`, RLS por membership, seed demo | **pendente** |
| `20260727_monday_gerencia_access.sql` | `monday_is_gerencia()` + gerência vê/gerencia todos os projetos; RPC `monday_assignable_users` | **pendente** |
| `20260727b_monday_task_comments.sql` | `monday_task_comments` + RLS + view `monday_task_last_comment` | **pendente** |

A **Daily** não precisa de migration nova (usa `completed_at`/`assignee_id`/`due_date` já
existentes). Para a gerência ver a Daily/pastas de **todos**, a `20260727_...gerencia_access`
precisa estar aplicada; sem ela cada manager vê só os projetos de que é membro.

---

## Arquivos principais

- **Actions:** `src/app/actions/monday-projects.ts` (projetos + membros + `getAssignableUsers`),
  `monday-board.ts` (board + `lastComment`), `monday-tasks.ts`, `monday-sprints.ts`,
  `monday-comments.ts`, `monday-daily.ts` (`getDailyReport`).
- **Páginas:** `src/app/projects/**` (lista, board, sprints, backlog, `daily`).
- **UI:** `src/components/monday/**` — `board/board-view.tsx`, `board/task-card.tsx`,
  `board/task-dialog.tsx`, `board/task-detail-dialog.tsx`, `projects/manage-members-dialog.tsx`,
  `project-tabs.tsx`, `status-badge.tsx`/`priority-badge.tsx`.
- **Domínio/tipos:** `src/lib/monday/domain.ts`, `src/lib/monday/types.ts`.

---

## Observações / limitações

- **Sem histórico de status:** só o que foi **concluído** tem data confiável (`completed_at`).
  Por isso a Daily define "feito" = concluído; "estava em andamento ontem" não é rastreável.
- **Fuso fixo** `America/Sao_Paulo` para "hoje/ontem" (via `toLocaleDateString('en-CA', …)`;
  não há `date-fns-tz` no projeto).
- **Apagar projeto** só aparece para o **dono** (RLS de `DELETE` = `owner`).
- Reuso do Blue Desk: apenas adições de fiação (`Sidebar.tsx`, deps `@dnd-kit`/`date-fns`,
  tokens `--status-*`/`--priority-*` em `globals.css`) — nada do Blue Desk foi reescrito.
