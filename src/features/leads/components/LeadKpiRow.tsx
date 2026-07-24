'use client'

import { Inbox, Hourglass, Trophy, TrendingDown, Timer, AlertTriangle } from 'lucide-react'
import { KpiCard } from '@/components/bluedesk/KpiCard'
import { useCountUp } from '@/features/leads/useCountUp'
import type { LeadKpis } from '@/app/actions/leads'

const pct = (n: number) => `${Math.round(n * 100)}%`

// Tempo até 1º contato em unidade legível (horas até 24h, senão dias).
function fmtHours(h: number | null): string {
  if (h == null) return '—'
  if (h >= 24) return `${(h / 24).toFixed(1)} d`
  return `${h.toFixed(1)} h`
}

// Card "Ganhos" — contado por DATA DE VENDA (finalized_at), não created_at: um lead criado
// num ciclo anterior mas vendido dentro do período selecionado conta aqui. O subtexto separa
// quantos foram criados no próprio período ("do ciclo") dos criados antes ("retroativos").
function WonCard({ won, cycle, retro }: { won: number; cycle: number; retro: number }) {
  const total = useCountUp(won)
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-success/30 bg-success/5 p-5 shadow-card lift">
      <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-success/20 blur-3xl" />
      <div className="relative flex items-start justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Ganhos
        </div>
        <div className="rounded-xl bg-success/20 p-2 text-success">
          <Trophy className="h-4 w-4" />
        </div>
      </div>
      <div className="relative mt-3 text-3xl font-semibold tracking-tight text-foreground">
        {total}
      </div>
      <div className="relative mt-2 text-xs text-muted-foreground">
        <span className="tabular-nums text-foreground">{cycle}</span> do ciclo ·{' '}
        <span className="tabular-nums text-success">{retro}</span> retroativos
      </div>
    </div>
  )
}

// Card "Parados (agora)" — só na visão do agente. Diferente dos demais, é estado ATUAL
// (independe do período): total de leads abertos que estouraram o SLA da fase, com o split
// entre os do ciclo selecionado e os retroativos (arrastados de ciclos anteriores).
function StuckCard({ stuck }: { stuck: { total: number; cycle: number; retro: number } }) {
  const total = useCountUp(stuck.total)
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-warning/30 bg-warning/5 p-5 shadow-card lift">
      <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-warning/20 blur-3xl" />
      <div className="relative flex items-start justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Parados (agora)
        </div>
        <div className="rounded-xl bg-warning/20 p-2 text-warning">
          <AlertTriangle className="h-4 w-4" />
        </div>
      </div>
      <div className="relative mt-3 text-3xl font-semibold tracking-tight text-foreground">
        {total}
      </div>
      <div className="relative mt-2 text-xs text-muted-foreground">
        <span className="tabular-nums text-foreground">{stuck.cycle}</span> do ciclo ·{' '}
        <span className="tabular-nums text-warning">{stuck.retro}</span> retroativos
      </div>
    </div>
  )
}

export function LeadKpiRow({
  kpis,
  stuck,
}: {
  kpis: LeadKpis
  stuck?: { total: number; cycle: number; retro: number }
}) {
  // Count-up sóbrio só nas contagens de volume (Recebidos, Em aberto); conversão/lead
  // morto/tempo ficam estáticos para não virar "excesso" (panoramavisual.md).
  const total = useCountUp(kpis.totalLeads)
  const open = useCountUp(kpis.openLeads)
  return (
    <section className={`grid grid-cols-2 gap-4 ${stuck ? 'xl:grid-cols-7' : 'xl:grid-cols-6'}`}>
      <KpiCard label="Recebidos" value={String(total)} icon={Inbox} />
      <KpiCard label="Em aberto" value={String(open)} icon={Hourglass} />
      <WonCard won={kpis.wonLeads} cycle={kpis.wonCycle} retro={kpis.wonRetro} />
      <KpiCard label="Conversão" value={pct(kpis.conversionRate)} icon={Trophy} />
      <KpiCard label="Lead morto" value={pct(kpis.deadRate)} icon={TrendingDown} />
      <KpiCard label="1º contato (média)" value={fmtHours(kpis.avgHoursToFirstContact)} icon={Timer} />
      {stuck && <StuckCard stuck={stuck} />}
    </section>
  )
}
