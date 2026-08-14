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

/**
 * Atualiza a descricao do projeto. A RLS (can_manage_monday_project) so permite
 * dono/admin do projeto ou a gerencia; um update sem permissao volta 0 linhas e
 * nenhum erro, entao usamos .select() p/ detectar isso (mesmo padrao do delete).
 */
export async function updateProjectDescription(
  projectId: string,
  description: string,
): Promise<{ description?: string | null; error?: string }> {
  const supabase = await createServerClient()
  const trimmed = description.trim()
  const value = trimmed.length ? trimmed : null

  const { data, error } = await supabase
    .from('monday_projects')
    .update({ description: value })
    .eq('id', projectId)
    .select('id, description')
  if (error) return { error: error.message }
  if (!data || data.length === 0) {
    return { error: 'Sem permissão para editar este projeto.' }
  }

  revalidatePath(`/projects/${projectId}`)
  return { description: (data[0] as { description: string | null }).description }
}

/**
 * Renomeia o projeto. Mesma RLS (can_manage_monday_project) e deteccao de "0 linhas"
 * da descricao. Revalida tambem a lista, onde o nome aparece nos cards.
 */
export async function updateProjectName(
  projectId: string,
  name: string,
): Promise<{ name?: string; error?: string }> {
  const trimmed = name.trim()
  if (!trimmed) return { error: 'Nome obrigatório.' }

  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('monday_projects')
    .update({ name: trimmed })
    .eq('id', projectId)
    .select('id, name')
  if (error) return { error: error.message }
  if (!data || data.length === 0) {
    return { error: 'Sem permissão para editar este projeto.' }
  }

  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/projects')
  return { name: (data[0] as { name: string }).name }
}

/**
 * Passa o projeto para outra pessoa.
 *
 * Duas coisas precisam andar JUNTAS: a coluna `monday_projects.owner_id` (o que
 * agrupa a lista por dono) e o papel 'owner' em `monday_project_members` — porque a
 * policy `monday_projects_delete` olha o PAPEL (`monday_project_role(id) = 'owner'`),
 * nao a coluna. Mexer so na coluna deixaria o dono antigo ainda podendo apagar tudo.
 *
 * O dono antigo vira 'admin': continua com acesso total e pode devolver o projeto
 * (`can_manage_monday_project` cobre owner E admin) — o "vice-versa" do pedido.
 *
 * Sem migration: as tres escritas ja sao permitidas pelas policies existentes.
 */
export async function transferProject(
  projectId: string,
  newOwnerId: string,
): Promise<{ error?: string; warning?: string }> {
  const supabase = await createServerClient()

  // 1) A troca da coluna e o portao de permissao (RLS can_manage_monday_project).
  //    Sem permissao o update volta 0 linhas e nenhum erro — mesmo padrao do rename.
  //    Vindo primeiro, uma recusa nao deixa nenhum papel alterado para tras.
  const { data, error } = await supabase
    .from('monday_projects')
    .update({ owner_id: newOwnerId })
    .eq('id', projectId)
    .select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) {
    return { error: 'Sem permissão para transferir este projeto.' }
  }

  // 2) e 3) tocam linhas diferentes da mesma tabela (a do novo dono / as dos demais),
  //    entao vao em paralelo — uma ida ao banco em vez de duas.
  const [{ error: promoteError }, { error: demoteError }] = await Promise.all([
    // Novo dono vira membro 'owner'. upsert porque ele pode ainda nao ser membro.
    supabase
      .from('monday_project_members')
      .upsert(
        { project_id: projectId, user_id: newOwnerId, role: 'owner' },
        { onConflict: 'project_id,user_id' },
      ),
    // Quem era 'owner' vira 'admin'. O predicado dispensa ler antes quem era o dono.
    supabase
      .from('monday_project_members')
      .update({ role: 'admin' })
      .eq('project_id', projectId)
      .eq('role', 'owner')
      .neq('user_id', newOwnerId),
  ])

  revalidatePath('/projects')
  revalidatePath(`/projects/${projectId}`)

  // Sem transacao, os papeis podem ficar a meio caminho. Refazer a transferencia e
  // idempotente (os tres passos convergem), entao o aviso pede exatamente isso.
  const failed = promoteError ?? demoteError
  if (failed) {
    return {
      warning: `Projeto transferido, mas os papéis ficaram inconsistentes (${failed.message}). Refaça a transferência.`,
    }
  }
  return {}
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
 * A RLS de delete permite a GERÊNCIA (manager/admin) ou o DONO (ver migration
 * 20260729_monday_project_delete_gerencia.sql); um delete sem permissão volta 0
 * linhas e nenhum erro, então usamos .select() p/ detectar isso.
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
    return { error: 'Sem permissão para excluir este projeto.' }
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
