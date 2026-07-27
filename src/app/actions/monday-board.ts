'use server'

import { createServerClient } from '@/lib/supabase/server'
import type {
  MondayBoard,
  MondayBoardData,
  MondayGroup,
  MondayMemberProfile,
  MondayTag,
  MondayTask,
  MondayTaskLastComment,
} from '@/lib/monday/types'

/** Board primario de um projeto + grupos + tasks (com tags). */
export async function getPrimaryBoardData(projectId: string): Promise<MondayBoardData> {
  const empty: MondayBoardData = { board: null, groups: [], tasks: [] }
  const supabase = await createServerClient()

  const { data: board } = await supabase
    .from('monday_boards')
    .select('*')
    .eq('project_id', projectId)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!board) return empty

  const b = board as MondayBoard
  const [{ data: groups }, { data: tasks }] = await Promise.all([
    supabase
      .from('monday_groups')
      .select('*')
      .eq('board_id', b.id)
      .order('position', { ascending: true }),
    supabase
      .from('monday_tasks')
      .select('*')
      .eq('board_id', b.id)
      .eq('archived', false)
      .order('position', { ascending: true }),
  ])

  const taskList = (tasks ?? []) as MondayTask[]
  const taskIds = taskList.map((t) => t.id)
  const [tagsByTask, lastCommentByTask] = await Promise.all([
    getTagsForTasks(projectId, taskIds),
    getLastCommentsForTasks(taskIds),
  ])

  return {
    board: b,
    groups: (groups ?? []) as MondayGroup[],
    tasks: taskList.map((t) => ({
      ...t,
      tags: tagsByTask.get(t.id) ?? [],
      lastComment: lastCommentByTask.get(t.id) ?? null,
    })),
  }
}

/** Ultimo comentario de cada tarefa (via view) com o nome do autor resolvido. */
async function getLastCommentsForTasks(
  taskIds: string[],
): Promise<Map<string, MondayTaskLastComment>> {
  const map = new Map<string, MondayTaskLastComment>()
  if (!taskIds.length) return map
  const supabase = await createServerClient()

  const { data } = await supabase
    .from('monday_task_last_comment')
    .select('*')
    .in('task_id', taskIds)

  type LastRow = Omit<MondayTaskLastComment, 'author_name'>
  const rows = (data ?? []) as LastRow[]
  if (!rows.length) return map

  const authorIds = [...new Set(rows.map((r) => r.author_id).filter(Boolean))] as string[]
  let profiles: MondayMemberProfile[] = []
  if (authorIds.length) {
    const { data: p } = await supabase
      .from('profiles')
      .select('id, name, email')
      .in('id', authorIds)
    profiles = (p ?? []) as MondayMemberProfile[]
  }
  const nameById = new Map(profiles.map((p) => [p.id, p.name || p.email]))

  for (const r of rows) {
    map.set(r.task_id, {
      ...r,
      author_name: r.author_id ? nameById.get(r.author_id) ?? null : null,
    })
  }
  return map
}

async function getTagsForTasks(
  projectId: string,
  taskIds: string[],
): Promise<Map<string, MondayTag[]>> {
  const map = new Map<string, MondayTag[]>()
  if (!taskIds.length) return map
  const supabase = await createServerClient()

  const [{ data: links }, { data: tags }] = await Promise.all([
    supabase.from('monday_task_tags').select('*').in('task_id', taskIds),
    supabase.from('monday_tags').select('*').eq('project_id', projectId),
  ])
  const tagById = new Map(((tags ?? []) as MondayTag[]).map((t) => [t.id, t]))
  for (const link of (links ?? []) as { task_id: string; tag_id: string }[]) {
    const tag = tagById.get(link.tag_id)
    if (!tag) continue
    const arr = map.get(link.task_id) ?? []
    arr.push(tag)
    map.set(link.task_id, arr)
  }
  return map
}
