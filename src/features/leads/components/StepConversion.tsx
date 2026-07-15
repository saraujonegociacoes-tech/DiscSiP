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

interface StepConversionRow {
  fromPhase: string
  toPhase: string
  rate: number | null // toReached / fromReached ∈ [0,1]; null se ninguém alcançou a etapa anterior
}

// Deriva do FUNIL já carregado (data.funnel) — nenhum dado novo. O funil é cumulativo
// ("alcançou esta ordem ou além"); aqui a razão adjacente reached[i+1]/reached[i] isola ONDE
// a queda é mais forte passo a passo, diferente do % acumulado desde o início.
function buildStepConversion(stages: FunnelStage[]): StepConversionRow[] {
  return stages.slice(0, -1).map((from, i) => {
    const to = stages[i + 1]
    return {
      fromPhase: from.phase,
      toPhase: to.phase,
      rate: from.leadsReached > 0 ? to.leadsReached / from.leadsReached : null,
    }
  })
}

// Conversão entre etapas adjacentes (S3 — Funil aprofundado) — barras horizontais, série
// única. Cada barra é a fração dos leads que ALCANÇARAM a etapa anterior e avançaram para
// esta. Espelha o padrão do Funnel (useChartTheme).
export function StepConversion({ stages }: { stages: FunnelStage[] }) {
  const ct = useChartTheme()
  const data = buildStepConversion(stages).filter((d) => d.rate != null)
  const hasData = data.length > 0

  return (
    <div className="relative h-full overflow-hidden rounded-2xl border border-border bg-gradient-card p-5 shadow-elevated">
      <div className="pointer-events-none absolute -top-20 right-0 h-48 w-48 rounded-full bg-primary/15 blur-3xl" />
      <h2 className="text-sm font-semibold text-foreground">Conversão entre etapas</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        Dos leads que alcançaram cada etapa, quantos avançaram para a seguinte.
      </p>
      {!hasData ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Sem leads no período.</p>
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
                domain={[0, 1]}
                tickFormatter={(v) => `${Math.round((v as number) * 100)}%`}
                stroke={ct.axis}
                tick={{ fontSize: 11, fill: ct.axis }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="toPhase"
                width={96}
                stroke={ct.axis}
                tick={{ fontSize: 11, fill: ct.axis }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={ct.tooltip}
                cursor={{ fill: ct.series.primary, fillOpacity: 0.08 }}
                formatter={(v, _n, item) => [
                  `${Math.round((v as number) * 100)}%`,
                  `De ${(item.payload as StepConversionRow).fromPhase}`,
                ]}
              />
              <Bar dataKey="rate" fill={ct.series.primary} radius={[0, 4, 4, 0]} name="Conversão">
                <LabelList
                  dataKey="rate"
                  position="right"
                  formatter={(v) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : '—')}
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
