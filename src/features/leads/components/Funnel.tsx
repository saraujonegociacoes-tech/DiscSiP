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
import type { FunnelStage } from '@/app/actions/leads'

// Funil de acionamento (S2) — barras horizontais (magnitude), série única. Cada etapa
// conta quantos leads do período ALCANÇARAM aquela ordem ou além (monotônico, cai a cada
// etapa). Série única → sem legenda; o título nomeia a métrica e os rótulos diretos dão o
// valor exato. Espelha o padrão do dashboard do discador (CallsChart + useChartTheme).
export function Funnel({ stages }: { stages: FunnelStage[] }) {
  const ct = useChartTheme()
  const hasData = stages.some((s) => s.leadsReached > 0)

  return (
    <div className="relative h-full overflow-hidden rounded-2xl border border-border bg-gradient-card p-5 shadow-elevated">
      <div className="pointer-events-none absolute -top-20 right-0 h-48 w-48 rounded-full bg-primary/15 blur-3xl" />
      <h2 className="text-sm font-semibold text-foreground">Funil de acionamento</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        Leads que alcançaram cada etapa no período.
      </p>
      {!hasData ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Sem leads no período.</p>
      ) : (
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={stages}
              margin={{ top: 4, right: 40, left: 8, bottom: 4 }}
              barCategoryGap={6}
            >
              <CartesianGrid stroke={ct.grid} horizontal={false} />
              <XAxis
                type="number"
                allowDecimals={false}
                stroke={ct.axis}
                tick={{ fontSize: 11, fill: ct.axis }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="phase"
                width={96}
                stroke={ct.axis}
                tick={{ fontSize: 11, fill: ct.axis }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={ct.tooltip}
                cursor={{ fill: ct.series.primary, fillOpacity: 0.08 }}
                formatter={(v) => [v as number, 'Leads']}
              />
              <Bar dataKey="leadsReached" fill={ct.series.primary} radius={[0, 4, 4, 0]} name="Leads">
                <LabelList
                  dataKey="leadsReached"
                  position="right"
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
