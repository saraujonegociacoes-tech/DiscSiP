'use client'

import { useState } from 'react'
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
import { ResponsibleBreakdown } from './ResponsibleBreakdown'
import type { FunnelStage, AgentCount } from '@/app/actions/leads'

interface StepConversionRow {
  fromOrder: number
  fromPhase: string
  toPhase: string
  rate: number | null // entrou[i+1]/entrou[i]; null se ninguém entrou na etapa anterior
  barRate: number | null // rate limitado a [0,1] só para a largura da barra (o rótulo mostra o real)
}

// Deriva do FUNIL já carregado (data.funnel) — nenhum dado novo. O funil agora conta ENTRADAS
// de fase (não é mais cumulativo); a razão adjacente entrou[i+1]/entrou[i] isola ONDE a queda é
// mais forte passo a passo. Como um lead pode entrar direto numa etapa posterior (pulo), a razão
// pode passar de 100% (entrada líquida) — o rótulo mostra o valor real e a barra satura em 100%.
function buildStepConversion(stages: FunnelStage[]): StepConversionRow[] {
  return stages.slice(0, -1).map((from, i) => {
    const to = stages[i + 1]
    const rate = from.leadsReached > 0 ? to.leadsReached / from.leadsReached : null
    return {
      fromOrder: from.order,
      fromPhase: from.phase,
      toPhase: to.phase,
      rate,
      barRate: rate == null ? null : Math.min(rate, 1),
    }
  })
}

// Conversão entre etapas adjacentes (S3 — Funil aprofundado) — barras horizontais, série
// única. Cada barra é a fração dos leads que ALCANÇARAM a etapa anterior e avançaram para
// esta. Clicar numa barra mostra a REPRESENTATIVIDADE de cada responsável naquela etapa
// (quem alcançou a etapa de origem), reusando funnelByResponsible — sem drill até card.
export function StepConversion({
  stages,
  byResponsible = {},
}: {
  stages: FunnelStage[]
  byResponsible?: Record<string, AgentCount[]>
}) {
  const ct = useChartTheme()
  const [selected, setSelected] = useState<StepConversionRow | null>(null)
  const data = buildStepConversion(stages).filter((d) => d.rate != null)
  const hasData = data.length > 0

  function handleBarClick(entry: unknown) {
    const p = entry as { fromOrder?: number; payload?: { fromOrder?: number } }
    const order = p.fromOrder ?? p.payload?.fromOrder
    if (order == null) return
    setSelected((cur) => (cur?.fromOrder === order ? null : data.find((d) => d.fromOrder === order) ?? null))
  }

  return (
    <div className="relative h-full overflow-hidden rounded-2xl border border-border bg-gradient-card p-5 shadow-elevated">
      <div className="pointer-events-none absolute -top-20 right-0 h-48 w-48 rounded-full bg-primary/15 blur-3xl" />
      <h2 className="text-sm font-semibold text-foreground">Conversão entre etapas</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        Dos leads que entraram em cada etapa, quantos entraram na seguinte. Clique numa barra
        para ver a representatividade por responsável.
      </p>
      {!hasData ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Sem leads no período.</p>
      ) : (
        <>
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
                  formatter={(_v, _n, item) => {
                    const row = item.payload as StepConversionRow
                    return [row.rate != null ? `${Math.round(row.rate * 100)}%` : '—', `De ${row.fromPhase}`]
                  }}
                />
                <Bar
                  dataKey="barRate"
                  fill={ct.series.primary}
                  radius={[0, 4, 4, 0]}
                  name="Conversão"
                  cursor="pointer"
                  onClick={handleBarClick}
                >
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
          {selected && (
            <ResponsibleBreakdown
              title={`Entraram em ${selected.fromPhase}`}
              rows={byResponsible[String(selected.fromOrder)] ?? []}
              onClose={() => setSelected(null)}
            />
          )}
        </>
      )}
    </div>
  )
}
