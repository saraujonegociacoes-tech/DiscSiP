'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { setTaskSprint } from '@/app/actions/monday-tasks'
import { StatusBadge } from '@/components/monday/status-badge'
import { PriorityBadge } from '@/components/monday/priority-badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { MondayTaskWithTags } from '@/lib/monday/types'

type SprintOption = { id: string; name: string }
const NO_SPRINT = '__backlog__'

export function BacklogTable({
  projectId,
  tasks,
  sprints,
}: {
  projectId: string
  tasks: MondayTaskWithTags[]
  sprints: SprintOption[]
}) {
  const [pending, startTransition] = useTransition()

  function assign(taskId: string, value: string) {
    const sprintId = value === NO_SPRINT ? null : value
    startTransition(async () => {
      const res = await setTaskSprint(taskId, sprintId, projectId)
      if (!res.error) toast.success('Sprint atualizado')
      else toast.error(res.error)
    })
  }

  if (tasks.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
        Nenhuma tarefa no board.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Tarefa</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Prioridade</th>
            <th className="px-4 py-2 font-medium">Pts</th>
            <th className="px-4 py-2 font-medium">Sprint</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {tasks.map((t) => (
            <tr key={t.id} className="hover:bg-muted/30">
              <td className="max-w-xs truncate px-4 py-2.5 font-medium">{t.title}</td>
              <td className="px-4 py-2.5">
                <StatusBadge status={t.status} />
              </td>
              <td className="px-4 py-2.5">
                <PriorityBadge priority={t.priority} />
              </td>
              <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{t.estimate ?? '—'}</td>
              <td className="px-4 py-2.5">
                <Select
                  defaultValue={t.sprint_id ?? NO_SPRINT}
                  onValueChange={(v) => assign(t.id, v)}
                  disabled={pending}
                >
                  <SelectTrigger className="h-8 w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SPRINT}>Backlog</SelectItem>
                    {sprints.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
