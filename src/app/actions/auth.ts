'use server'

import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import type { Profile } from '@/lib/types/database'

// Perfil do usuário autenticado (a partir da sessão em cookies). null se não logado.
// Resolve department_slug à parte (2ª query, só se houver department_id) em vez de
// embed/FK do PostgREST — mesma cautela já usada no histórico de chamadas do supervisor.
export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  const profile = (data as Profile | null) ?? null
  if (!profile?.department_id) return profile

  const { data: department } = await supabase
    .from('departments')
    .select('slug')
    .eq('id', profile.department_id)
    .single()

  profile.department_slug = department?.slug ?? null
  return profile
}

export async function signOut(): Promise<void> {
  const supabase = await createServerClient()
  await supabase.auth.signOut()
  redirect('/login')
}
