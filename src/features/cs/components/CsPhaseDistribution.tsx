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
import { useChartTheme } from '@/components/blueline/useChartTheme'
import { CsResponsibleBreakdown } from './CsResponsibleBreakdown'
import type { CsPhaseCount, CsAgentCount } from '@/lib/types/database'

// Quantos cards existem HOJE em cada fase, na ordem do funil (Triagem → ... → 24° Mês →
// saídas). Diferente do funil do comercial: aqui não há "morta"/"produtiva" classificada
// ainda (pendente de definição do dono — ver docs/updates/painel-sucesso-cliente-cs.md),
// então todas as barras usam a mesma cor por enquanto. Clique numa barra abre o
// detalhamento por responsável.
export function CsPhaseDistribution({
  data,
  byResponsible = {},
}: {
  data: CsPhaseCount[]
  byResponsible?: Record<string, CsAgentCount[]>
}) {
  const ct = useChartTheme()
  const [selected, setSelected] = useState<string | null>(null)
  const hasData = data.some((d) => d.count > 0)
  const chartHeight = Math.max(420, data.length * 24)

  function handleBarClick(entry: unknown) {
    const p = entry as { name?: string; payload?: { name?: string } }
    const name = p.name ?? p.payload?.name
    if (name == null) return
    setSelected((cur) => (cur === name ? null : name))
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-card p-5 shadow-elevated">
      <div className="pointer-events-none absolute -top-20 right-0 h-48 w-48 rounded-full bg-primary/15 blur-3xl" />
      <h2 className="text-sm font-semibold text-foreground">Cards por fase</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        Onde os clientes estão agora, na ordem do acompanhamento. Clique numa barra para ver
        por responsável.
      </p>
      {!hasData ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Sem cards.</p>
      ) : (
        <>
          <div style={{ height: chartHeight }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={data}
                margin={{ top: 4, right: 40, left: 8, bottom: 4 }}
                barCategoryGap={4}
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
                  dataKey="name"
                  width={160}
                  stroke={ct.axis}
                  tick={{ fontSize: 10, fill: ct.axis }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={ct.tooltip}
                  cursor={{ fill: ct.series.primary, fillOpacity: 0.08 }}
                  formatter={(v) => [v as number, 'Cards']}
                />
                <Bar
                  dataKey="count"
                  fill={ct.series.primary}
                  radius={[0, 4, 4, 0]}
                  name="Cards"
                  cursor="pointer"
                  onClick={handleBarClick}
                >
                  <LabelList dataKey="count" position="right" style={{ fill: ct.axis, fontSize: 11 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {selected && (
            <CsResponsibleBreakdown
              title={selected}
              rows={byResponsible[selected] ?? []}
              onClose={() => setSelected(null)}
            />
          )}
        </>
      )}
    </div>
  )
}
