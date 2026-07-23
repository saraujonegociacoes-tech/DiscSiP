'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getWarmupHistory } from '@/app/actions/warmup'
import type { WarmupMessage, WarmupNumber } from '@/lib/types/database'

interface Props {
  initialRows: WarmupMessage[]
  hasMore: boolean
  numbers: WarmupNumber[]
}

export function HistoryTable({ initialRows, hasMore, numbers }: Props) {
  const [rows, setRows] = useState<WarmupMessage[]>(initialRows)
  const [page, setPage] = useState(0)
  const [more, setMore] = useState(hasMore)
  const [loading, setLoading] = useState(false)

  const label = (id: string) => {
    const n = numbers.find((x) => x.id === id)
    return n?.display_name || n?.phone_number || '—'
  }

  const loadMore = async () => {
    setLoading(true)
    const next = page + 1
    const { rows: newRows, hasMore: nextHasMore } = await getWarmupHistory(next)
    setRows((prev) => [...prev, ...newRows])
    setPage(next)
    setMore(nextHasMore)
    setLoading(false)
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-gradient-card py-14 text-center shadow-card">
        <p className="text-sm font-medium text-foreground">Sem mensagens ainda</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Rode o tick (ou aguarde o cron) para gerar as primeiras trocas.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-background/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Quando</th>
              <th className="px-4 py-3 text-left font-medium">De → Para</th>
              <th className="px-4 py-3 text-left font-medium">Tipo</th>
              <th className="px-4 py-3 text-left font-medium">Conteúdo</th>
              <th className="px-4 py-3 text-center font-medium">Modo</th>
              <th className="px-4 py-3 text-center font-medium">Entrega</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((m) => (
              <tr key={m.id} className="transition-colors hover:bg-accent/40">
                <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                  {new Date(m.sent_at).toLocaleString('pt-BR')}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  {label(m.from_number_id)} <span className="text-muted-foreground">→</span> {label(m.to_number_id)}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={m.message_type === 'template' ? 'secondary' : 'outline'}>
                    {m.message_type === 'template' ? 'Template' : 'Sessão'}
                  </Badge>
                </td>
                <td className="max-w-xs truncate px-4 py-3 text-muted-foreground">{m.content}</td>
                <td className="px-4 py-3 text-center">
                  <Badge variant={m.dispatch_mode === 'live' ? 'default' : 'outline'}>
                    {m.dispatch_mode === 'live' ? 'Real' : 'Simulado'}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-center">
                  {m.dispatch_mode === 'dry_run' ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : m.make_dispatch_ok === true ? (
                    <span className="text-xs font-medium text-success">Confirmado</span>
                  ) : m.make_dispatch_ok === false ? (
                    <span className="text-xs font-medium text-destructive" title={m.error_detail ?? undefined}>
                      Falhou
                    </span>
                  ) : (
                    <span className="text-xs text-warning">Pendente</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loading}>
            {loading ? 'Carregando...' : 'Carregar mais'}
          </Button>
        </div>
      )}
    </div>
  )
}
