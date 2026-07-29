'use server'

import { createServerClient } from '@/lib/supabase/server'
import type {
  CalendarTaskItem,
  MondayMemberProfile,
  MondayProject,
  MondayTask,
} from '@/lib/monday/types'

type TaskRow = Pick<
  MondayTask,
  'id' | 'title' | 'status' | 'priority' | 'due_date' | 'assignee_id' | 'board_id'
>
type ProjectRow = Pick<MondayProject, 'id' | 'name' | 'key' | 'color'>

const TASK_COLS = 'id, title, status, priority, due_date, assignee_id, board_id'

/**
 * Todas as tarefas com prazo (due_date) dos projetos que o usuario acessa (RLS de
 * monday_tasks). Alimenta a visao de calendario de entregas — o agrupamento por dia
 * e a navegacao entre meses acontecem no cliente (o due_date e uma data pura, sem fuso).
 */
export async function getDeliveryCalendar(): Promise<{ tasks: CalendarTaskItem[] }> {
  const supabase = await createServerClient()

  const { data: taskData } = await supabase
    .from('monday_tasks')
    .select(TASK_COLS)
    .eq('archived', false)
    .not('due_date', 'is', null)

  const tasks = (taskData ?? []) as TaskRow[]
  if (!tasks.length) return { tasks: [] }

  // board -> projeto
  const boardIds = [...new Set(tasks.map((t) => t.board_id))]
  const { data: boards } = await supabase
    .from('monday_boards')
    .select('id, project_id')
    .in('id', boardIds)
  const boardToProject = new Map(
    ((boards ?? []) as { id: string; project_id: string }[]).map((b) => [b.id, b.project_id]),
  )

  const projectIds = [...new Set([...boardToProject.values()])]
  const { data: projects } = await supabase
    .from('monday_projects')
    .select('id, name, key, color')
    .in('id', projectIds)
  const projectById = new Map(((projects ?? []) as ProjectRow[]).map((p) => [p.id, p]))

  // responsaveis
  const assigneeIds = [...new Set(tasks.map((t) => t.assignee_id).filter(Boolean))] as string[]
  let profiles: MondayMemberProfile[] = []
  if (assigneeIds.length) {
    const { data } = await supabase
      .from('profiles')
      .select('id, name, email')
      .in('id', assigneeIds)
    profiles = (data ?? []) as MondayMemberProfile[]
  }
  const profileById = new Map(profiles.map((p) => [p.id, p]))

  const items: CalendarTaskItem[] = []
  for (const t of tasks) {
    if (!t.due_date) continue
    const projectId = boardToProject.get(t.board_id)
    const project = projectId ? projectById.get(projectId) : undefined
    if (!project) continue // projeto fora do alcance (RLS) — ignora

    const person = t.assignee_id ? profileById.get(t.assignee_id) ?? null : null
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
      assigneeName: person?.name ?? person?.email ?? null,
    })
  }

  return { tasks: items }
}
