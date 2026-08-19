'use server'

import { createServerClient } from '@/lib/supabase/server'
import { PRIORITY_ORDER, QUICK_PSEUDO_PROJECT } from '@/lib/monday/domain'
import { assigneeNameFrom, resolveProfiles, resolveProjects } from '@/lib/monday/task-joins'
import type {
  DailyPersonGroup,
  DailyReport,
  DailyTaskItem,
  HistoryDay,
  HistoryReport,
  HistoryTaskItem,
  MondayMemberProfile,
  MondayQuickTask,
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
type QuickRow = Pick<
  MondayQuickTask,
  'id' | 'title' | 'status' | 'priority' | 'due_date' | 'completed_at' | 'assignee_id'
>

const NO_ASSIGNEE = '__none__'
const TASK_COLS = 'id, title, status, priority, due_date, completed_at, assignee_id, board_id'
const QUICK_COLS = 'id, title, status, priority, due_date, completed_at, assignee_id'

function personLabel(p: MondayMemberProfile | null): string {
  return p?.name || p?.email || 'Sem responsável'
}

/**
 * Resumo diario por responsavel, cruzando todos os projetos que o usuario acessa
 * (RLS de monday_tasks) e tambem as tarefas rapidas (RLS de monday_quick_tasks).
 * "Feito hoje/ontem" = tarefas concluidas (completed_at) no dia, no fuso BRT;
 * "a entregar" = tarefas abertas (nao concluidas).
 */
export async function getDailyReport(): Promise<DailyReport> {
  const supabase = await createServerClient()

  const todayBRT = brtDate(new Date())
  const yesterdayBRT = brtDate(new Date(Date.now() - 24 * 60 * 60 * 1000))
  // Limite folgado p/ concluidas (48h cobre "ontem" em qualquer fuso); bucket exato em JS.
  const sinceIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  const [openRes, doneRes, quickOpenRes, quickDoneRes] = await Promise.all([
    supabase.from('monday_tasks').select(TASK_COLS).eq('archived', false).neq('status', 'done'),
    supabase
      .from('monday_tasks')
      .select(TASK_COLS)
      .eq('archived', false)
      .eq('status', 'done')
      .gte('completed_at', sinceIso),
    supabase
      .from('monday_quick_tasks')
      .select(QUICK_COLS)
      .eq('archived', false)
      .neq('status', 'done'),
    supabase
      .from('monday_quick_tasks')
      .select(QUICK_COLS)
      .eq('archived', false)
      .eq('status', 'done')
      .gte('completed_at', sinceIso),
  ])

  const tasks = [...((openRes.data ?? []) as TaskRow[]), ...((doneRes.data ?? []) as TaskRow[])]
  const quickTasks = [
    ...((quickOpenRes.data ?? []) as QuickRow[]),
    ...((quickDoneRes.data ?? []) as QuickRow[]),
  ]
  if (!tasks.length && !quickTasks.length) return { groups: [] }

  const { boardToProject, projectById } = await resolveProjects(supabase, tasks)
  const profileById = await resolveProfiles(supabase, [...tasks, ...quickTasks])

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

  function place(item: DailyTaskItem, assigneeId: string | null) {
    const g = groupFor(assigneeId)
    if (item.status === 'done') {
      if (!item.completed_at) return
      const day = brtDate(new Date(item.completed_at))
      if (day === todayBRT) g.doneToday.push(item)
      else if (day === yesterdayBRT) g.doneYesterday.push(item)
      // concluida em outro dia -> ignora
    } else {
      g.toDeliver.push(item)
    }
  }

  for (const t of tasks) {
    const projectId = boardToProject.get(t.board_id)
    const project = projectId ? projectById.get(projectId) : undefined
    if (!project) continue // projeto fora do alcance (RLS) — ignora

    place(
      {
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
      },
      t.assignee_id,
    )
  }

  for (const t of quickTasks) {
    place(
      {
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        due_date: t.due_date,
        completed_at: t.completed_at,
        overdue: t.status !== 'done' && !!t.due_date && t.due_date < todayBRT,
        projectId: QUICK_PSEUDO_PROJECT.id,
        projectName: QUICK_PSEUDO_PROJECT.name,
        projectKey: QUICK_PSEUDO_PROJECT.key,
        projectColor: QUICK_PSEUDO_PROJECT.color,
      },
      t.assignee_id,
    )
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

  // "Sem responsavel" vai por ultimo: U+FFFF ordena depois de qualquer nome real.
  const LAST = '￿'

  const groups = [...groupsById.values()]
    .filter((g) => g.doneToday.length + g.doneYesterday.length + g.toDeliver.length > 0)
    .map((g) => ({
      ...g,
      doneToday: g.doneToday.sort(byCompletedDesc),
      doneYesterday: g.doneYesterday.sort(byCompletedDesc),
      toDeliver: g.toDeliver.sort(byDeliver),
    }))
    .sort((a, b) => {
      const an = a.assigneeId ? personLabel(a.person) : LAST
      const bn = b.assigneeId ? personLabel(b.person) : LAST
      return an.localeCompare(bn, 'pt-BR')
    })

  return { groups }
}

const HISTORY_LIMIT = 500

/**
 * Timeline de TODAS as tarefas concluidas (nao arquivadas) — de projeto e rapidas —
 * da mais recente p/ a mais antiga, agrupadas por dia (BRT). Cada consulta pega no
 * maximo HISTORY_LIMIT; o corte final e aplicado depois do merge, e `capped` avisa
 * quando ha mais alem disso.
 */
export async function getCompletedHistory(): Promise<HistoryReport> {
  const supabase = await createServerClient()

  const [doneRes, quickDoneRes] = await Promise.all([
    supabase
      .from('monday_tasks')
      .select(TASK_COLS)
      .eq('archived', false)
      .eq('status', 'done')
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(HISTORY_LIMIT),
    supabase
      .from('monday_quick_tasks')
      .select(QUICK_COLS)
      .eq('archived', false)
      .eq('status', 'done')
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(HISTORY_LIMIT),
  ])

  const tasks = (doneRes.data ?? []) as TaskRow[]
  const quickTasks = (quickDoneRes.data ?? []) as QuickRow[]
  if (!tasks.length && !quickTasks.length) return { days: [], total: 0, capped: false }

  const { boardToProject, projectById } = await resolveProjects(supabase, tasks)
  const profileById = await resolveProfiles(supabase, [...tasks, ...quickTasks])

  const merged: HistoryTaskItem[] = []

  for (const t of tasks) {
    if (!t.completed_at) continue
    const projectId = boardToProject.get(t.board_id)
    const project = projectId ? projectById.get(projectId) : undefined
    if (!project) continue // projeto fora do alcance (RLS) — ignora

    merged.push({
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
      assigneeName: assigneeNameFrom(profileById, t.assignee_id),
    })
  }

  for (const t of quickTasks) {
    if (!t.completed_at) continue
    merged.push({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      due_date: t.due_date,
      completed_at: t.completed_at,
      overdue: false,
      projectId: QUICK_PSEUDO_PROJECT.id,
      projectName: QUICK_PSEUDO_PROJECT.name,
      projectKey: QUICK_PSEUDO_PROJECT.key,
      projectColor: QUICK_PSEUDO_PROJECT.color,
      assigneeName: assigneeNameFrom(profileById, t.assignee_id),
    })
  }

  // Cada consulta veio ordenada, mas o merge das duas precisa reordenar.
  merged.sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))

  const capped =
    merged.length > HISTORY_LIMIT ||
    tasks.length >= HISTORY_LIMIT ||
    quickTasks.length >= HISTORY_LIMIT
  const visible = merged.slice(0, HISTORY_LIMIT)

  // Agrupa por dia BRT preservando a ordem desc.
  const dayOrder: string[] = []
  const byDay = new Map<string, HistoryTaskItem[]>()

  for (const item of visible) {
    const day = brtDate(new Date(item.completed_at!))
    let list = byDay.get(day)
    if (!list) {
      list = []
      byDay.set(day, list)
      dayOrder.push(day)
    }
    list.push(item)
  }

  const days: HistoryDay[] = dayOrder.map((day) => ({ day, items: byDay.get(day)! }))
  return { days, total: visible.length, capped }
}
