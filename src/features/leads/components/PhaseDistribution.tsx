'use client'

import { useState } from 'react'
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LabelList,
  ResponsiveContainer,
} from 'recharts'
import { useChartTheme } from '@/components/blueline/useChartTheme'
import { LeadsAgentDrill } from './LeadsAgentDrill'
import type { PhaseDistribution as PhaseDistributionRow } from '@/app/actions/leads'
import type { LeadPeriod } from '@/lib/period'

// Distribuição por fase ATUAL — barras horizontais do VOLUME atual (quantos leads do período
// estão agora em cada fase). Complementa o Funil (fluxo cumulativo): aqui a soma bate com o
// total. Fases mortas em vermelho (cor por significado). Clicar numa barra abre o drill por
// responsável → cards + link do Pipefy (lazy). Espelha o padrão do Funnel + useChartTheme.
export function PhaseDistribution({
  data,
  period,
}: {
  data: PhaseDistributionRow[]
  period: LeadPeriod
}) {
  const ct = useChartTheme()
  const [selected, setSelected] = useState<string | null>(null)
  const hasData = data.some((d) => d.leads > 0)

  function handleBarClick(entry: unknown) {
    const p = entry as { phase?: string; payload?: { phase?: string } }
    const phase = p.phase ?? p.payload?.phase
    if (phase == null) return
    setSelected((cur) => (cur === phase ? null : phase))
  }

  return (
    <div className="relative h-full overflow-hidden rounded-2xl border border-border bg-gradient-card p-5 shadow-elevated">
      <div className="pointer-events-none absolute -top-20 right-0 h-48 w-48 rounded-full bg-primary/15 blur-3xl" />
      <h2 className="text-sm font-semibold text-foreground">Distribuição por fase atual</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        Onde os leads do período estão agora (mortas em vermelho). Clique numa barra para ver por
        responsável.
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
                  allowDecimals={false}
                  stroke={ct.axis}
                  tick={{ fontSize: 11, fill: ct.axis }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="phase"
                  width={110}
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
                <Bar
                  dataKey="leads"
                  radius={[0, 4, 4, 0]}
                  name="Leads"
                  cursor="pointer"
                  onClick={handleBarClick}
                >
                  {data.map((d) => (
                    <Cell
                      key={d.phase}
                      fill={d.kind === 'morta' ? ct.series.danger : ct.series.primary}
                    />
                  ))}
                  <LabelList
                    dataKey="leads"
                    position="right"
                    style={{ fill: ct.axis, fontSize: 11 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {selected && (
            <LeadsAgentDrill
              dimension="phase"
              dimKey={selected}
              title={selected}
              period={period}
              onClose={() => setSelected(null)}
            />
          )}
        </>
      )}
    </div>
  )
}
