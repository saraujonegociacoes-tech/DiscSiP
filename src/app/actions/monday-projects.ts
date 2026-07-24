'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import type {
  MondayProject,
  MondayProjectOverview,
  MondayProjectWithStats,
  MondayProjectMember,
  MondayMemberProfile,
  MondayMemberWithProfile,
} from '@/lib/monday/types'

// ─── Leitura ────────────────────────────────────────────────────────────────

/** Projetos do usuario (RLS por membership) + estatisticas agregadas (view). */
export async function getProjectsWithStats(): Promise<MondayProjectWithStats[]> {
  const supabase = await createServerClient()

  const [{ data: projects }, { data: overviews }] = await Promise.all([
    supabase
      .from('monday_projects')
      .select('*')
      .eq('archived', false)
      .order('created_at', { ascending: true }),
    supabase.from('monday_project_overview').select('*'),
  ])

  const list = (projects ?? []) as MondayProject[]
  const byId = new Map(((overviews ?? []) as MondayProjectOverview[]).map((o) => [o.project_id, o]))
  return list.map((p) => ({ ...p, overview: byId.get(p.id) ?? null }))
}

export async function getProject(projectId: string): Promise<MondayProject | null> {
  const supabase = await createServerClient()
  const { data } = await supabase
    .from('monday_projects')
    .select('*')
    .eq('id', projectId)
    .maybeSingle()
  return (data as MondayProject | null) ?? null
}

export async function getProjectMembers(projectId: string): Promise<MondayMemberWithProfile[]> {
  const supabase = await createServerClient()
  const { data: members } = await supabase
    .from('monday_project_members')
    .select('*')
    .eq('project_id', projectId)

  const list = (members ?? []) as MondayProjectMember[]
  if (!list.length) return []

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, name, email')
    .in('id', list.map((m) => m.user_id))

  const byId = new Map(((profiles ?? []) as MondayMemberProfile[]).map((p) => [p.id, p]))
  return list.map((m) => ({ ...m, profile: byId.get(m.user_id) ?? null }))
}

// ─── Mutacao ────────────────────────────────────────────────────────────────

export async function createProject(
  formData: FormData,
): Promise<{ id?: string; error?: string }> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const name = String(formData.get('name') ?? '').trim()
  const key = String(formData.get('key') ?? '').trim().toUpperCase()
  const description = String(formData.get('description') ?? '').trim() || null
  const color = String(formData.get('color') ?? '#3B82F6')

  if (!name) return { error: 'Nome obrigatório.' }
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) {
    return { error: 'Chave inválida (ex: BL, DEV, APP).' }
  }

  const { data, error } = await supabase
    .from('monday_projects')
    .insert({ name, key, description, color, owner_id: user.id })
    .select('id')
    .single()
  if (error || !data) return { error: error?.message ?? 'Falha ao criar projeto.' }

  // Board padrao do projeto
  await supabase.from('monday_boards').insert({ project_id: data.id, name: 'Board principal' })

  revalidatePath('/projects')
  return { id: data.id as string }
}

export async function seedDemo(): Promise<{ id?: string; error?: string }> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const { data, error } = await supabase.rpc('monday_seed_demo')
  if (error) return { error: error.message }

  revalidatePath('/projects')
  return { id: data as string }
}

export async function archiveProject(projectId: string): Promise<{ error?: string }> {
  const supabase = await createServerClient()
  const { error } = await supabase
    .from('monday_projects')
    .update({ archived: true })
    .eq('id', projectId)
  if (error) return { error: error.message }

  revalidatePath('/projects')
  return {}
}

/**
 * Apaga o projeto DE VEZ. As FKs monday_* usam ON DELETE CASCADE (members, boards,
 * groups, sprints, tasks, tags, task_tags), então tudo some junto — sem erro de FK.
 * A RLS de delete só permite o DONO (monday_project_role = 'owner'); um delete sem
 * permissão volta 0 linhas e nenhum erro, então usamos .select() p/ detectar isso.
 */
export async function deleteProject(projectId: string): Promise<{ error?: string }> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const { data, error } = await supabase
    .from('monday_projects')
    .delete()
    .eq('id', projectId)
    .select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) {
    return { error: 'Apenas o dono do projeto pode apagá-lo.' }
  }

  revalidatePath('/projects')
  return {}
}
