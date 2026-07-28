# Notificações in-app + @menções nos comentários

Primeira infra de **notificação in-app** do Blue Desk. Um **sino global** (com bolinha/contador)
aparece no header de **todas as telas** e mostra quando você foi **mencionado** (`@nome`) num
comentário de tarefa. Ao chegar uma menção: a bolinha incrementa, toca um **som**, um **card**
(toast) desliza no canto e — se a Blue Desk estiver em 2º plano/outra aba — dispara uma
**notificação do sistema operacional** (Web Notifications API).

Gatilho hoje: **apenas `mention`** (a tabela nasce genérica, com coluna `type`, para estender
depois — ex.: atribuição de tarefa, comentário na sua tarefa — sem mexer no sino/painel/card).

---

## Como funciona (ponta a ponta)

1. No `TaskDetailDialog`, o campo de comentário é o `MentionTextarea`: digitar `@` abre um
   autocomplete com os **membros do projeto** (reusa a lista que já chega no `BoardView`);
   escolher insere `@Nome `. As menções aparecem **destacadas** na thread (`CommentBody`).
2. Ao enviar, o cliente resolve os ids mencionados (`extractMentionIds`) e passa para
   `addTaskComment(taskId, body, projectId, mentionedUserIds)`.
3. A action insere o comentário e chama a RPC `monday_notify_mentions(comment_id, mentioned[])`,
   que cria **1 notificação por mencionado que também pode acessar a tarefa** (membro do projeto
   ou gerência) e `!= autor`.
4. O `NotificationBell` (no `AppShell`) assina o **Realtime** de `public.notifications` filtrado
   por `user_id` e reage a cada `INSERT`: bolinha + som + card + (aba oculta) notificação do SO.

---

## Modelo de dados

- **Tabela `public.notifications`** (`user_id` = destinatário). Campos de exibição
  **denormalizados** (`actor_name`, `project_name`, `task_title`, `preview`) → o payload do
  Realtime já chega completo para o card/SO **sem join**. RLS: cada um só **lê/atualiza/apaga**
  as próprias (`user_id = auth.uid()`); **sem** policy de INSERT (só a RPC insere).
- **RPC `monday_notify_mentions(p_comment_id, p_mentioned[])`** (`SECURITY DEFINER`): valida que
  o **autor** dispara o próprio comentário e checa o acesso **de cada mencionado** à tarefa
  (mesmo critério de `can_access_monday_task`, porém por-alvo). Dedup + exclui o autor.
- **Realtime:** a tabela entra na publicação `supabase_realtime` no fim da migration
  (idempotente), então **aplicar a migration já liga o tempo real** (sem passo manual extra).
  Fallback no cliente: revalida ao focar a janela, caso a publicação não esteja ativa.

---

## Som e notificação do sistema

- **Som:** chime curto via **WebAudio** (sem asset externo — atende à CSP). **Ligado por padrão**,
  com botão de **mudo** no painel (persistido em `localStorage`: `bluedesk:notif-muted`).
- **Notificação do SO:** só quando a aba está em 2º plano (`document.hidden`). Pede permissão
  **uma vez** (no mount do sino e ao abrir o painel — aproveitando o gesto). **Não** cobre a
  Blue Desk totalmente fechada — isso exigiria Web Push + Service Worker (2ª fase).

---

## Migration (aplicar à mão no SQL Editor — `supabase/` é gitignored)

| Migração | Conteúdo | Status |
|----------|----------|--------|
| `20260728_notifications.sql` | Tabela `notifications` + RLS + RPC `monday_notify_mentions` + entra na publicação do Realtime | **pendente** |

Depende de `20260723d_monday.sql`, `20260727_monday_gerencia_access.sql` e
`20260727b_monday_task_comments.sql`.

---

## Arquivos principais

- **Migration:** `supabase/migrations/20260728_notifications.sql`.
- **Tipos:** `src/lib/notifications/types.ts` (`AppNotification`, `notificationHref`).
- **Actions:** `src/app/actions/notifications-inbox.ts` (`getMyNotifications`, `markNotificationRead`,
  `markAllNotificationsRead`); menção em `src/app/actions/monday-comments.ts` (`addTaskComment`).
- **Menções:** `src/lib/monday/mentions.ts` (helpers puros: `extractMentionIds`, `segmentMentions`,
  `mentionQueryAt`), `src/components/monday/board/mention-textarea.tsx` (autocomplete),
  `src/components/monday/board/comment-body.tsx` (realce).
- **Sino global:** `src/components/notifications/notification-bell.tsx` +
  `notification-sound.ts`; montado em `src/components/bluedesk/AppShell.tsx` (junto do
  `<Toaster/>`, que passou a ser **global** — removido do `monday-shell.tsx`).

---

## Observações / limitações

- **Nome ≠ avatar:** `profiles` não tem avatar; o sino/menções usam **iniciais** (`initials()`).
- **Casamento de menção por rótulo:** o realce/extração casa `@<nome do membro>` (rótulo mais
  longo primeiro, com fronteira). Nomes idênticos entre membros são um caso-limite aceitável.
- **Deep-link:** o card/painel abrem `/projects/<id>` (board do projeto); abrir direto o
  diálogo da tarefa é um aprimoramento futuro.
