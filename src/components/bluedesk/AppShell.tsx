'use client'

import type { ReactNode } from 'react'
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { Sidebar } from '@/components/Sidebar'
import { ThemeToggle } from '@/components/bluedesk/ThemeToggle'
import { NotificationBell } from '@/components/notifications/notification-bell'
import { Toaster } from '@/components/ui/sonner'

/**
 * Casca padrão das telas internas: sidebar colapsável (RBAC) + header fixo.
 * `header` injeta conteúdo próprio entre o trigger e o toggle de tema
 * (ex.: abas do discador, status do helper).
 */
export function AppShell({ children, header }: { children: ReactNode; header?: ReactNode }) {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background bg-gradient-mesh">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/70 px-4 backdrop-blur-xl supports-[backdrop-filter]:bg-background/50">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
            {header}
            <div className="ml-auto flex items-center gap-3">
              <NotificationBell />
              <ThemeToggle />
            </div>
          </header>
          <main className="fade-up flex-1 px-6 py-8">{children}</main>
        </div>
      </div>
      {/* Toaster global do Blue Desk (card das notificacoes + feedbacks das actions). */}
      <Toaster />
    </SidebarProvider>
  )
}
