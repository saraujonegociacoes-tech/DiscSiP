'use client'

import { useCallback, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { LayoutDashboard, Signal, Smartphone, Users } from 'lucide-react'
import { AppShell } from '@/components/bluedesk/AppShell'
import { PageHeader } from '@/components/bluedesk/PageHeader'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { getInventario } from '@/app/actions/inventario'
import type { InvInventarioData } from '@/lib/types/database'
import {
  AparelhosLista,
  AparelhosTabNav,
  ChipsLista,
  InventarioVisaoGeral,
  PessoasLista,
  type AparelhoTab,
} from '@/features/aparelhos'

// Central de Aparelhos — 4 abas sincronizadas com ?aba= (mesmo esqueleto do
// MinutasClient/CsClient/CeoClient). É app-native/CRUD: o `data` vive no estado do
// cliente e `refresh` re-busca getInventario() depois de cada mutação, em qualquer
// aba — as quatro leem o MESMO objeto, então mudar o responsável na aba Aparelhos
// já reflete na Visão Geral sem recarregar a página.

type TabSlug = 'visao-geral' | 'aparelhos' | 'chips' | 'pessoas'

const TABS: Array<AparelhoTab & { slug: TabSlug }> = [
  { slug: 'visao-geral', label: 'Visão Geral', icon: LayoutDashboard },
  { slug: 'aparelhos', label: 'Aparelhos', icon: Smartphone },
  { slug: 'chips', label: 'Chips', icon: Signal },
  { slug: 'pessoas', label: 'Pessoas', icon: Users },
]

export function AparelhosClient({
  initialData,
  podeEscrever,
}: {
  initialData: InvInventarioData
  podeEscrever: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [data, setData] = useState<InvInventarioData>(initialData)
  const refresh = useCallback(async () => {
    setData(await getInventario())
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
        title="Central de Aparelhos"
        description={
          podeEscrever
            ? 'Inventário de celulares, chips e responsáveis.'
            : 'Inventário de celulares, chips e responsáveis — somente leitura.'
        }
      />

      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <AparelhosTabNav tabs={TABS} />

        <div>
          {/* 1 · Visão Geral — KPIs + uma linha por aparelho (responsável, 2 chips, status) + CSV. */}
          <TabsContent value="visao-geral" className="mt-6">
            <InventarioVisaoGeral data={data} />
          </TabsContent>

          {/* 2 · Aparelhos — CRUD; responsável e status trocam direto na linha. */}
          <TabsContent value="aparelhos" className="mt-6">
            <AparelhosLista data={data} podeEscrever={podeEscrever} onChanged={refresh} />
          </TabsContent>

          {/* 3 · Chips — CRUD; o vínculo com o aparelho passa pela RPC inv_assign_chip. */}
          <TabsContent value="chips" className="mt-6">
            <ChipsLista data={data} podeEscrever={podeEscrever} onChanged={refresh} />
          </TabsContent>

          {/* 4 · Pessoas — CRUD dos responsáveis (lista própria, com vínculo opcional a um perfil). */}
          <TabsContent value="pessoas" className="mt-6">
            <PessoasLista data={data} podeEscrever={podeEscrever} onChanged={refresh} />
          </TabsContent>
        </div>
      </Tabs>
    </AppShell>
  )
}
