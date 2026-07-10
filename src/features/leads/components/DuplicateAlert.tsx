import { AlertTriangle, ExternalLink } from 'lucide-react'
import type { DuplicateAlert as DuplicateAlertRow } from '@/app/actions/leads'
import { pipefyCardUrl } from '@/lib/leads/pipefy'

// Alerta de responsabilidade duplicada (visão do supervisor). Estado atual, não por
// período. Cada item é um lead com 2+ responsáveis no Pipefy — para o supervisor corrigir.
export function DuplicateAlert({ rows }: { rows: DuplicateAlertRow[] }) {
  if (rows.length === 0) return null

  return (
    <section className="overflow-hidden rounded-2xl border border-warning/30 bg-warning/5 shadow-elevated">
      <div className="flex items-center gap-2 border-b border-warning/20 px-5 py-4">
        <AlertTriangle className="h-4 w-4 text-warning" />
        <div>
          <h2 className="text-sm font-semibold text-foreground">Responsabilidade duplicada</h2>
          <p className="text-xs text-muted-foreground">
            {rows.length} {rows.length === 1 ? 'lead com 2+ responsáveis' : 'leads com 2+ responsáveis'} — corrigir no Pipefy
          </p>
        </div>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.leadId} className="flex items-center justify-between gap-3 px-5 py-2.5">
            <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={r.title ?? undefined}>
              {r.title ?? 'Sem título'}
            </span>
            <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{r.currentPhase ?? '—'}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{r.responsible ?? '—'}</span>
            {r.pipefyCardId && (
              <a
                href={pipefyCardUrl(r.pipefyCardId)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                title="Abrir card no Pipefy"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Pipefy</span>
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
