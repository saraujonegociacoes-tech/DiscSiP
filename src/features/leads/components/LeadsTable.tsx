'use client'

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import type { AgentLeadRow, AgentLeadStatus } from '@/app/actions/leads'

// Tabela de leads do agente (S2). Combina a FILA de trabalho (todos os abertos, "agora")
// com os DESFECHOS do período (finalizados no ciclo). Filtrável no client (a carga de um
// agente é pequena) e com destaque para os "parados" (SLA de fase estourado). O RLS já
// escopou ao próprio agente na action.

type FilterKey = 'all' | 'open' | 'stuck' | 'won' | 'dead' | 'retro'

const STATUS: Record<AgentLeadStatus, { label: string; cls: string; dot: string }> = {
  won:   { label: 'Ganho',     cls: 'bg-success/10 text-success border-success/30',         dot: 'bg-success' },
  dead:  { label: 'Morto',     cls: 'bg-destructive/10 text-destructive border-destructive/30', dot: 'bg-destructive' },
  stuck: { label: 'Parado',    cls: 'bg-warning/10 text-warning border-warning/30',         dot: 'bg-warning' },
  open:  { label: 'Em aberto', cls: 'bg-muted/40 text-muted-foreground border-border',      dot: 'bg-muted-foreground' },
}

// Duração humana a partir de horas: <1h → min; <48h → h; senão dias.
function fmtHours(h: number | null): string {
  if (h == null) return '—'
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`
  if (h < 48) return `${Math.round(h)} h`
  return `${(h / 24).toFixed(h / 24 >= 10 ? 0 : 1)} d`
}

// Idade em aberto (agora − criado), a partir do created_at ISO.
function ageHours(createdAt: string | null): number | null {
  if (!createdAt) return null
  const ms = Date.now() - Date.parse(createdAt)
  return Number.isFinite(ms) ? ms / 3_600_000 : null
}

function StatusPill({ status }: { status: AgentLeadStatus }) {
  const s = STATUS[status]
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium', s.cls)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  )
}

export function LeadsTable({ rows }: { rows: AgentLeadRow[] }) {
  const [filter, setFilter] = useState<FilterKey>('all')

  const counts = useMemo(
    () => ({
      all: rows.length,
      open: rows.filter((r) => r.finalizedAt == null).length,
      stuck: rows.filter((r) => r.isStuck).length,
      won: rows.filter((r) => r.status === 'won').length,
      dead: rows.filter((r) => r.status === 'dead').length,
      retro: rows.filter((r) => r.origin === 'retroativo').length,
    }),
    [rows]
  )

  const filtered = useMemo(() => {
    switch (filter) {
      case 'open':
        return rows.filter((r) => r.finalizedAt == null)
      case 'stuck':
        return rows.filter((r) => r.isStuck)
      case 'won':
        return rows.filter((r) => r.status === 'won')
      case 'dead':
        return rows.filter((r) => r.status === 'dead')
      case 'retro':
        return rows.filter((r) => r.origin === 'retroativo')
      default:
        return rows
    }
  }, [rows, filter])

  const filters: { key: FilterKey; label: string }[] = [
    { key: 'all', label: 'Todos' },
    { key: 'open', label: 'Abertos' },
    { key: 'stuck', label: 'Parados' },
    { key: 'won', label: 'Ganhos' },
    { key: 'dead', label: 'Mortos' },
    { key: 'retro', label: 'Retroativos' },
  ]

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-gradient-card shadow-elevated">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Meus leads</h2>
          <p className="text-xs text-muted-foreground">
            Fila de trabalho (abertos) + desfechos do período. Parados destacados.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                'rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
                filter === f.key
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border bg-background/40 text-muted-foreground hover:text-foreground'
              )}
            >
              {f.label}
              <span className="ml-1 tabular-nums opacity-70">{counts[f.key]}</span>
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Você não tem leads neste recorte.
        </p>
      ) : filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Nenhum lead neste filtro.</p>
      ) : (
        <div className="max-h-[30rem] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-background/80 text-xs uppercase tracking-wider text-muted-foreground backdrop-blur">
              <tr>
                <th className="px-5 py-3 text-left font-medium">Lead</th>
                <th className="px-5 py-3 text-left font-medium">Fase atual</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Aberto há</th>
                <th className="px-5 py-3 text-right font-medium">SLA</th>
                <th className="px-5 py-3 text-left font-medium">Origem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r) => {
                const open = r.finalizedAt == null
                return (
                  <tr
                    key={r.leadId}
                    className={cn(
                      'transition-colors hover:bg-accent/40',
                      r.isStuck && 'bg-warning/5'
                    )}
                  >
                    <td className="max-w-[16rem] px-5 py-3">
                      <span className="block truncate font-medium text-foreground" title={r.title ?? undefined}>
                        {r.title ?? 'Sem título'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{r.currentPhase ?? '—'}</td>
                    <td className="px-5 py-3">
                      <StatusPill status={r.status} />
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                      {open ? fmtHours(ageHours(r.createdAt)) : '—'}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                      {fmtHours(r.slaHours)}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={cn(
                          'rounded-full border px-2 py-0.5 text-xs',
                          r.origin === 'retroativo'
                            ? 'border-warning/30 bg-warning/5 text-warning'
                            : 'border-border bg-background/40 text-muted-foreground'
                        )}
                      >
                        {r.origin === 'retroativo' ? 'Retroativo' : 'Ciclo'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
