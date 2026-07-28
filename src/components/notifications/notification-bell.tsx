'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Bell, Volume2, VolumeX } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { initials } from '@/lib/monday/domain'
import { useSoftphoneStore } from '@/store/softphoneStore'
import {
  getMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/app/actions/notifications-inbox'
import { notificationHref, type AppNotification } from '@/lib/notifications/types'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  isNotificationMuted,
  playNotificationSound,
  setNotificationMuted,
} from './notification-sound'

function mentionTitle(n: AppNotification): string {
  return `${n.actor_name ?? 'Alguém'} mencionou você`
}

/**
 * Sino de notificacoes global (montado no header do AppShell → aparece em todas as
 * telas). Le as notificacoes do usuario atual, assina o Realtime de public.notifications
 * filtrado por user_id e, a cada nova: incrementa a bolinha, toca o som, mostra o card
 * (toast) e — se a aba estiver em 2o plano — dispara a notificacao do sistema (SO).
 */
export function NotificationBell() {
  const agentId = useSoftphoneStore((s) => s.agentId)
  const router = useRouter()
  const [items, setItems] = useState<AppNotification[]>([])
  const [open, setOpen] = useState(false)
  const [muted, setMuted] = useState(false)
  const routerRef = useRef(router)
  routerRef.current = router

  const unread = items.reduce((n, i) => (i.read_at ? n : n + 1), 0)

  const load = useCallback(async () => {
    setItems(await getMyNotifications())
  }, [])

  useEffect(() => {
    setMuted(isNotificationMuted())
  }, [])

  // Fetch inicial + pede permissao do SO uma vez (quando ha usuario).
  useEffect(() => {
    if (!agentId) return
    load()
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
  }, [agentId, load])

  // Realtime: novas notificacoes do proprio usuario.
  useEffect(() => {
    if (!agentId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`notifications:${agentId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${agentId}`,
        },
        (payload) => {
          const n = payload.new as AppNotification
          setItems((cur) => (cur.some((x) => x.id === n.id) ? cur : [n, ...cur]))
          playNotificationSound()

          // Card in-app (sonner), clicavel.
          toast(mentionTitle(n), {
            description: n.preview ?? undefined,
            action: { label: 'Abrir', onClick: () => routerRef.current.push(notificationHref(n)) },
          })

          // Notificacao do sistema operacional (so com a aba em 2o plano).
          if (
            typeof window !== 'undefined' &&
            'Notification' in window &&
            Notification.permission === 'granted' &&
            document.hidden
          ) {
            const osn = new Notification(mentionTitle(n), { body: n.preview ?? '', tag: n.id })
            osn.onclick = () => {
              window.focus()
              routerRef.current.push(notificationHref(n))
              osn.close()
            }
          }
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [agentId])

  // Fallback: revalida ao focar a janela (caso o Realtime nao esteja na publicacao).
  useEffect(() => {
    if (!agentId) return
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [agentId, load])

  function openItem(n: AppNotification) {
    if (!n.read_at) {
      setItems((cur) => cur.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)))
      markNotificationRead(n.id)
    }
    setOpen(false)
    router.push(notificationHref(n))
  }

  function markAll() {
    setItems((cur) => cur.map((x) => (x.read_at ? x : { ...x, read_at: new Date().toISOString() })))
    markAllNotificationsRead()
  }

  function toggleMute() {
    const next = !muted
    setMuted(next)
    setNotificationMuted(next)
  }

  function onOpenChange(next: boolean) {
    setOpen(next)
    // Aproveita o gesto do clique p/ pedir permissao do SO se ainda estiver pendente.
    if (next && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative text-muted-foreground hover:text-foreground"
          aria-label={unread > 0 ? `Notificações (${unread} não lidas)` : 'Notificações'}
        >
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold">Notificações</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleMute}
              aria-label={muted ? 'Ativar som' : 'Silenciar som'}
              title={muted ? 'Ativar som' : 'Silenciar som'}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            </button>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAll}
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Marcar todas
              </button>
            )}
          </div>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              Nenhuma notificação ainda.
            </p>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => openItem(n)}
                className={cn(
                  'flex w-full gap-2 border-b border-border/50 px-3 py-2 text-left transition-colors last:border-0 hover:bg-accent',
                  !n.read_at && 'bg-primary/5',
                )}
              >
                <Avatar className="size-7 shrink-0">
                  <AvatarFallback className="text-[10px]">{initials(n.actor_name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-medium">{n.actor_name ?? 'Alguém'}</span> mencionou você
                    {n.task_title && (
                      <>
                        {' em '}
                        <span className="font-medium">{n.task_title}</span>
                      </>
                    )}
                  </p>
                  {n.preview && (
                    <p className="truncate text-xs text-muted-foreground">{n.preview}</p>
                  )}
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {n.project_name ? `${n.project_name} · ` : ''}
                    {formatDistanceToNow(parseISO(n.created_at), { locale: ptBR, addSuffix: true })}
                  </p>
                </div>
                {!n.read_at && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
              </button>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
