'use client'

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
import { useChartTheme } from '@/components/blueline/useChartTheme'
import type { PhaseActivity } from '@/app/actions/leads'

// Distribuição por fase ATUAL — mesma leitura do PhaseDistribution.tsx (onde os leads
// estão agora), mas sobre "leads com movimentação no período" (updated_at), não
// "recebidos no período" (created_at). Cada barra empilha ciclo × retroativo, com o total
// no fim da barra; como o fill já codifica essa identidade, fases mortas são sinalizadas no
// rótulo do eixo (texto em vermelho) em vez de recolorir a barra — texto nunca carrega a cor
// da série (skill dataviz). Cor: ciclo = primary; retroativo = categorical[5] (rosa), não o
// `warning` (laranja) — evita colidir com o vermelho de "morta" e com o laranja já saturado
// noutros cards da mesma tela; par validado (script/validate_palette.js, luz e escuro).
export function PhaseDistributionActivity({ data }: { data: PhaseActivity[] }) {
  const ct = useChartTheme()
  const hasData = data.some((d) => d.total > 0)
  const kindByPhase = new Map(data.map((d) => [d.phase, d.kind]))

  function PhaseTick(props: { x?: string | number; y?: string | number; payload?: { value?: string } }) {
    const { x, y, payload } = props
    const phase = payload?.value ?? ''
    const isDead = kindByPhase.get(phase) === 'morta'
    return (
      <text
        x={x}
        y={y}
        dy={4}
        textAnchor="end"
        fontSize={11}
        fill={isDead ? ct.series.danger : ct.axis}
      >
        {phase}
      </text>
    )
  }

  return (
    <div className="relative h-full overflow-hidden rounded-2xl border border-border bg-gradient-card p-5 shadow-elevated">
      <div className="pointer-events-none absolute -top-20 right-0 h-48 w-48 rounded-full bg-primary/15 blur-3xl" />
      <h2 className="text-sm font-semibold text-foreground">Distribuição atual (acionado no período)</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        Onde os leads mexidos no período estão agora (rótulo em vermelho = fase morta).
      </p>
      {!hasData ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Sem movimentação no período.</p>
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
                width={110}
                stroke={ct.axis}
                tick={PhaseTick}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip contentStyle={ct.tooltip} cursor={{ fill: ct.series.primary, fillOpacity: 0.08 }} />
              <Legend wrapperStyle={{ fontSize: ct.legend.fontSize, color: ct.legend.color }} />
              <Bar dataKey="cycle" stackId="activity" fill={ct.series.primary} name="Do ciclo" />
              <Bar
                dataKey="retro"
                stackId="activity"
                fill={ct.categorical[5]}
                name="Retroativos"
                radius={[0, 4, 4, 0]}
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
      )}
    </div>
  )
}
