'use client'

import type { LucideIcon } from 'lucide-react'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'

// Topbar de abas da Central de Aparelhos. Réplica local do padrão do MinutasTabNav
// (domínios separados replicam, não compartilham um componente). O <Tabs> Root vive
// no AparelhosClient e envolve esta barra + os <TabsContent>.
export interface AparelhoTab {
  slug: string
  label: string
  icon: LucideIcon
}

export function AparelhosTabNav({ tabs }: { tabs: AparelhoTab[] }) {
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
