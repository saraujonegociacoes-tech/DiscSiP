'use client'

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { useChartTheme } from '@/components/blueline/useChartTheme'
import type { CallsByHour } from '@/app/actions/supervisor'

interface CallsChartProps {
  data: CallsByHour[]
}

export function CallsChart({ data }: CallsChartProps) {
  const ct = useChartTheme()
  return (
    <div className="relative h-full overflow-hidden rounded-2xl border border-border bg-gradient-card p-5 shadow-elevated">
      <div className="pointer-events-none absolute -top-20 right-0 h-48 w-48 rounded-full bg-primary/15 blur-3xl" />
      <h2 className="mb-1 text-sm font-semibold text-foreground">Chamadas por hora — hoje</h2>
      <p className="mb-4 text-xs text-muted-foreground">Volume processado ao longo do dia.</p>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id="g-calls" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={ct.series.primary} stopOpacity={0.55} />
                <stop offset="100%" stopColor={ct.series.primary} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={ct.grid} vertical={false} />
            <XAxis
              dataKey="hour"
              stroke={ct.axis}
              tick={{ fontSize: 11, fill: ct.axis }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              stroke={ct.axis}
              tick={{ fontSize: 11, fill: ct.axis }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip contentStyle={ct.tooltip} cursor={{ stroke: ct.series.primary, strokeOpacity: 0.2 }} />
            <Area
              type="monotone"
              dataKey="calls"
              stroke={ct.series.primary}
              strokeWidth={2.5}
              fill="url(#g-calls)"
              name="Chamadas"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
