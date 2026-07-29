'use server'

import { createServerClient } from '@/lib/supabase/server'
import { PRIORITY_ORDER } from '@/lib/monday/domain'
import type {
  DailyPersonGroup,
  DailyReport,
  DailyTaskItem,
  HistoryDay,
  HistoryReport,
  HistoryTaskItem,
  MondayMemberProfile,
  MondayProject,
  MondayTask,
} from '@/lib/monday/types'

const TZ = 'America/Sao_Paulo'

/** Dia local (America/Sao_Paulo) no formato YYYY-MM-DD. */
function brtDate(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: TZ })
}

type TaskRow = Pick<
  MondayTask,
  'id' | 'title' | 'status' | 'priority' | 'due_date' | 'completed_at' | 'assignee_id' | 'board_id'
>
type ProjectRow = Pick<MondayProject, 'id' | 'name' | 'key' | 'color'>

const NO_ASSIGNEE = '__none__'
const TASK_COLS = 'id, title, status, priority, due_date, completed_at, assignee_id, board_id'

function personLabel(p: MondayMemberProfile | null): string {
  return p?.name || p?.email || 'Sem responsável'
}

/**
 * Resumo diario por responsavel, cruzando todos os projetos que o usuario acessa
 * (RLS de monday_tasks). "Feito hoje/ontem" = tarefas concluidas (completed_at) no
 * dia, no fuso BRT; "a entregar" = tarefas abertas (nao concluidas).
 */
export async function getDailyReport(): Promise<DailyReport> {
  const supabase = await createServerClient()

  const todayBRT = brtDate(new Date())
  const yesterdayBRT = brtDate(new Date(Date.now() - 24 * 60 * 60 * 1000))
  // Limite folgado p/ concluidas (48h cobre "ontem" em qualquer fuso); bucket exato em JS.
  const sinceIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  const [openRes, doneRes] = await Promise.all([
    supabase
      .from('monday_tasks')
      .select(TASK_COLS)
      .eq('archived', false)
      .neq('status', 'done'),
    supabase
      .from('monday_tasks')
      .select(TASK_COLS)
      .eq('archived', false)
      .eq('status', 'done')
      .gte('completed_at', sinceIso),
  ])

  const tasks = [
    ...((openRes.data ?? []) as TaskRow[]),
    ...((doneRes.data ?? []) as TaskRow[]),
  ]
  if (!tasks.length) return { groups: [] }

  // board -> projeto
  const boardIds = [...new Set(tasks.map((t) => t.board_id))]
  const { data: boards } = await supabase
    .from('monday_boards')
    .select('id, project_id')
    .in('id', boardIds)
  const boardToProject = new Map(
    ((boards ?? []) as { id: string; project_id: string }[]).map((b) => [b.id, b.project_id]),
  )

  const projectIds = [...new Set([...boardToProject.values()])]
  const { data: projects } = await supabase
    .from('monday_projects')
    .select('id, name, key, color')
    .in('id', projectIds)
  const projectById = new Map(((projects ?? []) as ProjectRow[]).map((p) => [p.id, p]))

  // responsaveis
  const assigneeIds = [...new Set(tasks.map((t) => t.assignee_id).filter(Boolean))] as string[]
  let profiles: MondayMemberProfile[] = []
  if (assigneeIds.length) {
    const { data } = await supabase
      .from('profiles')
      .select('id, name, email')
      .in('id', assigneeIds)
    profiles = (data ?? []) as MondayMemberProfile[]
  }
  const profileById = new Map(profiles.map((p) => [p.id, p]))

  // Agrupa por responsavel, jogando cada tarefa no balde certo.
  const groupsById = new Map<string, DailyPersonGroup>()
  function groupFor(assigneeId: string | null): DailyPersonGroup {
    const key = assigneeId ?? NO_ASSIGNEE
    let g = groupsById.get(key)
    if (!g) {
      g = {
        assigneeId,
        person: assigneeId ? profileById.get(assigneeId) ?? null : null,
        doneToday: [],
        doneYesterday: [],
        toDeliver: [],
      }
      groupsById.set(key, g)
    }
    return g
  }

  for (const t of tasks) {
    const projectId = boardToProject.get(t.board_id)
    const project = projectId ? projectById.get(projectId) : undefined
    if (!project) continue // projeto fora do alcance (RLS) — ignora

    const item: DailyTaskItem = {
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      due_date: t.due_date,
      completed_at: t.completed_at,
      overdue: t.status !== 'done' && !!t.due_date && t.due_date < todayBRT,
      projectId: project.id,
      projectName: project.name,
      projectKey: project.key,
      projectColor: project.color,
    }

    const g = groupFor(t.assignee_id)
    if (t.status === 'done') {
      if (!t.completed_at) continue
      const day = brtDate(new Date(t.completed_at))
      if (day === todayBRT) g.doneToday.push(item)
      else if (day === yesterdayBRT) g.doneYesterday.push(item)
      // concluida em outro dia -> ignora
    } else {
      g.toDeliver.push(item)
    }
  }

  const byCompletedDesc = (a: DailyTaskItem, b: DailyTaskItem) =>
    (b.completed_at ?? '').localeCompare(a.completed_at ?? '')

  const byDeliver = (a: DailyTaskItem, b: DailyTaskItem) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1 // atrasadas primeiro
    if (a.due_date !== b.due_date) {
      if (!a.due_date) return 1 // sem prazo por ultimo
      if (!b.due_date) return -1
      return a.due_date.localeCompare(b.due_date) // prazo mais proximo primeiro
    }
    return PRIORITY_ORDER.indexOf(b.priority) - PRIORITY_ORDER.indexOf(a.priority) // maior prioridade
  }

  const groups = [...groupsById.values()]
    .filter((g) => g.doneToday.length + g.doneYesterday.length + g.toDeliver.length > 0)
    .map((g) => ({
      ...g,
      doneToday: g.doneToday.sort(byCompletedDesc),
      doneYesterday: g.doneYesterday.sort(byCompletedDesc),
      toDeliver: g.toDeliver.sort(byDeliver),
    }))
    .sort((a, b) => {
      // pessoas por nome; "Sem responsavel" por ultimo
      const an = a.assigneeId ? personLabel(a.person) : '￿'
      const bn = b.assigneeId ? personLabel(b.person) : '￿'
      return an.localeCompare(bn, 'pt-BR')
    })

  return { groups }
}

