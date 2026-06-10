'use client'

import { useEffect, useState } from 'react'
import { getCallHistory } from '@/app/actions/dialer'
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

const STATUS_COLOR: Record<string, string> = {
  answered: 'text-green-400',
  no_answer: 'text-yellow-400',
  busy: 'text-orange-400',
  failed: 'text-red-400',
}

const DIRECTION_ICON: Record<string, string> = {
  inbound: '↙',
  outbound: '↗',
}

export function CallHistory({ agentId }: CallHistoryProps) {
  const [logs, setLogs] = useState<CallLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getCallHistory(agentId).then((data) => {
      setLogs(data)
      setLoading(false)
    })
  }, [agentId])

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="flex items-center gap-3 bg-[#1e293b] border border-slate-800 rounded-xl px-4 py-3 animate-pulse"
          >
            <div className="w-4 h-4 bg-slate-700 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-28 bg-slate-700 rounded-full" />
              <div className="h-2.5 w-20 bg-slate-800 rounded-full" />
            </div>
            <div className="space-y-2 text-right">
              <div className="h-3 w-16 bg-slate-700 rounded-full" />
              <div className="h-2.5 w-10 bg-slate-800 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center py-10 gap-3">
        <span className="text-4xl opacity-20">📞</span>
        <p className="text-slate-400 text-sm font-medium">Nenhuma chamada registrada</p>
        <p className="text-slate-600 text-xs text-center max-w-xs">
          O histórico aparece aqui após a primeira chamada discada.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {logs.map((log) => (
        <div
          key={log.id}
          className="flex items-center gap-3 bg-[#1e293b] border border-slate-800 rounded-xl px-4 py-3"
        >
          <span className="text-slate-500 text-sm w-4 shrink-0">
            {DIRECTION_ICON[log.direction]}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-mono truncate">{log.phone_number}</p>
            <p className="text-slate-500 text-xs mt-0.5">{formatDate(log.created_at)}</p>
          </div>
          <div className="text-right shrink-0">
            <p className={`text-xs font-medium ${STATUS_COLOR[log.status]}`}>
              {STATUS_LABEL[log.status]}
            </p>
            <p className="text-slate-500 text-xs mt-0.5">{formatDuration(log.duration_seconds)}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
