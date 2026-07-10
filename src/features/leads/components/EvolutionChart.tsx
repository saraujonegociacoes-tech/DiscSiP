'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { useChartTheme } from '@/components/blueline/useChartTheme'
import type { DailyPoint } from '@/app/actions/leads'

// Evolução no período (Sprint 2) — linha diária: recebidos, ganhos e mortos. Responde "como
// evoluiu?". Recebidos por created_at; ganhos/mortos por finalized_at (ver get_leads_timeseries).
// Cor por significado (azul neutro, verde sucesso, vermelho problema).
function dayShort(day: string): string {
  return day.slice(8, 10) // DD
}
function dayFull(day: string): string {
  const [, m, d] = day.split('-')
  return `${d}/${m}`
}

export function EvolutionChart({ data }: { data: DailyPoint[] }) {
  const ct = useChartTheme()
  const hasData = data.some((d) => d.received > 0 || d.won > 0 || d.dead > 0)

  return (
    <div className="relative h-full overflow-hidden rounded-2xl border border-border bg-gradient-card p-5 shadow-elevated">
      <div className="pointer-events-none absolute -top-20 right-0 h-48 w-48 rounded-full bg-primary/15 blur-3xl" />
      <h2 className="text-sm font-semibold text-foreground">Evolução no período</h2>
      <p className="mb-4 text-xs text-muted-foreground">Recebidos, ganhos e mortos por dia.</p>
      {!hasData ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Sem dados no período.</p>
      ) : (
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid stroke={ct.grid} vertical={false} />
              <XAxis
                dataKey="day"
                tickFormatter={dayShort}
                stroke={ct.axis}
                tick={{ fontSize: 11, fill: ct.axis }}
                axisLine={false}
                tickLine={false}
                minTickGap={16}
              />
              <YAxis
                allowDecimals={false}
                stroke={ct.axis}
                tick={{ fontSize: 11, fill: ct.axis }}
                axisLine={false}
                tickLine={false}
                width={32}
              />
              <Tooltip
                contentStyle={ct.tooltip}
                labelFormatter={(d) => dayFull(String(d))}
                cursor={{ stroke: ct.grid }}
              />
              <Legend wrapperStyle={ct.legend} iconType="plainline" />
              <Line
                type="monotone"
                dataKey="received"
                name="Recebidos"
                stroke={ct.series.primary}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="won"
                name="Ganhos"
                stroke={ct.series.success}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="dead"
                name="Mortos"
                stroke={ct.series.danger}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
