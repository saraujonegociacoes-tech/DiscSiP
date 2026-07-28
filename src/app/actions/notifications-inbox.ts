'use server'

import { createServerClient } from '@/lib/supabase/server'
import type { AppNotification } from '@/lib/notifications/types'

// Feed de notificacoes in-app do usuario atual. Nome do arquivo distinto de
// `notifications.ts` (que e o webhook do Make para dispositions de chamada).
// Toda a leitura/escrita e escopada pelo RLS (user_id = auth.uid()).

/** Notificacoes do usuario atual (mais recentes primeiro). */
export async function getMyNotifications(limit = 30): Promise<AppNotification[]> {
  const supabase = await createServerClient()
  const { data } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data ?? []) as AppNotification[]
}

/** Marca uma notificacao como lida. */
export async function markNotificationRead(id: string): Promise<{ error?: string }> {
  const supabase = await createServerClient()
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null)
  return error ? { error: error.message } : {}
}

/** Marca todas as nao-lidas do usuario como lidas. */
export async function markAllNotificationsRead(): Promise<{ error?: string }> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('read_at', null)
  return error ? { error: error.message } : {}
}
