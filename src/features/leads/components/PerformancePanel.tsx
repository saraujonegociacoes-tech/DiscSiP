'use client'

import type { TrendPoint } from '@/app/actions/leads'
import { TrendChart } from './TrendChart'
import { TabPlaceholder } from './TabPlaceholder'
import { TrendingUp } from 'lucide-react'

// Aba Performance (Sprint 2) — "estamos melhorando ao longo do tempo?". Quatro métricas, uma por
// ciclo (11→10): conversão, tempo até 1º contato, taxa de lead morto e recebidos. Tudo linha
// (tendência), exceto recebidos (área = volume). Dados de getLeadsTrend.
export function PerformancePanel({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) {
    return (
      <TabPlaceholder
        icon={TrendingUp}
        title="Sem histórico ainda"
        description="A tendência entre ciclos aparece assim que houver ciclos com dados (e a migration de séries temporais estiver aplicada)."
      />
    )
  }

  return (
    <section className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
      <TrendChart
        data={data}
        dataKey="conversionRate"
        title="Conversão"
        subtitle="Ganhos ÷ recebidos, por ciclo"
        tone="success"
        format="percent"
      />
      <TrendChart
        data={data}
        dataKey="avgHoursToFirstContact"
        title="Tempo até 1º contato"
        subtitle="Média de horas, por ciclo"
        tone="warning"
        format="hours"
      />
      <TrendChart
        data={data}
        dataKey="deadRate"
        title="Taxa de lead morto"
        subtitle="Mortos ÷ recebidos, por ciclo"
        tone="danger"
        format="percent"
      />
      <TrendChart
        data={data}
        dataKey="received"
        title="Recebidos"
        subtitle="Leads recebidos, por ciclo"
        kind="area"
        tone="primary"
      />
    </section>
  )
}
