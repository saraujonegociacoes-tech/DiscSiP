'use client'

import { AppShell } from '@/components/blueline/AppShell'
import { PageHeader } from '@/components/blueline/PageHeader'
import { CsKpiRow, CsPhaseDistribution, CsDwellByPhase } from '@/features/cs'
import type { CsDashboardData } from '@/lib/types/database'

// Painel de Sucesso do Cliente (CS) — domínio SEPARADO do dashboard de Leads/comercial.
// Sprint 2: visão geral (cards por fase, tempo na fase atual, responsável via drill-down).
// Sem abas ainda (ao contrário do /leads, que evoluiu pra topbar de 7 abas ao longo de
// várias sprints) — uma página só, do jeito que foi pedido. Classificação de fase
// (sucesso/encerrado) fica pra depois; não afeta essas 3 métricas.
export function CsClient({ data }: { data: CsDashboardData }) {
  return (
    <AppShell>
      <PageHeader
        title="Sucesso do Cliente"
        description="Acompanhamento do funil de CS (Pipefy) — cards por fase, tempo na fase e responsável."
      />
      <div className="flex flex-col gap-6">
        <CsKpiRow kpis={data.kpis} />
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <CsPhaseDistribution data={data.phaseDistribution} byResponsible={data.byResponsible} />
          <CsDwellByPhase data={data.phaseDistribution} />
        </div>
      </div>
    </AppShell>
  )
}
