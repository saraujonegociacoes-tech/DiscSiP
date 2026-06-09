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
    return <p className="text-slate-500 text-sm text-center py-8">Carregando...</p>
  }

  if (logs.length === 0) {
    return (
      <p className="text-slate-500 text-sm text-center py-8">
        Nenhuma chamada registrada ainda.
      </p>
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
