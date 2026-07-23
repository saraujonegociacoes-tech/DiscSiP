'use client'

import { useCallback, useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { LayoutDashboard, Users, FileText, Wallet } from 'lucide-react'
import { AppShell } from '@/components/blueline/AppShell'
import { PageHeader } from '@/components/blueline/PageHeader'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { CsTabNav, CsTabPlaceholder, CsMatrix, CsTeam, type CsTab } from '@/features/cs'
import type { CsMatrixData } from '@/lib/types/database'

// Painel de Sucesso do Cliente (CS) reformulado — domínio SEPARADO do dashboard de
// Leads/comercial. Painel de 4 abas (ver docs/updates/painel-sucesso-cliente-cs.md):
//   1. Visão Geral + Janelas — matriz fase × idade + drill-down (ESTA entrega, funcional).
//   2. Equipe · 3. Minutas · 4. Pagamento — placeholders (dependem de ingestão nova e
//      de pendências do dono).
// SEM filtro de período nesta primeira página (decisão do dono): é uma foto de ESTADO ATUAL
// (snapshot), não uma janela de tempo — não há o que filtrar por período. As abas de série
// temporal (Equipe/Pagamento), quando forem construídas, ganham o próprio controle de
// período localizado nelas.

type TabSlug = 'visao-geral' | 'equipe' | 'minutas' | 'pagamento'

const TABS: Array<CsTab & { slug: TabSlug }> = [
  { slug: 'visao-geral', label: 'Visão Geral + Janelas', icon: LayoutDashboard },
  { slug: 'equipe', label: 'Equipe', icon: Users },
  { slug: 'minutas', label: 'Minutas', icon: FileText },
  { slug: 'pagamento', label: 'Pagamento + Insights', icon: Wallet },
]

export function CsClient({ initialData }: { initialData: CsMatrixData }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Aba ativa sincronizada com ?aba=; deep-link inválido cai na primeira (visao-geral).
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
        title="Sucesso do Cliente"
        description="Acompanhamento do pipe de CS (Pipefy)."
      />

      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <CsTabNav tabs={TABS} />

        <div>
          {/* 1 · Visão Geral + Janelas — matriz fase × idade + drill-down (funcional). */}
          <TabsContent value="visao-geral" className="mt-6">
            <CsMatrix data={initialData} />
          </TabsContent>

          {/* 2 · Equipe — série temporal (movimento + comentário por ciclo). Fundação de
              ingestão (cs_card_comments + snapshot de negociação + troca de responsável) na
              migration 20260722; a completude já rende do snapshot, o movimento enche conforme
              o Make acumula. Componente busca o próprio dado (getCsTeam) por período. */}
          <TabsContent value="equipe" className="mt-6">
            <CsTeam />
          </TabsContent>

          {/* 3 · Minutas — snapshot; pendente mapear os field-ids de minuta/valor/URL. */}
          <TabsContent value="minutas" className="mt-6">
            <CsTabPlaceholder
              icon={FileText}
              title="Controle de Minutas em preparação"
              description="URL, valor, resguardo, % de desconto e buckets por vencimento. Pendente o dono apontar quais campos do Pipefy são a minuta."
            />
          </TabsContent>

          {/* 4 · Pagamento + Insights — projeção (snapshot) + histórico (série temporal). */}
          <TabsContent value="pagamento" className="mt-6">
            <CsTabPlaceholder
              icon={Wallet}
              title="Controle de Pagamento + Insights em preparação"
              description="Projeções de quando/quanto vão pagar e histórico de pagamento. O histórico depende de definir a fonte (snapshot de P.P ao longo do tempo ou fonte externa)."
            />
          </TabsContent>
        </div>
      </Tabs>
    </AppShell>
  )
}
