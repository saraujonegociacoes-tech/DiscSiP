'use client'

import { CalendarClock } from 'lucide-react'
import { format, isPast, isToday, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { PRIORITY_META, initials } from '@/lib/monday/domain'
import type { MondayTaskWithTags } from '@/lib/monday/types'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

export function TaskCard({
  task,
  memberLabel,
  onClick,
}: {
  task: MondayTaskWithTags
  memberLabel: Map<string, string>
  onClick?: () => void
}) {
  const prio = PRIORITY_META[task.priority]
  const assigneeName = task.assignee_id ? memberLabel.get(task.assignee_id) : null

  const due = task.due_date ? parseISO(task.due_date) : null
  const overdue = due ? isPast(due) && !isToday(due) && task.status !== 'done' : false

  return (
    <div
      onClick={onClick}
      className="cursor-pointer rounded-lg border bg-card p-3 shadow-xs transition-shadow hover:shadow-md"
    >
      {task.tags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {task.tags.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
              style={{ backgroundColor: tag.color }}
            >
              {tag.name}
            </span>
          ))}
        </div>
      )}

      <p className="text-sm font-medium leading-snug">{task.title}</p>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs" title={`Prioridade: ${prio.label}`}>
            <span className={cn('size-2 rounded-full', prio.dot)} />
          </span>
          {task.estimate != null && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {task.estimate} pts
            </span>
          )}
          {due && (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-[10px]',
                overdue ? 'font-medium text-status-stuck' : 'text-muted-foreground',
              )}
            >
              <CalendarClock className="size-3" />
              {format(due, 'dd MMM', { locale: ptBR })}
            </span>
          )}
        </div>

        {assigneeName && (
          <Avatar className="size-6">
            <AvatarFallback className="text-[10px]">{initials(assigneeName)}</AvatarFallback>
          </Avatar>
        )}
      </div>
    </div>
  )
}
