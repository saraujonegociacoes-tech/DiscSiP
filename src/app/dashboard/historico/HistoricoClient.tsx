'use client'

import { useEffect, useState } from 'react'
import { PhoneIncoming, PhoneOutgoing } from 'lucide-react'
import { AppShell } from '@/components/bluedesk/AppShell'
import { PageHeader } from '@/components/bluedesk/PageHeader'
import { PeriodPicker } from '@/components/bluedesk/PeriodPicker'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { DISPOSITIONS } from '@/lib/dispositions'
import { getCallHistoryFiltered, type CallHistoryRow } from '@/app/actions/supervisor'
import type { LeadPeriod } from '@/lib/period'

const STATUS_LABEL: Record<string, string> = {
  answered: 'Atendida',
  no_answer: 'Não atendida',
  busy: 'Ocupado',
  failed: 'Falha',
}

const STATUS_COLOR: Record<string, string> = {
  answered: 'text-success',
  no_answer: 'text-warning',
  busy: 'text-warning',
  failed: 'text-destructive',
}

const DISPOSITION_LABEL: Record<string, string> = Object.fromEntries(
  DISPOSITIONS.map((d) => [d.value, d.label])
)

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
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

interface Props {
  initialPeriod: LeadPeriod
  agents: { id: string; name: string; extension: number | null }[]
  campaigns: { id: string; name: string }[]
  initialRows: CallHistoryRow[]
  initialHasMore: boolean
}

const selectCls =
  'rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground shadow-card outline-none focus:border-primary disabled:opacity-50'

export function HistoricoClient({ initialPeriod, agents, campaigns, initialRows, initialHasMore }: Props) {
  const [period, setPeriod] = useState<LeadPeriod>(initialPeriod)
  const [agentId, setAgentId] = useState('')
  const [campaignId, setCampaignId] = useState('')
  const [rows, setRows] = useState<CallHistoryRow[]>(initialRows)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  // Primeira renderização já veio pronta do server (initialRows) — só refiltra quando o
  // usuário muda período/agente/campanha depois disso.
  const [isFirstRender, setIsFirstRender] = useState(true)
  useEffect(() => {
    if (isFirstRender) {
      setIsFirstRender(false)
      return
    }
    setLoading(true)
    getCallHistoryFiltered({
      period,
      agentId: agentId || undefined,
      campaignId: campaignId || undefined,
      page: 0,
    }).then(({ rows, hasMore }) => {
      setRows(rows)
      setHasMore(hasMore)
      setPage(0)
      setLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, agentId, campaignId])

  const handleLoadMore = async () => {
    setLoadingMore(true)
    const next = page + 1
    const { rows: more, hasMore: nextHasMore } = await getCallHistoryFiltered({
      period,
      agentId: agentId || undefined,
      campaignId: campaignId || undefined,
      page: next,
    })
    setRows((prev) => [...prev, ...more])
    setHasMore(nextHasMore)
    setPage(next)
    setLoadingMore(false)
  }

  return (
    <AppShell>
      <PageHeader
        title="Histórico de chamadas"
        description="Consulte as ligações da operação por período, agente ou campanha."
      />

      <div className="flex flex-wrap items-center gap-2">
        <PeriodPicker value={period} onChange={setPeriod} disabled={loading} />
        <select
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          disabled={loading}
          className={selectCls}
          aria-label="Agente"
        >
          <option value="">Todos os agentes</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
          disabled={loading}
          className={selectCls}
          aria-label="Campanha"
        >
          <option value="">Todas as campanhas</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        {rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {loading ? 'Carregando...' : 'Nenhuma ligação encontrada no período/filtro selecionado.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 text-left font-medium">Quando</th>
                  <th className="px-5 py-3 text-left font-medium">Agente</th>
                  <th className="px-5 py-3 text-left font-medium">Campanha</th>
                  <th className="px-5 py-3 text-left font-medium">Telefone</th>
                  <th className="px-5 py-3 text-left font-medium">Resultado</th>
                  <th className="px-5 py-3 text-right font-medium">Duração</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id} className="transition-colors hover:bg-accent/40">
                    <td className="px-5 py-3 text-muted-foreground">{formatDate(r.createdAt)}</td>
                    <td className="px-5 py-3 text-foreground">{r.agentName ?? '—'}</td>
                    <td className="px-5 py-3 text-muted-foreground">{r.campaignName ?? '—'}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2 font-mono text-foreground">
                        {r.direction === 'inbound' ? (
                          <PhoneIncoming className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <PhoneOutgoing className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                        {r.phoneNumber}
                      </div>
                    </td>
                    <td className={cn('px-5 py-3 font-medium', STATUS_COLOR[r.status])}>
                      {r.disposition ? (DISPOSITION_LABEL[r.disposition] ?? r.disposition) : STATUS_LABEL[r.status]}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                      {formatDuration(r.durationSeconds)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" size="sm" onClick={handleLoadMore} disabled={loadingMore}>
            {loadingMore ? 'Carregando...' : 'Carregar mais'}
          </Button>
        </div>
      )}
    </AppShell>
  )
}
