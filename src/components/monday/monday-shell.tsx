'use client'

import type { ReactNode } from 'react'
import { AppShell } from '@/components/bluedesk/AppShell'

/**
 * Casca das telas do modulo Monday: reusa o AppShell do Blue Desk (sidebar RBAC +
 * header + tema). O <Toaster/> agora e global (montado no proprio AppShell, junto
 * do sino de notificacoes), entao nao precisa mais ser montado aqui.
 */
export function MondayShell({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>
}
