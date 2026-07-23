'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import type {
  MondaySprint,
  MondaySprintStats,
  MondaySprintStatus,
  MondaySprintWithStats,
  MondayBurndownPoint,
} from '@/lib/monday/types'

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

export type CreateSprintInput = {
  projectId: string
  name: string
  goal?: string | null
  start_date?: string | null
  end_date?: string | null
  status?: MondaySprintStatus
}

export async function createSprint(input: CreateSprintInput): Promise<{ id?: string; error?: string }> {
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

  revalidatePath(`/projects/${input.projectId}`)
  return { id: data.id as string }
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
