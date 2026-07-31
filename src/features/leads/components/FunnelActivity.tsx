'use client'

import { useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LabelList,
  ResponsiveContainer,
} from 'recharts'
import { useChartTheme } from '@/components/bluedesk/useChartTheme'
import { LeadsAgentDrill } from './LeadsAgentDrill'
import type { StageActivity } from '@/app/actions/leads'
import type { LeadPeriod } from '@/lib/period'

// Funil "geral" — leads que ENTRARAM em cada fase no período (acionamento = entrar na
// fase), não "leads com qualquer updated_at". Diferente do Funnel.tsx (cohort = recebidos
// no período), aqui o cohort é "acionado no período" e inclui leads de ciclos anteriores
// que entraram numa fase agora. Cada barra empilha ciclo (criado no período) × retroativo
// (criado antes), com o total no fim da barra. Cor: ciclo = primary; retroativo = categorical[5]
// (rosa) — NÃO o `warning` (laranja) usado em StuckCard/LeadsTable, que aqui já satura o
// olho de tanto aparecer noutros cards da mesma tela; par validado (skill dataviz —
// script/validate_palette.js, luz e escuro, sem colidir com o vermelho de "morta").
// Clicar numa barra abre o drill por responsável → cards + link do Pipefy (lazy).
export function FunnelActivity({ stages, period }: { stages: StageActivity[]; period: LeadPeriod }) {
  const ct = useChartTheme()
  const [selected, setSelected] = useState<StageActivity | null>(null)
  const hasData = stages.some((s) => s.total > 0)

  function handleBarClick(entry: unknown) {
    const p = entry as { order?: number; payload?: { order?: number } }
    const order = p.order ?? p.payload?.order
    if (order == null) return
    setSelected((cur) => (cur?.order === order ? null : stages.find((s) => s.order === order) ?? null))
  }

  return (
    <div className="relative h-full overflow-hidden rounded-2xl border border-border bg-gradient-card p-5 shadow-elevated">
      <div className="pointer-events-none absolute -top-20 right-0 h-48 w-48 rounded-full bg-primary/15 blur-3xl" />
      <h2 className="text-sm font-semibold text-foreground">Funil geral (acionado no período)</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        Leads que ENTRARAM em cada fase no período — inclui leads de ciclos anteriores
        acionados agora. Só conta a fase em que o card entrou (pulos não preenchem etapas).
        Clique numa barra para ver por responsável.
      </p>
      {!hasData ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Sem movimentação no período.</p>
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
                <Tooltip contentStyle={ct.tooltip} cursor={{ fill: ct.series.primary, fillOpacity: 0.08 }} />
                <Legend wrapperStyle={{ fontSize: ct.legend.fontSize, color: ct.legend.color }} />
                <Bar
                  dataKey="cycle"
                  stackId="activity"
                  fill={ct.series.primary}
                  name="Do ciclo"
                  cursor="pointer"
                  onClick={handleBarClick}
                />
                <Bar
                  dataKey="retro"
                  stackId="activity"
                  fill={ct.categorical[5]}
                  name="Retroativos"
                  radius={[0, 4, 4, 0]}
                  cursor="pointer"
                  onClick={handleBarClick}
                >
                  <LabelList
                    dataKey="total"
                    position="right"
                    style={{ fill: ct.axis, fontSize: 11 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {selected && (
            <LeadsAgentDrill
              dimension="funnel_activity"
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
