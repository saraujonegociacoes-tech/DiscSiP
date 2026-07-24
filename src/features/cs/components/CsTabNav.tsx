'use client'

import type { LucideIcon } from 'lucide-react'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'

// Topbar de abas do painel de CS (4 páginas — ver docs/updates/painel-sucesso-cliente-cs.md).
// Réplica local do padrão de src/features/leads/components/LeadsTabNav.tsx (domínio SEPARADO:
// réplica, não componente compartilhado). Construída sobre o Radix ui/tabs: o <Tabs> Root
// (valor + onChange) vive no CsClient e envolve esta barra + os <TabsContent>. Rola na
// horizontal no mobile; theme-aware via tokens da Blue Desk.

export interface CsTab {
  slug: string
  label: string
  icon: LucideIcon
}

export function CsTabNav({ tabs }: { tabs: CsTab[] }) {
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
