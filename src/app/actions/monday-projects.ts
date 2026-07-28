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
  MondayMemberRole,
  MondayAssignableUser,
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

  // Resolve o dono de cada projeto (p/ agrupar por pessoa na lista).
  const ownerIds = [...new Set(list.map((p) => p.owner_id))]
  let owners: MondayMemberProfile[] = []
  if (ownerIds.length) {
    const { data: rows } = await supabase
      .from('profiles')
      .select('id, name, email')
      .in('id', ownerIds)
    owners = (rows ?? []) as MondayMemberProfile[]
  }
  const ownerById = new Map(owners.map((o) => [o.id, o]))

  return list.map((p) => ({
    ...p,
    overview: byId.get(p.id) ?? null,
    owner: ownerById.get(p.owner_id) ?? null,
  }))
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

/** Usuarios (aprovados) que podem ser adicionados a um projeto — via RPC SECURITY
 *  DEFINER (so responde para a gerencia; a filtragem de quem ja e membro e no app). */
export async function getAssignableUsers(): Promise<MondayAssignableUser[]> {
  const supabase = await createServerClient()
  const { data } = await supabase.rpc('monday_assignable_users')
  return (data ?? []) as MondayAssignableUser[]
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

  // Gera o id no app em vez de usar .select()/RETURNING. A policy de SELECT de
  // monday_projects exige is_monday_project_member(id), mas a associação do dono só
  // é criada pelo trigger AFTER INSERT (handle_new_monday_project) — que ainda NÃO é
  // visível na cláusula RETURNING, fazendo o insert().select() estourar RLS. Sem
  // RETURNING, vale só o WITH CHECK (owner_id = auth.uid()), que passa.
  const id = crypto.randomUUID()
  const { error } = await supabase
    .from('monday_projects')
    .insert({ id, name, key, description, color, owner_id: user.id })
  if (error) return { error: error.message }

  // Board padrão (a associação de membro do dono já existe via trigger)
  const { error: boardError } = await supabase
    .from('monday_boards')
    .insert({ project_id: id, name: 'Board principal' })
  if (boardError) return { error: boardError.message }

  revalidatePath('/projects')
  return { id }
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

// ─── Membros do projeto ───────────────────────────────────────────────────────
// A RLS (can_manage_monday_project) ja garante que so o dono/admin do projeto — ou
// a gerencia — consegue inserir/alterar/remover. O papel 'owner' e exclusivo do
// criador (trigger handle_new_monday_project) e nunca e atribuido/alterado pela UI.

type MemberMutation = { members?: MondayMemberWithProfile[]; error?: string }

const ASSIGNABLE_MEMBER_ROLES: MondayMemberRole[] = ['admin', 'member', 'viewer']

/** Adiciona (ou reajusta o papel de) uma pessoa no projeto. */
export async function addProjectMember(
  projectId: string,
  userId: string,
  role: MondayMemberRole = 'member',
): Promise<MemberMutation> {
  if (!ASSIGNABLE_MEMBER_ROLES.includes(role)) return { error: 'Papel inválido.' }

  const supabase = await createServerClient()
  const { error } = await supabase
    .from('monday_project_members')
    .upsert({ project_id: projectId, user_id: userId, role }, { onConflict: 'project_id,user_id' })
  if (error) return { error: error.message }

  revalidatePath(`/projects/${projectId}`)
  return { members: await getProjectMembers(projectId) }
}

/** Altera o papel de um membro (nunca para/do dono). */
export async function updateProjectMemberRole(
  projectId: string,
  userId: string,
  role: MondayMemberRole,
): Promise<MemberMutation> {
  if (!ASSIGNABLE_MEMBER_ROLES.includes(role)) return { error: 'Papel inválido.' }

  const supabase = await createServerClient()
  // .neq('role','owner') impede rebaixar o dono; role='owner' nunca e alvo (guard acima).
  const { error } = await supabase
    .from('monday_project_members')
    .update({ role })
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .neq('role', 'owner')
  if (error) return { error: error.message }

  revalidatePath(`/projects/${projectId}`)
  return { members: await getProjectMembers(projectId) }
}

/** Remove uma pessoa do projeto — o dono e protegido pelo .neq('role','owner'). */
export async function removeProjectMember(
  projectId: string,
  userId: string,
): Promise<MemberMutation> {
  const supabase = await createServerClient()
  const { error } = await supabase
    .from('monday_project_members')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .neq('role', 'owner')
  if (error) return { error: error.message }

  revalidatePath(`/projects/${projectId}`)
  return { members: await getProjectMembers(projectId) }
}
