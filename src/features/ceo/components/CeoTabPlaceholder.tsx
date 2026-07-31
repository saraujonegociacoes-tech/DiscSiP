import type { LucideIcon } from 'lucide-react'
import { Rocket } from 'lucide-react'

// Placeholder "Em preparação" das abas do Painel do CEO ainda não construídas. No Sprint 0
// são as quatro; cada sprint troca uma por conteúdo real (ver
// docs/projetopainelceo-docs/updates/painel-ceo-sprints.md). Réplica local de
// src/features/cs/components/CsTabPlaceholder.tsx (domínio SEPARADO). Theme-aware via tokens
// da Blue Desk.
export function CeoTabPlaceholder({
  icon: Icon = Rocket,
  title = 'Em breve nesta aba',
  description,
}: {
  icon?: LucideIcon
  title?: string
  description?: string
}) {
  return (
    <section className="sheen relative overflow-hidden rounded-3xl border border-border bg-gradient-card p-10 text-center shadow-elevated">
      <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-primary/20 blur-3xl" />
      <div className="relative mx-auto flex max-w-md flex-col items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-background/60 shadow-glow">
          <Icon className="h-6 w-6 text-primary" aria-hidden />
        </div>
        <span className="inline-flex items-center rounded-full border border-border bg-background/60 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Em preparação
        </span>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
    </section>
  )
}
