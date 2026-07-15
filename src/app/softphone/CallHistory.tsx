'use client'

import { useEffect, useState } from 'react'
import { PhoneIncoming, PhoneOutgoing, Phone } from 'lucide-react'
import { getCallHistory } from '@/app/actions/dialer'
import { PeriodPicker } from '@/components/blueline/PeriodPicker'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { DISPOSITIONS } from '@/lib/dispositions'
import { currentCycle, type LeadPeriod } from '@/lib/period'
import type { CallLog } from '@/lib/types/database'

interface CallHistoryProps {
  agentId: string
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDuration(seconds: number) {
  if (seconds === 0) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

const STATUS_LABEL: Record<string, string> = {
  answered: 'Atendida',
  no_answer: 'Não atendida',
  busy: 'Ocupado',
  failed: 'Falha',
}

// value da disposição → rótulo exibido (ex.: 'interested' → 'Interessado'). O histórico
// mostra o que o agente TABULOU; só cai no STATUS_LABEL quando não há disposição (logs antigos).
const DISPOSITION_LABEL: Record<string, string> = Object.fromEntries(
  DISPOSITIONS.map((d) => [d.value, d.label])
)

const STATUS_COLOR: Record<string, string> = {
  answered: 'text-success',
  no_answer: 'text-warning',
  busy: 'text-warning',
  failed: 'text-destructive',
}

export function CallHistory({ agentId }: CallHistoryProps) {
  const [period, setPeriod] = useState<LeadPeriod>(() => currentCycle())
  const [logs, setLogs] = useState<CallLog[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)

  // Troca de agente ou de período reinicia a paginação do zero.
  useEffect(() => {
    setLoading(true)
    getCallHistory(agentId, period, 0).then(({ logs, hasMore }) => {
      setLogs(logs)
      setHasMore(hasMore)
      setPage(0)
      setLoading(false)
    })
  }, [agentId, period])

  const handleLoadMore = async () => {
    setLoadingMore(true)
    const next = page + 1
    const { logs: more, hasMore: nextHasMore } = await getCallHistory(agentId, period, next)
    setLogs((prev) => [...prev, ...more])
    setHasMore(nextHasMore)
    setPage(next)
    setLoadingMore(false)
  }

  const picker = <PeriodPicker value={period} onChange={setPeriod} disabled={loading} />

  if (loading) {
    return (
      <div className="space-y-3">
        {picker}
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-2xl border border-border bg-gradient-card px-4 py-3 shadow-card"
            >
              <Skeleton className="h-8 w-8 shrink-0 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-2.5 w-20" />
              </div>
              <div className="space-y-2 text-right">
                <Skeleton className="ml-auto h-3 w-16" />
                <Skeleton className="ml-auto h-2.5 w-10" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (logs.length === 0) {
    return (
      <div className="space-y-3">
        {picker}
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-gradient-card py-12 shadow-card">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Phone className="h-6 w-6" />
          </div>
          <p className="text-sm font-medium text-foreground">Nenhuma chamada registrada</p>
          <p className="max-w-xs text-center text-xs text-muted-foreground">
            Nenhuma ligação no período selecionado.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {picker}
      <div className="space-y-2">
      {logs.map((log) => (
        <div
          key={log.id}
          className="flex items-center gap-3 rounded-2xl border border-border bg-gradient-card px-4 py-3 shadow-card"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            {log.direction === 'inbound' ? (
              <PhoneIncoming className="h-4 w-4" />
            ) : (
              <PhoneOutgoing className="h-4 w-4" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-sm text-foreground">{log.phone_number}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{formatDate(log.created_at)}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className={cn('text-xs font-medium', STATUS_COLOR[log.status])}>
              {log.disposition
                ? (DISPOSITION_LABEL[log.disposition] ?? log.disposition)
                : STATUS_LABEL[log.status]}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{formatDuration(log.duration_seconds)}</p>
          </div>
        </div>
      ))}
      </div>
      {hasMore && (
        <div className="flex justify-center pt-1">
          <Button variant="outline" size="sm" onClick={handleLoadMore} disabled={loadingMore}>
            {loadingMore ? 'Carregando...' : 'Carregar mais'}
          </Button>
        </div>
      )}
    </div>
  )
}
