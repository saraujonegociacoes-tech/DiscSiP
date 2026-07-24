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
import { useChartTheme } from '@/components/bluedesk/useChartTheme'
import type { StepDwellTime as StepDwellTimeRow } from '@/app/actions/leads'

// Tempo até 1º contato em unidade legível (horas até 24h, senão dias). Mesma regra do
// LeadKpiRow/AgentRanking.
function fmtHours(h: number | null): string {
  if (h == null) return '—'
  if (h >= 24) return `${(h / 24).toFixed(1)} d`
  return `${h.toFixed(1)} h`
}

// Tempo médio por etapa (S3 — Funil aprofundado) — barras horizontais, série única. Quanto
// tempo um lead leva em cada etapa até avançar para a próxima (dwell time via lead_events). Só
// entram etapas com transições completas no período; um lead ainda parado na fase atual não
// conta (dwell em aberto). Espelha o padrão do Funnel/DeathByAttempt (useChartTheme).
export function StepDwellTime({ data }: { data: StepDwellTimeRow[] }) {
  const ct = useChartTheme()
  const chartData = data.filter((d) => d.sampleSize > 0)
  const hasData = chartData.length > 0

  return (
    <div className="relative h-full overflow-hidden rounded-2xl border border-border bg-gradient-card p-5 shadow-elevated">
      <div className="pointer-events-none absolute -top-20 right-0 h-48 w-48 rounded-full bg-primary/15 blur-3xl" />
      <h2 className="text-sm font-semibold text-foreground">Tempo médio por etapa</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        Quanto tempo um lead leva em cada etapa até avançar para a próxima.
      </p>
      {!hasData ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Sem transições completas no período.
        </p>
      ) : (
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={chartData}
              margin={{ top: 4, right: 48, left: 8, bottom: 4 }}
              barCategoryGap={6}
            >
              <CartesianGrid stroke={ct.grid} horizontal={false} />
              <XAxis
                type="number"
                stroke={ct.axis}
                tick={{ fontSize: 11, fill: ct.axis }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => fmtHours(v as number)}
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
                formatter={(v) => [fmtHours(v as number), 'Tempo médio']}
              />
              <Bar dataKey="avgHours" fill={ct.series.primary} radius={[0, 4, 4, 0]} name="Tempo médio">
                <LabelList
                  dataKey="avgHours"
                  position="right"
                  formatter={(v) => (typeof v === 'number' ? fmtHours(v) : '—')}
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
