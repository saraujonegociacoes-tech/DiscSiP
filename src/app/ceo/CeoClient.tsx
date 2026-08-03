'use client'

import { useCallback, useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Wallet, CalendarClock, Activity, Users } from 'lucide-react'
import { AppShell } from '@/components/bluedesk/AppShell'
import { PageHeader } from '@/components/bluedesk/PageHeader'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { CeoTabNav, CeoTabPlaceholder, CeoFinanceiro, CeoProjecoes, type CeoTab } from '@/features/ceo'

// Painel do CEO — camada de leitura/agregação por cima das verticais isoladas (ver
// docs/projetopainelceo-docs/updates/painel-ceo-sprints.md). Painel de 4 abas, uma por
// sprint, na ordem de entrega:
//   1. Financeiro (Sprint 1) — entradas do mês, do pipe Financeiro novo. Carro-chefe.
//   2. Projeções (Sprint 2) — "quando/quanto vão pagar", somando CS (reusado) + Negociação.
//   3. Saúde da Empresa (Sprint 3) — scorecard compondo Financeiro + Leads + CS + Monday + Discador.
//   4. Saúde da Equipe (Sprint 4) — saúde por pessoa; carrega o trabalho de unificar identidade.
//
// Sprint 1: a aba Financeiro está construída; as outras 3 seguem placeholder. A casca
// (Radix Tabs + ?aba= + AppShell/PageHeader) é réplica local do padrão de
// app/cs/CsClient.tsx — domínio separado, réplica e não componente compartilhado, mesma
// decisão que CS tomou em relação a Leads.
//
// Sem PeriodPicker aqui: cada aba decide o próprio recorte (Financeiro/Saúde usam janela de
// tempo; Projeções é snapshot). O Financeiro usa o CeoPeriodPicker, que oferece OS DOIS
// recortes — mês civil (default) e ciclo 11→10 — porque foi o que o dono pediu.

type TabSlug = 'financeiro' | 'projecoes' | 'saude-empresa' | 'saude-equipe'

const TABS: Array<CeoTab & { slug: TabSlug }> = [
  { slug: 'financeiro', label: 'Financeiro', icon: Wallet },
  { slug: 'projecoes', label: 'Projeções', icon: CalendarClock },
  { slug: 'saude-empresa', label: 'Saúde da Empresa', icon: Activity },
  { slug: 'saude-equipe', label: 'Saúde da Equipe', icon: Users },
]

export function CeoClient() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Aba ativa sincronizada com ?aba=; deep-link inválido cai na primeira (financeiro).
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
        title="Painel do CEO"
        description="Visão executiva do negócio — financeiro, projeções e saúde da empresa e da equipe."
      />

      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <CeoTabNav tabs={TABS} />

        <div>
          {/* 1 · Financeiro — entradas do mês (Sprint 1, carro-chefe). CONSTRUÍDA: lê
              get_ceo_financeiro sobre fin_entries (uma linha por pagamento — o pipe mudou de
              convenção no meio de 2025 e cards antigos carregam até 4 pagamentos com datas em
              meses diferentes). Componente busca o próprio dado, com período próprio. */}
          <TabsContent value="financeiro" className="mt-6">
            <CeoFinanceiro />
          </TabsContent>

          {/* 2 · Projeções (Sprint 2) — CONSTRUÍDA: lê get_ceo_projecoes, que junta
              `neg_cards` (pipe 3.0 Negociação, vertical nova) com o plano de pagamento do
              CS. Snapshot, não série — o recorte é a janela de VENCIMENTO, então esta aba
              não tem PeriodPicker. Só dinheiro NÃO recebido: o realizado das duas fontes
              já virou card no pipe do Financeiro e está contado na aba 1. */}
          <TabsContent value="projecoes" className="mt-6">
            <CeoProjecoes />
          </TabsContent>

          {/* 3 · Saúde da Empresa (Sprint 3) — compõe domínios que já existem. Risco
              conhecido: as tabelas/RPCs base de Leads não estão versionadas no repo (só na
              base ao vivo) — extrair antes de depender delas. */}
          <TabsContent value="saude-empresa" className="mt-6">
            <CeoTabPlaceholder
              icon={Activity}
              title="Saúde da empresa em preparação"
              description="Scorecard executivo cruzando entradas, conversão comercial, carteira de CS, ritmo de entrega de TI e volume de operação."
            />
          </TabsContent>

          {/* 4 · Saúde da Equipe (Sprint 4) — último de propósito: maior esforço e menor
              prontidão de dados. Carrega o bloqueador de identidade não unificada entre
              domínios (lead_agents/cs_agents por pipefy_user_id vs. profiles). */}
          <TabsContent value="saude-equipe" className="mt-6">
            <CeoTabPlaceholder
              icon={Users}
              title="Saúde da equipe em preparação"
              description="Indicadores por pessoa reunindo CS, Leads, Projetos e Discador. Depende de unificar a identidade dos colaboradores entre os domínios."
            />
          </TabsContent>
        </div>
      </Tabs>
    </AppShell>
  )
}
