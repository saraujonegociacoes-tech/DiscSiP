'use client'

import type { LucideIcon } from 'lucide-react'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'

// Topbar de abas do Painel do CEO (4 páginas, uma por sprint — ver
// docs/projetopainelceo-docs/updates/painel-ceo-sprints.md). Réplica local do padrão de
// src/features/cs/components/CsTabNav.tsx (domínio SEPARADO: réplica, não componente
// compartilhado — a mesma decisão que CS tomou em relação a Leads). Construída sobre o Radix
// ui/tabs: o <Tabs> Root (valor + onChange) vive no CeoClient e envolve esta barra + os
// <TabsContent>. Rola na horizontal no mobile; theme-aware via tokens da Blue Desk.

export interface CeoTab {
  slug: string
  label: string
  icon: LucideIcon
}

export function CeoTabNav({ tabs }: { tabs: CeoTab[] }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1">
      <TabsList className="inline-flex h-auto w-max gap-1 rounded-2xl border border-border bg-gradient-card p-1.5 shadow-card">
        {tabs.map(({ slug, label, icon: Icon }) => (
          <TabsTrigger
            key={slug}
            value={slug}
            className="gap-2 rounded-xl px-3.5 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-glow"
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="whitespace-nowrap">{label}</span>
          </TabsTrigger>
        ))}
      </TabsList>
    </div>
  )
}
