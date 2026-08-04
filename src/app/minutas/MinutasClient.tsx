'use client'

import { useCallback, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { LayoutDashboard, CalendarDays, FileText } from 'lucide-react'
import { AppShell } from '@/components/bluedesk/AppShell'
import { PageHeader } from '@/components/bluedesk/PageHeader'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { getMinutas } from '@/app/actions/minutas'
import type { ProcMinutasData } from '@/lib/types/database'
import { MinutasTabNav, MinutasLista, type MinutaTab } from '@/features/minutas'
// Visão Geral (Recharts) e Calendário (date-fns) só baixam quando a aba é aberta —
// ver features/minutas/lazy.tsx.
import { MinutasVisaoGeral, MinutasCalendario } from '@/features/minutas/lazy'

// Painel de Minutas Processuais (Jurídico) — 3 abas, sincronizadas com ?aba= (mesmo esqueleto
// do CsClient/CeoClient). É app-native/CRUD: o `data` vive no estado do cliente e `refresh`
// re-busca getMinutas() depois de cada mutação na aba de Minutas.

type TabSlug = 'visao-geral' | 'calendario' | 'minutas'

const TABS: Array<MinutaTab & { slug: TabSlug }> = [
  { slug: 'visao-geral', label: 'Visão Geral', icon: LayoutDashboard },
  { slug: 'calendario', label: 'Calendário', icon: CalendarDays },
  { slug: 'minutas', label: 'Minutas', icon: FileText },
]

export function MinutasClient({ initialData }: { initialData: ProcMinutasData }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [data, setData] = useState<ProcMinutasData>(initialData)
  const refresh = useCallback(async () => {
    setData(await getMinutas())
  }, [])

  const requestedTab = searchParams.get('aba')
  const activeTab = useMemo<TabSlug>(
    () => (TABS.some((t) => t.slug === requestedTab) ? (requestedTab as TabSlug) : TABS[0].slug),
    [requestedTab],
  )

  const handleTabChange = useCallback(
    (slug: string) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set('aba', slug)
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  return (
    <AppShell>
      <PageHeader
        title="Minutas Processuais"
        description="Controle de minutas e parcelas por processo (Jurídico)."
      />

      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <MinutasTabNav tabs={TABS} />

        <div>
          {/* 1 · Visão Geral — KPIs por ciclo/mês, buckets por vencimento, gráfico e insights. */}
          <TabsContent value="visao-geral" className="mt-6">
            <MinutasVisaoGeral data={data} />
          </TabsContent>

          {/* 2 · Calendário — parcelas no dia do vencimento + agenda do dia. */}
          <TabsContent value="calendario" className="mt-6">
            <MinutasCalendario data={data} />
          </TabsContent>

          {/* 3 · Minutas — tabela + CRUD (nova minuta, marcar paga, excluir). */}
          <TabsContent value="minutas" className="mt-6">
            <MinutasLista data={data} onChanged={refresh} />
          </TabsContent>
        </div>
      </Tabs>
    </AppShell>
  )
}