const HISTORY_LIMIT = 500
const HISTORY_TASK_COLS =
  'id, title, status, priority, due_date, completed_at, assignee_id, board_id'

/**
 * Timeline de TODAS as tarefas concluidas (nao arquivadas) dos projetos que o
 * usuario acessa (RLS), da mais recente p/ a mais antiga, agrupadas por dia (BRT).
 * Limitada a HISTORY_LIMIT p/ nao pesar; `capped` avisa quando ha mais alem disso.
 */
export async function getCompletedHistory(): Promise<HistoryReport> {
  const supabase = await createServerClient()

  const { data: doneData } = await supabase
    .from('monday_tasks')
    .select(HISTORY_TASK_COLS)
    .eq('archived', false)
    .eq('status', 'done')
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(HISTORY_LIMIT)

  const tasks = (doneData ?? []) as TaskRow[]
  if (!tasks.length) return { days: [], total: 0, capped: false }

  // board -> projeto
  const boardIds = [...new Set(tasks.map((t) => t.board_id))]
  const { data: boards } = await supabase
    .from('monday_boards')
    .select('id, project_id')
    .in('id', boardIds)
  const boardToProject = new Map(
    ((boards ?? []) as { id: string; project_id: string }[]).map((b) => [b.id, b.project_id]),
  )

  const projectIds = [...new Set([...boardToProject.values()])]
  const { data: projects } = await supabase
    .from('monday_projects')
    .select('id, name, key, color')
    .in('id', projectIds)
  const projectById = new Map(((projects ?? []) as ProjectRow[]).map((p) => [p.id, p]))

  // responsaveis
  const assigneeIds = [...new Set(tasks.map((t) => t.assignee_id).filter(Boolean))] as string[]
  let profiles: MondayMemberProfile[] = []
  if (assigneeIds.length) {
    const { data } = await supabase
      .from('profiles')
      .select('id, name, email')
      .in('id', assigneeIds)
    profiles = (data ?? []) as MondayMemberProfile[]
  }
  const profileById = new Map(profiles.map((p) => [p.id, p]))

  // Agrupa por dia BRT preservando a ordem desc (tasks ja vem ordenada por completed_at).
  const dayOrder: string[] = []
  const byDay = new Map<string, HistoryTaskItem[]>()
  let total = 0

  for (const t of tasks) {
    if (!t.completed_at) continue
    const projectId = boardToProject.get(t.board_id)
    const project = projectId ? projectById.get(projectId) : undefined
    if (!project) continue // projeto fora do alcance (RLS) — ignora

    const person = t.assignee_id ? profileById.get(t.assignee_id) ?? null : null
    const item: HistoryTaskItem = {
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      due_date: t.due_date,
      completed_at: t.completed_at,
      overdue: false,
      projectId: project.id,
      projectName: project.name,
      projectKey: project.key,
      projectColor: project.color,
      assigneeName: person?.name ?? person?.email ?? null,
    }

    const day = brtDate(new Date(t.completed_at))
    let list = byDay.get(day)
    if (!list) {
      list = []
      byDay.set(day, list)
      dayOrder.push(day)
    }
    list.push(item)
    total++
  }

  const days: HistoryDay[] = dayOrder.map((day) => ({ day, items: byDay.get(day)! }))
  return { days, total, capped: tasks.length >= HISTORY_LIMIT }
}
