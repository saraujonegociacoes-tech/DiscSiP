'use client'

import { useCallback, useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { LayoutDashboard, Users, FileText, Wallet } from 'lucide-react'
import { AppShell } from '@/components/bluedesk/AppShell'
import { PageHeader } from '@/components/bluedesk/PageHeader'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { CsTabNav, CsMatrix, type CsTab } from '@/features/cs'
// Abas 2–4 sob demanda (elas já buscavam o próprio dado só ao montar) — ver features/cs/lazy.tsx.
import { CsTeam, CsMinutas, CsPagamento } from '@/features/cs/lazy'
import type { CsMatrixData } from '@/lib/types/database'

// Painel de Sucesso do Cliente (CS) reformulado — domínio SEPARADO do dashboard de
// Leads/comercial. Painel de 4 abas (ver docs/painelcs-docs/updates/painel-sucesso-cliente-cs.md),
// todas construídas:
//   1. Visão Geral + Janelas — matriz fase × tempo na fase + drill-down (snapshot, sem período).
//   2. Equipe — movimento/negociação por responsável (série temporal, período próprio).
//   3. Minutas — controle de acordos/vencimentos (snapshot, sem período).
//   4. Pagamento + Insights — projeção (plano de parcelas, snapshot) + histórico (conexão com o
//      pipe do Financeiro, série por período).
// As abas de série temporal (Equipe/Pagamento) têm o próprio PeriodPicker localizado nelas; as de
// snapshot (Visão Geral/Minutas) são foto do estado ATUAL, sem filtro de período.

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

          {/* 3 · Minutas — snapshot (foto de estado atual, sem período). Buckets por
              vencimento (data_da_quita_o) + valor da minuta (Q.D) + % desconto + etiqueta,
              com link do card. Componente busca o próprio dado (getCsMinutas). */}
          <TabsContent value="minutas" className="mt-6">
            <CsMinutas />
          </TabsContent>

          {/* 4 · Pagamento + Insights — projeção (plano de parcelas na fase Aguardando Pagamento,
              snapshot) + realizado/histórico (conexão com o pipe do Financeiro, série por período).
              Componente busca o próprio dado (getCsPagamentoProjecao + getCsPagamentoHistorico). */}
          <TabsContent value="pagamento" className="mt-6">
            <CsPagamento />
          </TabsContent>
        </div>
      </Tabs>
    </AppShell>
  )
}
