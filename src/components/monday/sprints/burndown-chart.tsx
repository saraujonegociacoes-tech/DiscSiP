'use client'

import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts'
import { format, parseISO } from 'date-fns'
import type { MondayBurndownPoint } from '@/lib/monday/types'

export function BurndownChart({ data }: { data: MondayBurndownPoint[] }) {
  if (!data.length) {
    return (
      <div className="grid h-56 place-items-center text-sm text-muted-foreground">
        Sem dados de burndown.
      </div>
    )
  }

  const chartData = data.map((d) => ({
    label: format(parseISO(d.day), 'dd/MM'),
    ideal: d.ideal,
    restante: d.remaining,
  }))

  return (
    <ResponsiveContainer width="100%" height={224}>
      <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          tickLine={false}
          axisLine={{ stroke: 'var(--border)' }}
        />
        <YAxis
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          tickLine={false}
          axisLine={false}
          width={40}
        />
        <Tooltip
          contentStyle={{
            background: 'var(--popover)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--popover-foreground)',
          }}
        />
        <Line
          type="monotone"
          dataKey="ideal"
          name="Ideal"
          stroke="var(--muted-foreground)"
          strokeDasharray="4 4"
          strokeWidth={1.5}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="restante"
          name="Restante"
          stroke="var(--chart-1)"
          strokeWidth={2.5}
          dot={{ r: 2.5 }}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
