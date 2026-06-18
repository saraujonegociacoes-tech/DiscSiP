import { cn } from '@/lib/utils'
import type { AgentActivity } from '@/app/actions/supervisor'

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

interface AgentListProps {
  agents: AgentActivity[]
}

export function AgentList({ agents }: AgentListProps) {
  const active = agents.filter((a) => a.callsToday > 0)

  return (
    <div className="relative h-full overflow-hidden rounded-2xl border border-border bg-gradient-card p-5 shadow-elevated">
      <div className="pointer-events-none absolute -bottom-16 -right-10 h-44 w-44 rounded-full bg-success/15 blur-3xl" />
      <h2 className="text-sm font-semibold text-foreground">
        Agentes ativos hoje{' '}
        <span className="font-normal text-muted-foreground">
          ({active.length}/{agents.length})
        </span>
      </h2>
      <div className="mt-4 space-y-2">
        {agents.map((a) => (
          <div
            key={a.agentId}
            className="flex items-center justify-between rounded-xl border border-border bg-background/40 px-3 py-2.5 transition-colors hover:bg-accent/40"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  a.callsToday > 0 ? 'bg-success' : 'bg-muted-foreground'
                )}
              />
              <span className="truncate text-sm text-foreground">{a.name}</span>
              <span className="text-xs text-muted-foreground">#{a.extension}</span>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-right">
              <span className="text-xs text-muted-foreground">{a.callsToday} chamadas</span>
              {a.lastStatus && (
                <span className={cn('text-xs', STATUS_COLOR[a.lastStatus] ?? 'text-muted-foreground')}>
                  {STATUS_LABEL[a.lastStatus] ?? a.lastStatus}
                </span>
              )}
            </div>
          </div>
        ))}
        {agents.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">Nenhum agente cadastrado</p>
        )}
      </div>
    </div>
  )
}
