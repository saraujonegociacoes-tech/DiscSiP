/**
 * Tipos do feed de notificacoes in-app. Espelham a tabela public.notifications
 * (migration 20260728_notifications.sql). Escritos a mao no padrao do Blue Desk
 * (mesma abordagem de src/lib/types/database.ts e src/lib/monday/types.ts).
 */

export type NotificationType = 'mention'

export interface AppNotification {
  id: string
  user_id: string
  type: NotificationType
  actor_id: string | null
  actor_name: string | null
  project_id: string | null
  project_name: string | null
  task_id: string | null
  task_title: string | null
  comment_id: string | null
  preview: string | null
  read_at: string | null
  created_at: string
}

/** Rota aberta ao clicar numa notificacao (o card da tarefa abre no board). */
export function notificationHref(n: Pick<AppNotification, 'project_id'>): string {
  return n.project_id ? `/projects/${n.project_id}` : '/projects'
}
