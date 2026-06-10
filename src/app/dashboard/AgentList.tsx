import type { AgentActivity } from '@/app/actions/supervisor'

const STATUS_LABEL: Record<string, string> = {
  answered: 'Atendeu',
  no_answer: 'Não atendeu',
  busy: 'Ocupado',
  failed: 'Falhou',
}

const STATUS_COLOR: Record<string, string> = {
  answered: 'text-green-400',
  no_answer: 'text-yellow-400',
  busy: 'text-orange-400',
  failed: 'text-red-400',
}

interface AgentListProps {
  agents: AgentActivity[]
}

export function AgentList({ agents }: AgentListProps) {
  const active = agents.filter((a) => a.callsToday > 0)

  return (
    <div className="bg-[#1e293b] rounded-xl p-5">
      <h2 className="text-white text-sm font-medium mb-4">
        Agentes ativos hoje{' '}
        <span className="text-slate-500 font-normal">({active.length}/{agents.length})</span>
      </h2>
      <div className="space-y-2">
        {agents.map((a) => (
          <div
            key={a.agentId}
            className="flex items-center justify-between py-2 border-b border-slate-700/50 last:border-0"
          >
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${a.callsToday > 0 ? 'bg-green-400' : 'bg-slate-600'}`}
              />
              <span className="text-white text-sm">{a.name}</span>
              <span className="text-slate-500 text-xs">#{a.extension}</span>
            </div>
            <div className="flex items-center gap-3 text-right">
              <span className="text-slate-400 text-xs">{a.callsToday} chamadas</span>
              {a.lastStatus && (
                <span className={`text-xs ${STATUS_COLOR[a.lastStatus] ?? 'text-slate-400'}`}>
                  {STATUS_LABEL[a.lastStatus] ?? a.lastStatus}
                </span>
              )}
            </div>
          </div>
        ))}
        {agents.length === 0 && (
          <p className="text-slate-500 text-sm text-center py-4">Nenhum agente cadastrado</p>
        )}
      </div>
    </div>
  )
}
