'use client'

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AgentRankRow, StuckSplit } from '@/app/actions/leads'

// Ranking comparativo de agentes (visão do supervisor, S3). Definitivo: soma ao ranking
// cru do S1 a coluna "Parados agora" (estado atual, vindo de getSupervisorMetrics) e torna
// a tabela ORDENÁVEL por qualquer coluna — a ferramenta de comparação do supervisor. Leads
// de responsabilidade duplicada já saem de fora (na action + no split de parados), aparecem
// só no alerta próprio.

const pct = (n: number) => `${Math.round(n * 100)}%`
const fmtHours = (h: number | null) =>
  h == null ? '—' : h >= 24 ? `${(h / 24).toFixed(1)} d` : `${h.toFixed(1)} h`

// Linha mesclada: ranking do período + parados agora (now-scoped).
interface BoardRow extends AgentRankRow {
  stuckNow: number
  stuckCycle: number
}

type SortKey =
  | 'name'
  | 'totalLeads'
  | 'wonLeads'
  | 'conversionRate'
  | 'deadRate'
  | 'avgHoursToFirstContact'
  | 'stuckNow'

interface Column {
  key: SortKey
  label: string
  align: 'left' | 'right'
  // Menor é melhor (lead morto, tempo de 1º contato, parados) → seta "para cima" no sentido bom.
  lowerIsBetter?: boolean
}

const COLUMNS: Column[] = [
  { key: 'name', label: 'Agente', align: 'left' },
  { key: 'totalLeads', label: 'Recebidos', align: 'right' },
  { key: 'wonLeads', label: 'Ganhos', align: 'right' },
  { key: 'conversionRate', label: 'Conversão', align: 'right' },
  { key: 'deadRate', label: 'Lead morto', align: 'right', lowerIsBetter: true },
  { key: 'avgHoursToFirstContact', label: '1º contato', align: 'right', lowerIsBetter: true },
  { key: 'stuckNow', label: 'Parados agora', align: 'right', lowerIsBetter: true },
]

function valueOf(row: BoardRow, key: SortKey): number | string | null {
  switch (key) {
    case 'name':
      return row.name.toLowerCase()
    case 'stuckNow':
      return row.stuckNow
    default:
      return row[key]
  }
}

export function AgentRanking({
  rows,
  stuckByAgent,
}: {
  rows: AgentRankRow[]
  stuckByAgent: Record<string, StuckSplit>
}) {
  const [sortKey, setSortKey] = useState<SortKey>('wonLeads')
  const [asc, setAsc] = useState(false) // desc por padrão (mais ganhos no topo)

  const board = useMemo<BoardRow[]>(
    () =>
      rows.map((r) => {
        const s = stuckByAgent[r.agentId]
        return { ...r, stuckNow: s?.now ?? 0, stuckCycle: s?.cycle ?? 0 }
      }),
    [rows, stuckByAgent]
  )

  const sorted = useMemo(() => {
    const dir = asc ? 1 : -1
    return [...board].sort((a, b) => {
      const va = valueOf(a, sortKey)
      const vb = valueOf(b, sortKey)
      // Nulos sempre por último, independentemente da direção.
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      if (typeof va === 'string' || typeof vb === 'string') {
        return String(va).localeCompare(String(vb)) * dir
      }
      return (va - vb) * dir || b.totalLeads - a.totalLeads
    })
  }, [board, sortKey, asc])

  function toggleSort(col: Column) {
    if (col.key === sortKey) {
      setAsc((v) => !v)
    } else {
      setSortKey(col.key)
      // Padrão útil: nome asc; métricas "maior é melhor" desc; "menor é melhor" asc.
      setAsc(col.key === 'name' ? true : !!col.lowerIsBetter)
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-gradient-card shadow-elevated">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">Ranking de agentes</h2>
        <p className="text-xs text-muted-foreground">
          {board.length} {board.length === 1 ? 'agente' : 'agentes'} com leads no período · clique
          numa coluna para ordenar
        </p>
      </div>
      {board.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Sem leads atribuídos no período.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-background/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-right font-medium">#</th>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    aria-sort={sortKey === c.key ? (asc ? 'ascending' : 'descending') : 'none'}
                    className={cn('px-5 py-3 font-medium', c.align === 'right' ? 'text-right' : 'text-left')}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(c)}
                      className={cn(
                        'inline-flex items-center gap-1 transition-colors hover:text-foreground',
                        c.align === 'right' && 'flex-row-reverse',
                        sortKey === c.key && 'text-foreground'
                      )}
                    >
                      {c.label}
                      {sortKey === c.key &&
                        (asc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((a, i) => (
                <tr key={a.agentId} className="transition-colors hover:bg-accent/40">
                  <td className="px-4 py-3 text-right tabular-nums text-xs text-muted-foreground">
                    {i + 1}
                  </td>
                  <td className="px-5 py-3 font-medium text-foreground">{a.name}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                    {a.totalLeads}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-success">{a.wonLeads}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-foreground">
                    {pct(a.conversionRate)}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-destructive">
                    {pct(a.deadRate)}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                    {fmtHours(a.avgHoursToFirstContact)}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {a.stuckNow === 0 ? (
                      <span className="text-muted-foreground">0</span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 text-warning"
                        title={`${a.stuckCycle} do ciclo · ${a.stuckNow - a.stuckCycle} retroativos`}
                      >
                        <AlertTriangle className="h-3 w-3" />
                        {a.stuckNow}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
