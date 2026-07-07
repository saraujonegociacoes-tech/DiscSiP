import { UserX } from 'lucide-react'
import type { OrphanSummary } from '@/app/actions/leads'

// Leads sem responsável (órfãos) — visão do supervisor, para triagem. Estado atual: total +
// abertos + distribuição por fase (o supervisor vê todos os órfãos; não pertencem a nenhuma
// equipe). Card informativo (não é erro): "tantos cards sem responsável, tantos na fase X…".
export function OrphanLeads({ orphans }: { orphans: OrphanSummary }) {
  if (orphans.total === 0) return null
  const max = orphans.byPhase.reduce((m, p) => Math.max(m, p.leads), 0) || 1

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-gradient-card shadow-elevated">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <div className="rounded-xl bg-muted/40 p-2 text-muted-foreground">
          <UserX className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">Leads sem responsável</h2>
          <p className="text-xs text-muted-foreground">
            <span className="tabular-nums text-foreground">{orphans.total}</span> cards órfãos ·{' '}
            <span className="tabular-nums text-warning">{orphans.open}</span> abertos — atribuir no Pipefy
          </p>
        </div>
      </div>
      <ul className="divide-y divide-border">
        {orphans.byPhase.map((p) => (
          <li key={p.phase} className="flex items-center gap-3 px-5 py-2.5">
            <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={p.phase}>
              {p.phase}
            </span>
            <div className="hidden h-1.5 w-32 shrink-0 overflow-hidden rounded-full bg-muted/40 sm:block">
              <div
                className="h-full bg-primary/60"
                style={{ width: `${Math.round((p.leads / max) * 100)}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-right tabular-nums text-sm text-foreground">
              {p.leads}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
