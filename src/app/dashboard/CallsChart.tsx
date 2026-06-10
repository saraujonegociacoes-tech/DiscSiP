'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { CallsByHour } from '@/app/actions/supervisor'

interface CallsChartProps {
  data: CallsByHour[]
}

export function CallsChart({ data }: CallsChartProps) {
  return (
    <div className="bg-[#1e293b] rounded-xl p-5">
      <h2 className="text-white text-sm font-medium mb-4">Chamadas por hora — hoje</h2>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="hour" tick={{ fill: '#94a3b8', fontSize: 11 }} />
          <YAxis allowDecimals={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }}
            labelStyle={{ color: '#e2e8f0' }}
            itemStyle={{ color: '#38bdf8' }}
          />
          <Line
            type="monotone"
            dataKey="calls"
            stroke="#38bdf8"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: '#38bdf8' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
