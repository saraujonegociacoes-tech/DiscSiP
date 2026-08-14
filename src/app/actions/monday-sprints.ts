'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import type {
  MondaySprint,
  MondaySprintStats,
  MondaySprintStatus,
  MondaySprintWithStats,
  MondayBurndownPoint,
  MondayTaskPriority,
} from '@/lib/monday/types'

type ServerClient = Awaited<ReturnType<typeof createServerClient>>

// ─── Leitura ────────────────────────────────────────────────────────────────

export async function getSprintsWithStats(projectId: string): Promise<MondaySprintWithStats[]> {
  const supabase = await createServerClient()

  const [{ data: sprints }, { data: stats }] = await Promise.all([
    supabase
      .from('monday_sprints')
      .select('*')
      .eq('project_id', projectId)
      .order('position', { ascending: true }),
    supabase.from('monday_sprint_stats').select('*').eq('project_id', projectId),
  ])

  const list = (sprints ?? []) as MondaySprint[]
  const byId = new Map(((stats ?? []) as MondaySprintStats[]).map((s) => [s.sprint_id, s]))
  return list.map((s) => ({ ...s, stats: byId.get(s.id) ?? null }))
}

/** Burndown calculado no banco (RPC). */
export async function getBurndown(sprintId: string): Promise<MondayBurndownPoint[]> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('monday_sprint_burndown', { p_sprint: sprintId })
  if (error || !data) return []
  return data as MondayBurndownPoint[]
}

// ─── Mutacao ────────────────────────────────────────────────────────────────

/**
 * Subtarefa informada na criacao do sprint. Vira uma tarefa normal do board — os
 * campos sao os mesmos de `CreateTaskInput`, menos o `status` (sempre "Fazendo").
 */
export type CreateSprintSubtask = {
  title: string
  description?: string | null
  priority?: MondayTaskPriority
  assignee_id?: string | null
  estimate?: number | null
  due_date?: string | null
}

export type CreateSprintInput = {
  projectId: string
  name: string
  goal?: string | null
  start_date?: string | null
  end_date?: string | null
  status?: MondaySprintStatus
  /** Criadas junto com o sprint, ja na fase "Fazendo" do board. */
  subtasks?: CreateSprintSubtask[]
}

export async function createSprint(
  input: CreateSprintInput,
): Promise<{ id?: string; error?: string; warning?: string }> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const name = input.name.trim()
  if (!name) return { error: 'Nome obrigatório.' }

  const { data, error } = await supabase
    .from('monday_sprints')
    .insert({
      project_id: input.projectId,
      name,
      goal: input.goal ?? null,
      start_date: input.start_date ?? null,
      end_date: input.end_date ?? null,
      status: input.status ?? 'planned',
      position: Date.now(),
    })
    .select('id')
    .single()
  if (error || !data) return { error: error?.message ?? 'Falha ao criar sprint.' }

  const sprintId = data.id as string
  const warning = await insertSprintSubtasks(
    supabase,
    input.projectId,
    sprintId,
    user.id,
    input.subtasks ?? [],
  )

  // O sprint aparece em /sprints; as subtarefas, no board — revalida os dois.
  revalidatePath(`/projects/${input.projectId}`)
  revalidatePath(`/projects/${input.projectId}/sprints`)
  return { id: sprintId, warning }
}

/**
 * Grava as subtarefas de um sprint recem-criado como tarefas do board primario
 * (o de menor `position`, mesmo criterio de `getPrimaryBoardData`), todas na fase
 * "Fazendo" e ligadas ao sprint — num unico INSERT, nao um por linha.
 *
 * Falhar aqui NAO invalida o sprint, que ja esta gravado: devolve um aviso em vez de
 * um erro, senao o usuario acharia que nada foi criado e tentaria de novo (duplicando).
 */
async function insertSprintSubtasks(
  supabase: ServerClient,
  projectId: string,
  sprintId: string,
  userId: string,
  subtasks: CreateSprintSubtask[],
): Promise<string | undefined> {
  const rows = subtasks.filter((s) => s.title.trim())
  if (!rows.length) return

  const { data: board } = await supabase
    .from('monday_boards')
    .select('id')
    .eq('project_id', projectId)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!board) return 'Sprint criado, mas o projeto não tem board para receber as subtarefas.'

  const now = Date.now()
  const { error } = await supabase.from('monday_tasks').insert(
    rows.map((s, i) => ({
      board_id: board.id as string,
      sprint_id: sprintId,
      title: s.title.trim(),
      description: s.description ?? null,
      status: 'working',
      priority: s.priority ?? 'medium',
      assignee_id: s.assignee_id ?? null,
      estimate: s.estimate ?? null,
      due_date: s.due_date ?? null,
      created_by: userId,
      // now + i preserva a ordem em que o usuario digitou as subtarefas.
      position: now + i,
    })),
  )
  return error ? `Sprint criado, mas as subtarefas falharam: ${error.message}` : undefined
}

export async function updateSprintStatus(
  sprintId: string,
  status: MondaySprintStatus,
  projectId: string,
): Promise<{ error?: string }> {
  const supabase = await createServerClient()
  const { error } = await supabase.from('monday_sprints').update({ status }).eq('id', sprintId)
  if (error) return { error: error.message }

  revalidatePath(`/projects/${projectId}`)
  return {}
}

export type UpdateSprintPatch = Partial<
  Pick<MondaySprint, 'name' | 'goal' | 'status' | 'start_date' | 'end_date'>
>

export async function updateSprint(
  sprintId: string,
  patch: UpdateSprintPatch,
  projectId: string,
): Promise<{ error?: string }> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) return { error: 'Nome obrigatório.' }
    patch = { ...patch, name }
  }

  const { error } = await supabase.from('monday_sprints').update(patch).eq('id', sprintId)
  if (error) return { error: error.message }

  revalidatePath(`/projects/${projectId}`)
  return {}
}

/**
 * Apaga um sprint. As tarefas vinculadas voltam ao backlog automaticamente
 * (FK `monday_tasks.sprint_id` é `on delete set null`), então nenhuma tarefa
 * é perdida.
 */
export async function deleteSprint(
  sprintId: string,
  projectId: string,
): Promise<{ error?: string }> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const { error } = await supabase.from('monday_sprints').delete().eq('id', sprintId)
  if (error) return { error: error.message }

  revalidatePath(`/projects/${projectId}`)
  return {}
}
