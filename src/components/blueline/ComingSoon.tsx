'use client'

import { Rocket } from 'lucide-react'
import { AppShell } from '@/components/blueline/AppShell'
import { PageHeader } from '@/components/blueline/PageHeader'

interface ComingSoonProps {
  title: string
  description: string
  message: string
}

// Placeholder de lançamento reusado pelos painéis por vertical (Leads, CS, Negociação)
// enquanto não são liberados. Reusa o chrome padrão (AppShell + PageHeader) e os tokens
// de design da Blue Line — theme-aware.
export function ComingSoon({ title, description, message }: ComingSoonProps) {
  return (
    <AppShell>
      <PageHeader title={title} description={description} />
      <section className="sheen relative overflow-hidden rounded-3xl border border-border bg-gradient-card p-10 text-center shadow-elevated">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-primary/20 blur-3xl" />
        <div className="relative mx-auto flex max-w-md flex-col items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-background/60 shadow-glow">
            <Rocket className="h-7 w-7 text-primary" />
          </div>
          <span className="inline-flex items-center rounded-full border border-border bg-background/60 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Em preparação
          </span>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">Em breve</h2>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
      </section>
    </AppShell>
  )
}
