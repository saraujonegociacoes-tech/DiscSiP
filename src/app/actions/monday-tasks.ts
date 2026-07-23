'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import type { MondayTask, MondayTaskStatus, MondayTaskPriority } from '@/lib/monday/types'

export type CreateTaskInput = {
  projectId: string
  board_id: string
  group_id?: string | null
  sprint_id?: string | null
  title: string
  description?: string | null
  status?: MondayTaskStatus
  priority?: MondayTaskPriority
  assignee_id?: string | null
  estimate?: number | null
  due_date?: string | null
}

export type MondayTaskPatch = Partial<
  Pick<
    MondayTask,
    | 'title'
    | 'description'
    | 'status'
    | 'priority'
    | 'assignee_id'
    | 'estimate'
    | 'due_date'
    | 'start_date'
    | 'group_id'
    | 'sprint_id'
    | 'position'
    | 'archived'
  >
>

export async function createTask(input: CreateTaskInput): Promise<{ id?: string; error?: string }> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const title = input.title.trim()
  if (!title) return { error: 'Título obrigatório.' }

  const { data, error } = await supabase
    .from('monday_tasks')
    .insert({
      board_id: input.board_id,
      group_id: input.group_id ?? null,
      sprint_id: input.sprint_id ?? null,
      title,
      description: input.description ?? null,
      status: input.status ?? 'todo',
      priority: input.priority ?? 'medium',
      assignee_id: input.assignee_id ?? null,
      estimate: input.estimate ?? null,
      due_date: input.due_date ?? null,
      created_by: user.id,
      position: Date.now(),
    })
    .select('id')
    .single()
  if (error || !data) return { error: error?.message ?? 'Falha ao criar tarefa.' }

  revalidatePath(`/projects/${input.projectId}`)
  return { id: data.id as string }
}

export async function updateTask(
  taskId: string,
  patch: MondayTaskPatch,
  projectId: string,
): Promise<{ error?: string }> {
  const supabase = await createServerClient()
  const { error } = await supabase.from('monday_tasks').update(patch).eq('id', taskId)
  if (error) return { error: error.message }

  revalidatePath(`/projects/${projectId}`)
  return {}
}

/** Move usado no drag-and-drop: muda status/grupo/posicao. */
export async function moveTask(
  taskId: string,
  patch: { status?: MondayTaskStatus; group_id?: string | null; position?: number },
  projectId: string,
): Promise<{ error?: string }> {
  const supabase = await createServerClient()
  const { error } = await supabase.from('monday_tasks').update(patch).eq('id', taskId)
  if (error) return { error: error.message }

  revalidatePath(`/projects/${projectId}`)
  return {}
}

export async function deleteTask(taskId: string, projectId: string): Promise<{ error?: string }> {
  const supabase = await createServerClient()
  const { error } = await supabase.from('monday_tasks').delete().eq('id', taskId)
  if (error) return { error: error.message }

  revalidatePath(`/projects/${projectId}`)
  return {}
}

export async function setTaskSprint(
  taskId: string,
  sprintId: string | null,
  projectId: string,
): Promise<{ error?: string }> {
  const supabase = await createServerClient()
  const { error } = await supabase
    .from('monday_tasks')
    .update({ sprint_id: sprintId })
    .eq('id', taskId)
  if (error) return { error: error.message }

  revalidatePath(`/projects/${projectId}`)
  return {}
}
