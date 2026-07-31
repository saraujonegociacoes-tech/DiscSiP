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
import { LeadsAgentDrill } from './LeadsAgentDrill'
import type { FunnelStage } from '@/app/actions/leads'
import type { LeadPeriod } from '@/lib/period'

// Funil de acionamento (S2) — barras horizontais (magnitude), série única. Cada etapa conta
// quantos leads recebidos no período ENTRARAM naquela fase (ordem 0 = todos os recebidos).
// Contagem por entrada real de fase (get_leads_reach_funnel): quem pula uma etapa não é
// contado nela. Clicar numa barra abre o drill por responsável → cards + link do Pipefy (lazy).
export function Funnel({ stages, period }: { stages: FunnelStage[]; period: LeadPeriod }) {
  const ct = useChartTheme()
  const [selected, setSelected] = useState<FunnelStage | null>(null)
  const hasData = stages.some((s) => s.leadsReached > 0)

  // Recharts entrega o datum clicado (campos no topo e/ou em .payload). Casamos pela ordem.
  function handleBarClick(entry: unknown) {
    const p = entry as { order?: number; payload?: { order?: number } }
    const order = p.order ?? p.payload?.order
    if (order == null) return
    setSelected((cur) => (cur?.order === order ? null : stages.find((s) => s.order === order) ?? null))
  }

  return (
    <div className="relative h-full overflow-hidden rounded-2xl border border-border bg-gradient-card p-5 shadow-elevated">
      <div className="pointer-events-none absolute -top-20 right-0 h-48 w-48 rounded-full bg-primary/15 blur-3xl" />
      <h2 className="text-sm font-semibold text-foreground">Funil de acionamento</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        Leads recebidos no período, por fase em que realmente entraram (fase pulada não conta).
        Clique numa barra para ver por responsável.
      </p>
      {!hasData ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Sem leads no período.</p>
      ) : (
        <>
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
                <Bar
                  dataKey="leadsReached"
                  fill={ct.series.primary}
                  radius={[0, 4, 4, 0]}
                  name="Leads"
                  cursor="pointer"
                  onClick={handleBarClick}
                >
                  <LabelList
                    dataKey="leadsReached"
                    position="right"
                    style={{ fill: ct.axis, fontSize: 11 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {selected && (
            <LeadsAgentDrill
              dimension="funnel"
              dimKey={String(selected.order)}
              title={`Entraram em ${selected.phase}`}
              period={period}
              onClose={() => setSelected(null)}
            />
          )}
        </>
      )}
    </div>
  )
}
