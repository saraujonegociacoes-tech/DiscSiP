import type { createServerClient } from '@/lib/supabase/server'
import type { MondayMemberProfile, MondayProject } from '@/lib/monday/types'

/**
 * Os dois "joins" que a Daily, o Historico e o Calendario fazem em JS.
 *
 * Nao ficam nos arquivos de action porque um modulo `'use server'` so pode
 * exportar funcoes async que viram endpoint — e estes sao helpers internos, nao
 * pontos de entrada. Antes existiam copiados nos dois arquivos.
 */

export type MondayProjectRow = Pick<MondayProject, 'id' | 'name' | 'key' | 'color'>

type SupabaseServerClient = Awaited<ReturnType<typeof createServerClient>>

/**
 * Resolve board -> projeto para um lote de tarefas de projeto.
 *
 * As tarefas rapidas NAO passam por aqui: elas nao tem board nem projeto, e sao
 * mapeadas direto para o QUICK_PSEUDO_PROJECT (zero join a mais na tela).
 */
export async function resolveProjects(
  supabase: SupabaseServerClient,
  tasks: { board_id: string }[],
): Promise<{
  boardToProject: Map<string, string>
  projectById: Map<string, MondayProjectRow>
}> {
  const boardToProject = new Map<string, string>()
  const projectById = new Map<string, MondayProjectRow>()

  const boardIds = [...new Set(tasks.map((t) => t.board_id))]
  if (!boardIds.length) return { boardToProject, projectById }

  const { data: boards } = await supabase
    .from('monday_boards')
    .select('id, project_id')
    .in('id', boardIds)
  for (const b of (boards ?? []) as { id: string; project_id: string }[]) {
    boardToProject.set(b.id, b.project_id)
  }

  const projectIds = [...new Set([...boardToProject.values()])]
  if (!projectIds.length) return { boardToProject, projectById }

  const { data: projects } = await supabase
    .from('monday_projects')
    .select('id, name, key, color')
    .in('id', projectIds)
  for (const p of (projects ?? []) as MondayProjectRow[]) projectById.set(p.id, p)

  return { boardToProject, projectById }
}

/**
 * Profiles dos responsaveis de qualquer mistura de tarefas, em UMA consulta —
 * os ids das tarefas de projeto e das rapidas entram no mesmo `in()`.
 */
export async function resolveProfiles(
  supabase: SupabaseServerClient,
  rows: { assignee_id: string | null }[],
): Promise<Map<string, MondayMemberProfile>> {
  const assigneeIds = [...new Set(rows.map((r) => r.assignee_id).filter(Boolean))] as string[]
  if (!assigneeIds.length) return new Map()

  const { data } = await supabase.from('profiles').select('id, name, email').in('id', assigneeIds)
  return new Map(((data ?? []) as MondayMemberProfile[]).map((p) => [p.id, p]))
}

/** Nome de exibicao do responsavel a partir do mapa de profiles. */
export function assigneeNameFrom(
  profileById: Map<string, MondayMemberProfile>,
  assigneeId: string | null,
): string | null {
  const person = assigneeId ? (profileById.get(assigneeId) ?? null) : null
  return person?.name ?? person?.email ?? null
}
