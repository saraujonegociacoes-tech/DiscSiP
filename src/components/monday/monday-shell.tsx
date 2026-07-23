'use client'

import type { ReactNode } from 'react'
import { AppShell } from '@/components/blueline/AppShell'
import { Toaster } from '@/components/ui/sonner'

/**
 * Casca das telas do modulo Monday: reusa o AppShell do Blue Line (sidebar RBAC +
 * header + tema) e monta o <Toaster/> aqui (o Blue Line nao monta um global), para
 * as toasts das actions do Monday aparecerem sem tocar no layout raiz.
 */
export function MondayShell({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      {children}
      <Toaster />
    </AppShell>
  )
}
