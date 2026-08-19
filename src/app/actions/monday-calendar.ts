'use server'

import { createServerClient } from '@/lib/supabase/server'
import { QUICK_PSEUDO_PROJECT } from '@/lib/monday/domain'
import { assigneeNameFrom, resolveProfiles, resolveProjects } from '@/lib/monday/task-joins'
import type { CalendarTaskItem, MondayQuickTask, MondayTask } from '@/lib/monday/types'

type TaskRow = Pick<
  MondayTask,
  'id' | 'title' | 'status' | 'priority' | 'due_date' | 'assignee_id' | 'board_id'
>
type QuickRow = Pick<
  MondayQuickTask,
  'id' | 'title' | 'status' | 'priority' | 'due_date' | 'assignee_id'
>

const TASK_COLS = 'id, title, status, priority, due_date, assignee_id, board_id'
const QUICK_COLS = 'id, title, status, priority, due_date, assignee_id'

/**
 * Todas as tarefas com prazo (due_date) dos projetos que o usuario acessa (RLS de
 * monday_tasks) MAIS as tarefas rapidas com prazo (RLS de monday_quick_tasks).
 * Alimenta a visao de calendario de entregas — o agrupamento por dia e a navegacao
 * entre meses acontecem no cliente (o due_date e uma data pura, sem fuso).
 *
 * A tarefa rapida nao tem projeto: entra com o QUICK_PSEUDO_PROJECT e pula o
 * caminho board -> projeto, entao a integracao custa 1 index scan e nenhum join.
 */
export async function getDeliveryCalendar(): Promise<{ tasks: CalendarTaskItem[] }> {
  const supabase = await createServerClient()

  const [taskRes, quickRes] = await Promise.all([
    supabase
      .from('monday_tasks')
      .select(TASK_COLS)
      .eq('archived', false)
      .not('due_date', 'is', null),
    supabase
      .from('monday_quick_tasks')
      .select(QUICK_COLS)
      .eq('archived', false)
      .not('due_date', 'is', null),
  ])

  const tasks = (taskRes.data ?? []) as TaskRow[]
  const quickTasks = (quickRes.data ?? []) as QuickRow[]
  if (!tasks.length && !quickTasks.length) return { tasks: [] }

  const { boardToProject, projectById } = await resolveProjects(supabase, tasks)
  const profileById = await resolveProfiles(supabase, [...tasks, ...quickTasks])

  const items: CalendarTaskItem[] = []

  for (const t of tasks) {
    if (!t.due_date) continue
    const projectId = boardToProject.get(t.board_id)
    const project = projectId ? projectById.get(projectId) : undefined
    if (!project) continue // projeto fora do alcance (RLS) — ignora

    items.push({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      due_date: t.due_date,
      projectId: project.id,
      projectName: project.name,
      projectKey: project.key,
      projectColor: project.color,
      assigneeId: t.assignee_id,
      assigneeName: assigneeNameFrom(profileById, t.assignee_id),
    })
  }

  for (const t of quickTasks) {
    if (!t.due_date) continue
    items.push({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      due_date: t.due_date,
      projectId: QUICK_PSEUDO_PROJECT.id,
      projectName: QUICK_PSEUDO_PROJECT.name,
      projectKey: QUICK_PSEUDO_PROJECT.key,
      projectColor: QUICK_PSEUDO_PROJECT.color,
      assigneeId: t.assignee_id,
      assigneeName: assigneeNameFrom(profileById, t.assignee_id),
    })
  }

  return { tasks: items }
}
