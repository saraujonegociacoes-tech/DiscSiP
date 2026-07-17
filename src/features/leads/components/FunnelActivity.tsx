'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { useChartTheme } from '@/components/blueline/useChartTheme'
import type { StageActivity } from '@/app/actions/leads'

// Funil "geral" — mesmo fluxo cumulativo do Funnel.tsx (quantos leads ALCANÇARAM cada
// etapa), mas sobre "leads com movimentação no período" (updated_at), não "recebidos no
// período" (created_at). Cada barra empilha ciclo (criado no período) × retroativo (criado
// antes) — 2 séries categóricas, cores reaproveitadas do resto do painel (mesmo par de
// StuckCard/LeadsTable pra ciclo/retroativo), sempre com legenda (skill dataviz).
export function FunnelActivity({ stages }: { stages: StageActivity[] }) {
  const ct = useChartTheme()
  const hasData = stages.some((s) => s.total > 0)

  return (
    <div className="relative h-full overflow-hidden rounded-2xl border border-border bg-gradient-card p-5 shadow-elevated">
      <div className="pointer-events-none absolute -top-20 right-0 h-48 w-48 rounded-full bg-primary/15 blur-3xl" />
      <h2 className="text-sm font-semibold text-foreground">Funil geral (acionado no período)</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        Leads com QUALQUER movimentação no período, por etapa alcançada — inclui leads de
        ciclos anteriores mexidos agora.
      </p>
      {!hasData ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Sem movimentação no período.</p>
      ) : (
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={stages}
              margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
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
              <Tooltip contentStyle={ct.tooltip} cursor={{ fill: ct.series.primary, fillOpacity: 0.08 }} />
              <Legend wrapperStyle={{ fontSize: ct.legend.fontSize, color: ct.legend.color }} />
              <Bar dataKey="cycle" stackId="activity" fill={ct.series.primary} name="Do ciclo" />
              <Bar
                dataKey="retro"
                stackId="activity"
                fill={ct.series.warning}
                name="Retroativos"
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
