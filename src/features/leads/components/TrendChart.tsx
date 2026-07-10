'use client'

import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { useChartTheme } from '@/components/blueline/useChartTheme'
import type { TrendPoint } from '@/app/actions/leads'

type Tone = 'primary' | 'success' | 'warning' | 'danger'
type Format = 'number' | 'percent' | 'hours'

// Gráfico de UMA métrica ao longo dos ciclos (aba Performance — Sprint 2). Linha (tendência) ou
// área (volume). Reusado 4× pelo PerformancePanel. X = rótulo do ciclo; formatação por métrica.
export function TrendChart({
  data,
  dataKey,
  title,
  subtitle,
  kind = 'line',
  tone = 'primary',
  format = 'number',
}: {
  data: TrendPoint[]
  dataKey: keyof TrendPoint
  title: string
  subtitle?: string
  kind?: 'line' | 'area'
  tone?: Tone
  format?: Format
}) {
  const ct = useChartTheme()
  const color = ct.series[tone]
  const fmt = (v: number | null | undefined): string =>
    v == null
      ? '—'
      : format === 'percent'
        ? `${Math.round(v * 100)}%`
        : format === 'hours'
          ? `${v}h`
          : String(v)
  const hasData = data.length > 0

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-card p-5 shadow-elevated">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {subtitle && <p className="mb-3 text-xs text-muted-foreground">{subtitle}</p>}
      {!hasData ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Sem histórico disponível.</p>
      ) : (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            {kind === 'area' ? (
              <AreaChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid stroke={ct.grid} vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke={ct.axis}
                  tick={{ fontSize: 11, fill: ct.axis }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={fmt}
                  stroke={ct.axis}
                  tick={{ fontSize: 11, fill: ct.axis }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip contentStyle={ct.tooltip} formatter={(v) => [fmt(v as number), title]} />
                <Area
                  type="monotone"
                  dataKey={dataKey}
                  stroke={color}
                  fill={color}
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
              </AreaChart>
            ) : (
              <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid stroke={ct.grid} vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke={ct.axis}
                  tick={{ fontSize: 11, fill: ct.axis }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={fmt}
                  stroke={ct.axis}
                  tick={{ fontSize: 11, fill: ct.axis }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip contentStyle={ct.tooltip} formatter={(v) => [fmt(v as number), title]} />
                <Line
                  type="monotone"
                  dataKey={dataKey}
                  stroke={color}
                  strokeWidth={2}
                  dot={{ r: 3, fill: color }}
                />
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
