'use server'

import { createServerClient } from '@/lib/supabase/server'
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
