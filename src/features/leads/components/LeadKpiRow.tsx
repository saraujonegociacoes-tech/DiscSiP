import { Inbox, Hourglass, Trophy, TrendingDown, Timer, AlertTriangle } from 'lucide-react'
import { KpiCard } from '@/components/blueline/KpiCard'
import type { LeadKpis } from '@/app/actions/leads'

const pct = (n: number) => `${Math.round(n * 100)}%`

// Tempo até 1º contato em unidade legível (horas até 24h, senão dias).
function fmtHours(h: number | null): string {
  if (h == null) return '—'
  if (h >= 24) return `${(h / 24).toFixed(1)} d`
  return `${h.toFixed(1)} h`
}

// Card "Parados (agora)" — só na visão do agente. Diferente dos demais, é estado ATUAL
// (independe do período): total de leads abertos que estouraram o SLA da fase, com o split
// entre os do ciclo selecionado e os retroativos (arrastados de ciclos anteriores).
function StuckCard({ stuck }: { stuck: { total: number; cycle: number; retro: number } }) {
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
        {stuck.total}
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
  return (
    <section className={`grid grid-cols-2 gap-4 ${stuck ? 'xl:grid-cols-6' : 'xl:grid-cols-5'}`}>
      <KpiCard label="Recebidos" value={String(kpis.totalLeads)} icon={Inbox} />
      <KpiCard label="Em aberto" value={String(kpis.openLeads)} icon={Hourglass} />
      <KpiCard label="Conversão" value={pct(kpis.conversionRate)} icon={Trophy} />
      <KpiCard label="Lead morto" value={pct(kpis.deadRate)} icon={TrendingDown} />
      <KpiCard label="1º contato (média)" value={fmtHours(kpis.avgHoursToFirstContact)} icon={Timer} />
      {stuck && <StuckCard stuck={stuck} />}
    </section>
  )
}
