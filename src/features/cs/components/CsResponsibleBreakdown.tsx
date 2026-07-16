'use client'

import { X } from 'lucide-react'
import type { CsAgentCount } from '@/lib/types/database'

// Detalhamento por responsável de uma fase — aparece inline abaixo do gráfico ao clicar
// numa barra da distribuição por fase. Cópia local do padrão de
// src/features/leads/components/ResponsibleBreakdown.tsx (domínio separado — ver decisão
// de arquitetura em docs/updates/painel-sucesso-cliente-cs.md: réplica, não componente
// compartilhado entre os dois domínios).
export function CsResponsibleBreakdown({
  title,
  rows,
  onClose,
}: {
  title: string
  rows: CsAgentCount[]
  onClose: () => void
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1

  return (
    <div className="mt-4 rounded-xl border border-border bg-background/40 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="min-w-0 truncate text-xs font-semibold text-foreground" title={title}>
          {title} · por responsável
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Fechar detalhamento"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sem cards para detalhar.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.agentId ?? 'orphan'} className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-xs text-foreground" title={r.name}>
                {r.name}
              </span>
              <div className="hidden h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted/40 sm:block">
                <div
                  className="h-full bg-primary/60"
                  style={{ width: `${Math.round((r.count / max) * 100)}%` }}
                />
              </div>
              <span className="w-8 shrink-0 text-right tabular-nums text-xs text-foreground">
                {r.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
