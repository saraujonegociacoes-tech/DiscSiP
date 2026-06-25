'use client'

import { useEffect, useState } from 'react'
import { PhoneOutgoing, PhoneCall, Clock } from 'lucide-react'
import { getMyPerformance, type MyPerformance } from '@/app/actions/performance'
import { MetricCard } from '@/app/dashboard/MetricCard'
import { CallsChart } from '@/app/dashboard/CallsChart'
import { Skeleton } from '@/components/ui/skeleton'

function formatTalk(seconds: number) {
  const totalMin = Math.floor(seconds / 60)
  const s = seconds % 60
  if (totalMin >= 60) return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`
  return totalMin > 0 ? `${totalMin}m ${s}s` : `${s}s`
}

// Aba "Meu desempenho" do softphone: números do PRÓPRIO agente (hoje), via getMyPerformance
// (escopado pela sessão no server). Atualiza a cada 30s para refletir as tabulações em andamento.
export function AgentPerformance() {
  const [data, setData] = useState<MyPerformance | null>(null)

  useEffect(() => {
    let active = true
    const load = () => getMyPerformance().then((d) => active && setData(d))
    load()
    const id = setInterval(load, 30000)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [])

  if (!data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-4 xl:grid-cols-3">
        <MetricCard label="Minhas chamadas hoje" value={data.callsToday} icon={PhoneOutgoing} />
        <MetricCard label="Atendidas" value={data.answeredToday} icon={PhoneCall} />
        <MetricCard label="Tempo em chamada" value={formatTalk(data.talkSecondsToday)} icon={Clock} />
      </section>

      <CallsChart data={data.callsByHour} />

      <section className="rounded-2xl border border-border bg-gradient-card p-5 shadow-elevated">
        <h2 className="text-sm font-semibold text-foreground">Minhas tabulações hoje</h2>
        <p className="mb-4 text-xs text-muted-foreground">Como você classificou suas chamadas.</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {data.byDisposition.map((d) => (
            <div
              key={d.value}
              className="flex items-center justify-between rounded-xl border border-border bg-background/40 px-3 py-2.5"
            >
              <span className="truncate text-sm text-foreground">{d.label}</span>
              <span className="ml-2 text-sm font-semibold tabular-nums text-foreground">{d.count}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
