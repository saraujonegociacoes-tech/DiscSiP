import { cn } from '@/lib/utils'
import type { AgentActivity } from '@/app/actions/supervisor'

// Resultado da última ligação do dia (métrica secundária, ao lado da contagem)
const STATUS_LABEL: Record<string, string> = {
  answered: 'Atendeu',
  no_answer: 'Não atendeu',
  busy: 'Ocupado',
  failed: 'Falhou',
}

const STATUS_COLOR: Record<string, string> = {
  answered: 'text-success',
  no_answer: 'text-warning',
  busy: 'text-warning',
  failed: 'text-destructive',
}

// Presença em tempo real: o que mostrar pela bolinha + rótulo. 'offline' = sem heartbeat
// recente; online + running = discando; paused = pausado; idle/completed = ocioso (logado,
// fora de discagem).
type PresenceKey = 'offline' | 'running' | 'paused' | 'idle'

const PRESENCE: Record<PresenceKey, { label: string; dot: string; text: string }> = {
  running: { label: 'Discando', dot: 'bg-success shadow-glow animate-pulse', text: 'text-success' },
  paused: { label: 'Pausado', dot: 'bg-warning', text: 'text-warning' },
  idle: { label: 'Ocioso', dot: 'bg-primary', text: 'text-primary' },
  offline: { label: 'Offline', dot: 'bg-muted-foreground', text: 'text-muted-foreground' },
}

function presenceKey(a: AgentActivity): PresenceKey {
  if (!a.online) return 'offline'
  if (a.dialerStatus === 'running') return 'running'
  if (a.dialerStatus === 'paused') return 'paused'
  return 'idle'
}

interface AgentListProps {
  agents: AgentActivity[]
}

export function AgentList({ agents }: AgentListProps) {
  const online = agents.filter((a) => a.online)

  return (
    <div className="relative h-full overflow-hidden rounded-2xl border border-border bg-gradient-card p-5 shadow-elevated">
      <div className="pointer-events-none absolute -bottom-16 -right-10 h-44 w-44 rounded-full bg-success/15 blur-3xl" />
      <h2 className="text-sm font-semibold text-foreground">
        Agentes online{' '}
        <span className="font-normal text-muted-foreground">
          ({online.length}/{agents.length})
        </span>
      </h2>
      <div className="mt-4 space-y-2">
        {agents.map((a) => {
          const p = PRESENCE[presenceKey(a)]
          return (
            <div
              key={a.agentId}
              className="flex items-center justify-between rounded-xl border border-border bg-background/40 px-3 py-2.5 transition-colors hover:bg-accent/40"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className={cn('h-2 w-2 shrink-0 rounded-full', p.dot)} />
                <span className="truncate text-sm text-foreground">{a.name}</span>
                <span className="text-xs text-muted-foreground">#{a.extension}</span>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-right">
                <span className={cn('text-xs font-medium', p.text)}>{p.label}</span>
                <span className="text-xs text-muted-foreground">{a.callsToday} chamadas</span>
                {a.lastStatus && (
                  <span className={cn('text-xs', STATUS_COLOR[a.lastStatus] ?? 'text-muted-foreground')}>
                    {STATUS_LABEL[a.lastStatus] ?? a.lastStatus}
                  </span>
                )}
              </div>
            </div>
          )
        })}
        {agents.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">Nenhum agente cadastrado</p>
        )}
      </div>
    </div>
  )
}
