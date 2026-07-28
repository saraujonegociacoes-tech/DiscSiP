# Editar/apagar sprint + formatação das descrições

Duas melhorias no módulo Projetos, **sem migration** (a RLS e o schema atuais já cobrem tudo):

1. **Botões de editar e apagar sprint** direto no card do sprint.
2. **Formatação preservada** nas descrições de tarefa e nos objetivos de sprint — antes o
   texto colapsava numa linha só; agora respeita quebras, tópicos, numeração e negrito.

---

## 1. Editar e apagar sprint

Cada card na aba **Sprints** ganhou, ao lado da etiqueta de status, dois botões-ícone:

- **Editar** (lápis) — abre o **mesmo formulário** do sprint já preenchido. Permite trocar nome,
  objetivo, **status** (Planejado / Ativo / Concluído — campo só aparece na edição) e datas.
- **Apagar** (lixeira) — abre um diálogo de confirmação. **As tarefas vinculadas não são
  excluídas:** o FK `monday_tasks.sprint_id` é `on delete set null`, então elas voltam para o
  **backlog** automaticamente. O diálogo avisa isso explicitamente.

**Nada de migration:** a policy `monday_sprints_rw` já é `for all` por `is_monday_project_member`,
então `UPDATE`/`DELETE` já eram permitidos para membros do projeto.

### Como funciona

- O formulário de criar/editar virou um **único componente controlado** `SprintDialog`
  (`sprint?` presente = edição; ausente = criação), no molde do `TaskDialog`. O antigo
  `CreateSprintDialog` ficou como um wrapper fino que só abre o `SprintDialog` em modo criação —
  o botão "Novo sprint" do header não mudou.
- Cada card renderiza um `SprintCardActions` (client) que gerencia o diálogo de edição e o de
  confirmação de exclusão. A exclusão chama `router.refresh()`; a edição/criação reaproveitam a
  revalidação automática do server action (`revalidatePath`).

---

## 2. Formatação das descrições (tarefas e objetivos)

**Problema:** o objetivo do sprint era renderizado numa `<p>` inline (sem preservar quebras), então
tudo que o usuário escrevia com espaçamento e tópicos virava um bloco de texto corrido.

**Solução:** um render leve de markdown, `RichText` (`src/components/monday/rich-text.tsx`), aplicado
**nos dois lugares** — descrição da tarefa (`TaskDetailDialog`) e objetivo do sprint (aba Sprints).
Constrói **nós React puros** (sem `dangerouslySetInnerHTML`, sem HTML injetado — seguro) e suporta:

- **Tópicos** — linhas começando com `-`, `*` ou `•` → lista com marcador.
- **Lista numerada** — `1.`, `2)` etc.
- **Negrito** `**texto**` e **itálico** `*texto*` / `_texto_`.
- **Parágrafos** — linha em branco separa blocos; quebras simples são mantidas (`whitespace-pre-wrap`).

Como as descrições são **texto puro** no banco, o conteúdo **já existente** também passa a aparecer
formatado (as quebras que o usuário havia digitado voltam a ser respeitadas) — sem backfill.

Os campos de descrição (tarefa e sprint) ganharam um **placeholder de exemplo** e uma **dica** curta
explicando a sintaxe (`-`, `1.`, `**texto**`).

---

## Arquivos principais

- **Actions:** `src/app/actions/monday-sprints.ts` — novas `updateSprint(id, patch, projectId)` e
  `deleteSprint(id, projectId)`.
- **Sprint (criar/editar):** `src/components/monday/sprints/sprint-dialog.tsx` (novo, compartilhado),
  `create-sprint-dialog.tsx` (reduzido a wrapper), `sprint-card-actions.tsx` (novo — botões +
  confirmação de exclusão).
- **Formatação:** `src/components/monday/rich-text.tsx` (novo). Usado em
  `src/app/projects/[projectId]/sprints/page.tsx` (objetivo) e
  `src/components/monday/board/task-detail-dialog.tsx` (descrição).
- **Dicas de sintaxe:** `sprint-dialog.tsx` e `src/components/monday/board/task-dialog.tsx`.

---

## Observações / limitações

- **Markdown-lite proposital:** cobre tópicos, numeração, negrito/itálico e quebras — não é um
  parser completo (sem tabelas, links, blocos de código). É o suficiente para o uso real e evita
  dependência externa (a CSP do Cloudflare também favorece zero libs de render).
- **Sem migration e sem passo manual:** ao contrário das últimas features do módulo, esta não
  precisa de nada aplicado no Supabase — funciona assim que o build subir.
