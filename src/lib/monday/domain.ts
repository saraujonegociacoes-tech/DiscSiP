import type {
  MondayTaskStatus,
  MondayTaskPriority,
  MondaySprintStatus,
  MondayProjectOverview,
} from '@/lib/monday/types'

export const STATUS_META: Record<
  MondayTaskStatus,
  { label: string; bg: string; fg: string; dot: string }
> = {
  todo: { label: 'A fazer', bg: 'bg-status-todo', fg: 'text-status-todo-foreground', dot: 'bg-status-todo' },
  working: { label: 'Fazendo', bg: 'bg-status-working', fg: 'text-status-working-foreground', dot: 'bg-status-working' },
  review: { label: 'Revisão', bg: 'bg-status-review', fg: 'text-status-review-foreground', dot: 'bg-status-review' },
  done: { label: 'Feito', bg: 'bg-status-done', fg: 'text-status-done-foreground', dot: 'bg-status-done' },
  stuck: { label: 'Travado', bg: 'bg-status-stuck', fg: 'text-status-stuck-foreground', dot: 'bg-status-stuck' },
}

export const STATUS_ORDER: MondayTaskStatus[] = ['todo', 'working', 'review', 'done', 'stuck']

export const PRIORITY_META: Record<
  MondayTaskPriority,
  { label: string; text: string; dot: string }
> = {
  low: { label: 'Baixa', text: 'text-priority-low', dot: 'bg-priority-low' },
  medium: { label: 'Média', text: 'text-priority-medium', dot: 'bg-priority-medium' },
  high: { label: 'Alta', text: 'text-priority-high', dot: 'bg-priority-high' },
  critical: { label: 'Crítica', text: 'text-priority-critical', dot: 'bg-priority-critical' },
}

export const PRIORITY_ORDER: MondayTaskPriority[] = ['low', 'medium', 'high', 'critical']

export const SPRINT_STATUS_META: Record<
  MondaySprintStatus,
  { label: string; className: string }
> = {
  planned: { label: 'Planejado', className: 'bg-muted text-muted-foreground' },
  active: { label: 'Ativo', className: 'bg-status-done/15 text-status-done' },
  completed: { label: 'Concluído', className: 'bg-status-todo/15 text-muted-foreground' },
}

/**
 * Horario (HH:mm) de um instante ISO no fuso America/Sao_Paulo. As telas Daily/
 * Historico sao Server Components (renderizam no runtime em UTC); formatar com
 * date-fns usaria o fuso do servidor e mostraria 3h a mais. Convertemos explicitamente.
 */
export function formatBrtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

/**
 * Projeto "concluido": tem tarefas e todas ja estao em `done`. Projeto vazio (sem
 * tarefa nenhuma) nao conta como concluido — senao um projeto recem-criado nasceria
 * escondido pelo filtro "Ocultar concluidos".
 */
export function isProjectDone(overview: MondayProjectOverview | null | undefined): boolean {
  const total = overview?.total_tasks ?? 0
  return total > 0 && (overview?.done_tasks ?? 0) >= total
}

/** Iniciais para avatar a partir de um nome/email. */
export function initials(name?: string | null, email?: string | null): string {
  const src = (name ?? email ?? '?').trim()
  const parts = src.split(/[\s@.]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

/**
 * "Projeto" sintetico das tarefas rapidas. A Daily, o Calendario e o Historico
 * mostram tudo agrupado por projeto; como a tarefa rapida nao tem projeto nenhum,
 * esses campos sao preenchidos com esta constante — em JS, sem query alguma
 * (a tarefa rapida pula todo o caminho board -> projeto).
 */
export const QUICK_PSEUDO_PROJECT = {
  id: '__quick__',
  name: 'Tarefas rápidas',
  key: 'RÁPIDA',
  color: '#00C2A8',
} as const

/**
 * Categorias distintas de uma lista de tarefas rapidas, ja ordenadas.
 *
 * Derivar da lista que a pagina JA carregou substitui uma segunda consulta ao
 * banco: as duas varriam a mesma tabela sob a mesma RLS, e a segunda so existia
 * para fazer um `distinct` que o JS resolve em uma passada.
 */
export function quickTaskCategories(tasks: { category: string | null }[]): string[] {
  const set = new Set<string>()
  for (const t of tasks) {
    const c = t.category?.trim()
    if (c) set.add(c)
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}
