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
import type { DeathByAttempt as DeathByAttemptRow } from '@/app/actions/leads'

// Em qual tentativa o lead mais morre (S3) — barras horizontais, série única. Cada barra é
// a última etapa produtiva alcançada pelos leads mortos; a forma mostra onde a operação
// perde lead (tipicamente cedo, no 1° Acionamento). Cor = "danger" (é mortalidade). Espelha
// o padrão do Funnel (useChartTheme).
export function DeathByAttempt({ data }: { data: DeathByAttemptRow[] }) {
  const ct = useChartTheme()
  const hasData = data.some((d) => d.deaths > 0)

  return (
    <div className="relative h-full overflow-hidden rounded-2xl border border-border bg-gradient-card p-5 shadow-elevated">
      <div className="pointer-events-none absolute -top-20 right-0 h-48 w-48 rounded-full bg-destructive/15 blur-3xl" />
      <h2 className="text-sm font-semibold text-foreground">Onde o lead morre</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        Última etapa alcançada pelos leads mortos no período.
      </p>
      {!hasData ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhum lead morto no período.
        </p>
      ) : (
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={data}
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
                cursor={{ fill: ct.series.danger, fillOpacity: 0.08 }}
                formatter={(v) => [v as number, 'Leads mortos']}
              />
              <Bar dataKey="deaths" fill={ct.series.danger} radius={[0, 4, 4, 0]} name="Leads mortos">
                <LabelList dataKey="deaths" position="right" style={{ fill: ct.axis, fontSize: 11 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
