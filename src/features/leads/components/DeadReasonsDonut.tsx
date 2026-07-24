'use client'

import { useMemo } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { useChartTheme } from '@/components/bluedesk/useChartTheme'
import type { DeadReason } from '@/app/actions/leads'

// Motivos de lead morto (S2) — donut (composição categórica) + legenda rotulada com
// contagem e %. A cor identifica a categoria (paleta categórica validada do useChartTheme,
// ordem fixa); a legenda com valores é o rótulo direto exigido pela regra de relevo (alguns
// tons ficam <3:1 no claro). Acima de N motivos, o excedente vira "Outros" (tom neutro).
const MAX_SLICES = 6 // = tamanho da paleta categórica; o 6º slot pode virar "Outros"

interface Slice {
  name: string
  value: number
  color: string
}

export function DeadReasonsDonut({ reasons }: { reasons: DeadReason[] }) {
  const ct = useChartTheme()
  const total = reasons.reduce((a, r) => a + r.leads, 0)

  // `reasons` já vem ordenado desc pela action. Top (MAX_SLICES-1) + "Outros" se sobrar.
  const slices = useMemo<Slice[]>(() => {
    const palette = ct.categorical
    if (reasons.length <= MAX_SLICES) {
      return reasons.map((r, i) => ({ name: r.reason, value: r.leads, color: palette[i] }))
    }
    const head = reasons.slice(0, MAX_SLICES - 1)
    const tail = reasons.slice(MAX_SLICES - 1).reduce((a, r) => a + r.leads, 0)
    return [
      ...head.map((r, i) => ({ name: r.reason, value: r.leads, color: palette[i] })),
      { name: 'Outros', value: tail, color: ct.muted },
    ]
  }, [reasons, ct.categorical, ct.muted])

  return (
    <div className="relative h-full overflow-hidden rounded-2xl border border-border bg-gradient-card p-5 shadow-elevated">
      <div className="pointer-events-none absolute -bottom-16 -right-10 h-44 w-44 rounded-full bg-destructive/15 blur-3xl" />
      <h2 className="text-sm font-semibold text-foreground">Motivos de lead morto</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        {total > 0 ? `${total} leads descartados no período.` : 'Distribuição dos descartes.'}
      </p>

      {total === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Nenhum lead morto no período.</p>
      ) : (
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
          <div className="h-44 w-44 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={48}
                  outerRadius={78}
                  paddingAngle={2}
                  stroke="none"
                >
                  {slices.map((s) => (
                    <Cell key={s.name} fill={s.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={ct.tooltip}
                  formatter={(v, name) => {
                    const n = Number(v)
                    return [`${n} · ${Math.round((n / total) * 100)}%`, name]
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <ul className="min-w-0 flex-1 space-y-1.5 self-stretch">
            {slices.map((s) => (
              <li key={s.name} className="flex items-center gap-2 text-xs">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: s.color }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-foreground" title={s.name}>
                  {s.name}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {s.value} · {Math.round((s.value / total) * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
