'use client'

import { Bell, CheckCircle2, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

// Painel de alertas da Visão Geral (Sprint 2) — resumo do que precisa de ação, com contagens.
// Reaproveita os números já calculados (sem acionamento, órfãos, duplicados, parados). Cor por
// significado; leva para a aba Operação (onde estão as listas completas).
export interface AlertItem {
  label: string
  value: number
  tone: 'danger' | 'warning' | 'neutral'
}

const TONE: Record<AlertItem['tone'], string> = {
  danger: 'text-destructive',
  warning: 'text-warning',
  neutral: 'text-foreground',
}

export function AlertsPanel({
  items,
  onOpenOperacao,
}: {
  items: AlertItem[]
  onOpenOperacao?: () => void
}) {
  const allClear = items.every((i) => i.value === 0)

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-gradient-card p-5 shadow-elevated">
      <div className="mb-3 flex items-center gap-2">
        <Bell className="h-4 w-4 text-warning" />
        <h2 className="text-sm font-semibold text-foreground">Alertas</h2>
      </div>

      {allClear ? (
        <div className="flex flex-1 items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
          Nada pendente no momento.
        </div>
      ) : (
        <ul className="flex-1 divide-y divide-border">
          {items.map((i) => (
            <li key={i.label} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0 truncate text-sm text-foreground">{i.label}</span>
              <span className={cn('shrink-0 tabular-nums text-sm font-semibold', TONE[i.tone])}>
                {i.value}
              </span>
            </li>
          ))}
        </ul>
      )}

      {onOpenOperacao && (
        <button
          type="button"
          onClick={onOpenOperacao}
          className="mt-3 inline-flex items-center gap-1 self-start text-xs font-medium text-primary transition-colors hover:underline"
        >
          Ver em Operação
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
