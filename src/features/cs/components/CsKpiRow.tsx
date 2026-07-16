'use client'

import { Users, UserX, UserCheck, Clock } from 'lucide-react'
import { KpiCard } from '@/components/blueline/KpiCard'
import type { CsKpis } from '@/lib/types/database'

function fmtDays(d: number | null): string {
  if (d == null) return '—'
  if (d < 1) return `${Math.round(d * 24)} h`
  return `${d.toFixed(1)} d`
}

export function CsKpiRow({ kpis }: { kpis: CsKpis }) {
  return (
    <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <KpiCard label="Cards" value={String(kpis.total)} icon={Users} />
      <KpiCard label="Sem responsável" value={String(kpis.withoutResponsible)} icon={UserX} />
      <KpiCard label="Responsáveis" value={String(kpis.distinctResponsible)} icon={UserCheck} />
      <KpiCard label="Tempo médio na fase atual" value={fmtDays(kpis.avgDaysInCurrentPhase)} icon={Clock} />
    </section>
  )
}
