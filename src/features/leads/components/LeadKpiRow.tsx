'use client'

import { Inbox, Hourglass, Trophy, TrendingDown, Timer, AlertTriangle, Recycle } from 'lucide-react'
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

// Card "Reaproveitados" — leads que ENTRARAM em Remarketing dentro do período. Não é lead
// morto (segue vivo) nem degrau do funil, por isso KPI próprio. O split ciclo × retroativo é
// a leitura que importa: reaproveitamento é re-trabalho de base ANTIGA, então o número é
// quase todo retroativo — foi medindo por "criado no período" que a primeira versão deste
// card mostrava 2 num ciclo de 2832 (ver migration 20260902).
function ReuseCard({ total, cycle, retro }: { total: number; cycle: number; retro: number }) {
  const value = useCountUp(total)
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-primary/30 bg-primary/5 p-5 shadow-card lift">
      <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-primary/20 blur-3xl" />
      <div className="relative flex items-start justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Reaproveitados
        </div>
        <div className="rounded-xl bg-primary/20 p-2 text-primary">
          <Recycle className="h-4 w-4" />
        </div>
      </div>
      <div className="relative mt-3 text-3xl font-semibold tracking-tight text-foreground">
        {value}
      </div>
      <div className="relative mt-2 text-xs text-muted-foreground">
        <span className="tabular-nums text-foreground">{cycle}</span> do ciclo ·{' '}
        <span className="tabular-nums text-primary">{retro}</span> retroativos
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
  // Reaproveitados só ocupa coluna quando existe: fica fora enquanto a migration 20260901
  // não rodou (a RPC devolve null → 0) e em ciclo sem nenhum reaproveitado.
  const showReuse = kpis.reaproveitados > 0
  // Classes LITERAIS, não interpoladas: o Tailwind gera CSS varrendo o texto do fonte, então
  // `xl:grid-cols-${n}` não produziria regra nenhuma e a linha quebraria no desktop.
  const cols = 6 + (showReuse ? 1 : 0) + (stuck ? 1 : 0)
  const colsClass =
    cols === 8 ? 'xl:grid-cols-8' : cols === 7 ? 'xl:grid-cols-7' : 'xl:grid-cols-6'
  return (
    <section className={`grid grid-cols-2 gap-4 ${colsClass}`}>
      <KpiCard label="Recebidos" value={String(total)} icon={Inbox} />
      <KpiCard label="Em aberto" value={String(open)} icon={Hourglass} />
      <WonCard won={kpis.wonLeads} cycle={kpis.wonCycle} retro={kpis.wonRetro} />
      <KpiCard label="Conversão" value={pct(kpis.conversionRate)} icon={Trophy} />
      <KpiCard label="Lead morto" value={pct(kpis.deadRate)} icon={TrendingDown} />
      <KpiCard label="1º contato (média)" value={fmtHours(kpis.avgHoursToFirstContact)} icon={Timer} />
      {showReuse && (
        <ReuseCard
          total={kpis.reaproveitados}
          cycle={kpis.reaproveitadosCycle}
          retro={kpis.reaproveitadosRetro}
        />
      )}
      {stuck && <StuckCard stuck={stuck} />}
    </section>
  )
}
