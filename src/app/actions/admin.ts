'use server'

import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import type { Profile, Role } from '@/lib/types/database'

// Papéis atribuíveis pelo admin. Espelha ROLE_OPTIONS de src/app/admin/AdminClient.tsx —
// as duas listas precisam andar juntas (esta valida no servidor, a de lá popula o select).
const ROLES: Role[] = ['pending', 'agent', 'supervisor', 'manager', 'admin', 'ceo', 'tester']

// ─── Usuários ────────────────────────────────────────────────────────────────

export async function getProfiles(): Promise<Profile[]> {
  const supabase = await createServerClient()
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: true })
  return (data ?? []) as Profile[]
}

export async function updateProfile(
  id: string,
  patch: { role: Role; department_id: string | null; extension: number | null }
): Promise<{ error?: string }> {
  if (!ROLES.includes(patch.role)) {
    return { error: 'Papel inválido.' }
  }
  if (patch.extension !== null && (patch.extension < 5125 || patch.extension > 5150)) {
    return { error: 'Ramal deve estar entre 5125 e 5150.' }
  }

  const supabase = await createServerClient()
  const { error } = await supabase
    .from('profiles')
    .update({
      role: patch.role,
      department_id: patch.department_id,
      extension: patch.extension,
    })
    .eq('id', id)
  if (error) return { error: error.message }
  return {}
}

// ─── Exclusão de usuário ─────────────────────────────────────────────────────
//
// Excluir de verdade é apagar de `auth.users` — não adianta só apagar o profile: o
// login continuaria funcionando e o trigger `handle_new_user` nem recriaria o perfil
// (ele só dispara no INSERT do cadastro), deixando um usuário logado e invisível.
// E `auth.users` não é acessível pela sessão do usuário; exige a Admin API com a
// service_role. Daí o createServiceClient() aqui — a checagem de permissão passa a ser
// responsabilidade DESTE código, e é o que requireAdmin() faz antes de qualquer coisa.

// Quem pode administrar: mesma régua do banco, onde current_profile_role() mapeia
// 'tester' → 'admin' (20260807_tester_rls_effective_role.sql). Não faria sentido barrar
// o tester só aqui: ele já edita papéis por updateProfile() e poderia se auto-promover
// a admin em dois cliques — a trava seria teatro, não segurança.
async function requireAdmin(): Promise<{ id: string } | { error: string }> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Sessão expirada. Entre novamente.' }

  const { data } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const role = (data as { role?: Role } | null)?.role
  if (role !== 'admin' && role !== 'tester') {
    return { error: 'Apenas administradores podem excluir usuários.' }
  }
  return { id: user.id }
}

export interface DeletionPreview {
  name: string
  email: string | null
  // Projetos em que a pessoa ainda é DONA. Enquanto houver qualquer um, a exclusão é
  // recusada (FK RESTRICT + a checagem abaixo): apagar o dono levaria junto boards,
  // tarefas, sprints e comentários de todo mundo que trabalha no projeto.
  ownedProjects: string[]
  // Vai junto: a lista pessoal de tarefas rápidas dela (FK CASCADE, sem dono nulo possível).
  quickTasks: number
  // Fica: o autor vira nulo, a linha permanece (FK SET NULL).
  callLogs: number
  assignedTasks: number
}

// Levantamento do impacto, para o admin confirmar sabendo o que perde e o que fica.
// Roda com a service_role de propósito: as contagens precisam ser as REAIS, e sob RLS
// as tarefas rápidas de outra pessoa simplesmente não apareceriam — o diálogo mostraria
// "0 tarefas rápidas" e apagaria várias.
export async function getDeletionPreview(
  id: string
): Promise<{ preview?: DeletionPreview; error?: string }> {
  const admin = await requireAdmin()
  if ('error' in admin) return { error: admin.error }

  const service = createServiceClient()

  const { data: profile } = await service
    .from('profiles')
    .select('name, email')
    .eq('id', id)
    .single()
  if (!profile) return { error: 'Usuário não encontrado.' }

  const countOf = async (table: string, column: string) => {
    const { count } = await service
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq(column, id)
    return count ?? 0
  }

  // Arquivados entram na lista: o RESTRICT não liga para a flag `archived`.
  const [{ data: owned }, quickTasks, callLogs, assignedTasks] = await Promise.all([
    service.from('monday_projects').select('name').eq('owner_id', id).order('name'),
    countOf('monday_quick_tasks', 'owner_id'),
    countOf('call_logs', 'agent_id'),
    countOf('monday_tasks', 'assignee_id'),
  ])

  return {
    preview: {
      name: (profile as { name: string }).name,
      email: (profile as { email: string | null }).email,
      ownedProjects: ((owned ?? []) as { name: string }[]).map((p) => p.name),
      quickTasks,
      callLogs,
      assignedTasks,
    },
  }
}

export async function deleteUser(id: string): Promise<{ error?: string }> {
  const admin = await requireAdmin()
  if ('error' in admin) return { error: admin.error }

  // Excluir a si mesmo derrubaria a própria sessão no meio da ação e, se fosse o último
  // admin, deixaria o /admin sem ninguém que consiga entrar.
  if (admin.id === id) {
    return { error: 'Você não pode excluir a própria conta por aqui.' }
  }

  const service = createServiceClient()

  // Checagem antes de chamar a Admin API só para dar uma mensagem em português: sem ela,
  // o RESTRICT da FK devolveria um erro cru do Postgres embrulhado pelo GoTrue.
  const { data: owned } = await service
    .from('monday_projects')
    .select('name')
    .eq('owner_id', id)
    .order('name')

  const ownedNames = ((owned ?? []) as { name: string }[]).map((p) => p.name)
  if (ownedNames.length > 0) {
    const lista = ownedNames.slice(0, 3).join(', ')
    const resto = ownedNames.length > 3 ? ` e mais ${ownedNames.length - 3}` : ''
    return {
      error: `Ainda é dono de ${ownedNames.length} projeto(s): ${lista}${resto}. Transfira a propriedade antes de excluir.`,
    }
  }

  const { error } = await service.auth.admin.deleteUser(id)
  if (error) return { error: error.message }
  return {}
}

// ─── Departamentos ────────────────────────────────────────────────────────────

export async function createDepartment(name: string): Promise<{ error?: string }> {
  const trimmed = name.trim()
  if (!trimmed) return { error: 'Informe um nome.' }

  const supabase = await createServerClient()
  const { error } = await supabase.from('departments').insert({ name: trimmed })
  if (error) {
    return { error: error.code === '23505' ? 'Já existe um departamento com esse nome.' : error.message }
  }
  return {}
}

export async function updateDepartment(id: string, name: string): Promise<{ error?: string }> {
  const trimmed = name.trim()
  if (!trimmed) return { error: 'Informe um nome.' }

  const supabase = await createServerClient()
  const { error } = await supabase.from('departments').update({ name: trimmed }).eq('id', id)
  if (error) {
    return { error: error.code === '23505' ? 'Já existe um departamento com esse nome.' : error.message }
  }
  return {}
}

// Remover um depto desvincula campanhas/perfis (FK ON DELETE SET NULL)
export async function deleteDepartment(id: string): Promise<{ error?: string }> {
  const supabase = await createServerClient()
  const { error } = await supabase.from('departments').delete().eq('id', id)
  if (error) return { error: error.message }
  return {}
}
