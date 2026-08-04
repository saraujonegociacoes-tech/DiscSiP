'use server'

import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import type { Profile } from '@/lib/types/database'

// Perfil do usuário autenticado (a partir da sessão em cookies). null se não logado.
//
// Custo: esta função está no caminho de TODA tela (a Sidebar a chama para hidratar o store)
// e de 8 páginas server-side. Duas otimizações, ambas sem mudar o retorno:
//
//  1. DEDUPE POR REQUEST (React.cache). /projects/[projectId] chama no layout E na page —
//     eram dois ciclos completos de ida ao Supabase para responder a mesma pergunta. cache()
//     é escopado à requisição, então não há risco de servir o perfil de outro usuário.
//
//  2. UMA IDA EM VEZ DE DUAS para perfil+departamento. O department_slug era resolvido numa
//     2ª query sequencial; agora vem no embed da FK profiles→departments (o mesmo embed que
//     o middleware já usa em produção para os gates por vertical, então a FK está exposta no
//     PostgREST). O fallback para a query separada continua ali: se o embed vier vazio com
//     department_id preenchido, refaz do jeito antigo — o comportamento é idêntico mesmo se
//     o schema cache do PostgREST estiver frio.
type ProfileWithDept = Profile & { departments?: { slug: string | null } | { slug: string | null }[] | null }

const loadCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  // Se o embed falhar (FK não exposta / schema cache frio → PGRST200), o erro derruba a query
  // INTEIRA, e devolver null aqui faria o app tratar um usuário logado como deslogado — falha
  // muito pior que a ida extra ao banco que o embed economiza. Por isso o retry sem embed.
  const embed = await supabase
    .from('profiles')
    .select('*, departments(slug)')
    .eq('id', user.id)
    .single()

  let data = embed.data
  const error = embed.error

  if (error) {
    console.error('[auth] perfil com embed de departamento falhou, refazendo sem embed:', error.message)
    ;({ data } = await supabase.from('profiles').select('*').eq('id', user.id).single())
  }

  const row = (data as ProfileWithDept | null) ?? null
  if (!row) return null

  // Separa o embed do perfil: o resto do app espera o shape de `Profile`, com o slug plano.
  const { departments, ...profile } = row
  const embedded = Array.isArray(departments) ? departments[0] : departments
  const typed = profile as Profile

  if (!typed.department_id) return typed

  if (embedded?.slug != null) {
    typed.department_slug = embedded.slug
    return typed
  }

  // Embed indisponível (schema cache frio / FK não exposta) → caminho antigo, 2ª query.
  const { data: department } = await supabase
    .from('departments')
    .select('slug')
    .eq('id', typed.department_id)
    .single()

  typed.department_slug = department?.slug ?? null
  return typed
})

export async function getCurrentProfile(): Promise<Profile | null> {
  return loadCurrentProfile()
}

export async function signOut(): Promise<void> {
  const supabase = await createServerClient()
  await supabase.auth.signOut()
  redirect('/login')
}
