'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LabelList,
  ResponsiveContainer,
} from 'recharts'
import { useChartTheme } from '@/components/blueline/useChartTheme'
import type { CsPhaseCount } from '@/lib/types/database'

function fmtDays(d: number | null): string {
  if (d == null) return '—'
  if (d < 1) return `${Math.round(d * 24)} h`
  return `${d.toFixed(1)} d`
}

// Há quanto tempo, em média, os cards que estão HOJE em cada fase entraram nela — proxy de
// "tempo na fase", calculado a partir do último evento de transição conhecido (ou created_at
// do card, na ausência de histórico). Fica mais preciso conforme o cenário do Make roda e
// acumula transições reais (ver docs/docs_dashboard_cs/README.md).
export function CsDwellByPhase({ data }: { data: CsPhaseCount[] }) {
  const ct = useChartTheme()
  const chartData = data.filter((d) => d.count > 0 && d.avgDaysInPhase != null)
  const hasData = chartData.length > 0
  const chartHeight = Math.max(360, chartData.length * 24)

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-card p-5 shadow-elevated">
      <div className="pointer-events-none absolute -top-20 right-0 h-48 w-48 rounded-full bg-primary/15 blur-3xl" />
      <h2 className="text-sm font-semibold text-foreground">Tempo na fase atual</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        Média de quanto tempo os cards de cada fase estão parados nela, até agora. Só fases
        com cards.
      </p>
      {!hasData ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Sem cards em nenhuma fase.</p>
      ) : (
        <div style={{ height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={chartData}
              margin={{ top: 4, right: 48, left: 8, bottom: 4 }}
              barCategoryGap={4}
            >
              <CartesianGrid stroke={ct.grid} horizontal={false} />
              <XAxis
                type="number"
                stroke={ct.axis}
                tick={{ fontSize: 11, fill: ct.axis }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => fmtDays(v as number)}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={160}
                stroke={ct.axis}
                tick={{ fontSize: 10, fill: ct.axis }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={ct.tooltip}
                cursor={{ fill: ct.series.primary, fillOpacity: 0.08 }}
                formatter={(v) => [fmtDays(v as number), 'Tempo médio']}
              />
              <Bar dataKey="avgDaysInPhase" fill={ct.series.primary} radius={[0, 4, 4, 0]} name="Tempo médio">
                <LabelList
                  dataKey="avgDaysInPhase"
                  position="right"
                  formatter={(v) => (typeof v === 'number' ? fmtDays(v) : '—')}
                  style={{ fill: ct.axis, fontSize: 11 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
