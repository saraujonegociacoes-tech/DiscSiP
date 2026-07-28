/**
 * Tipos do modulo Monday (tarefas/sprints), escritos a mao no padrao do Blue Desk
 * (mesma abordagem de src/lib/types/database.ts). Espelham as tabelas monday_* da
 * migration. Os "profiles" sao reusados do Blue Desk (coluna `name`, sem avatar_url).
 */

export type MondayTaskStatus = 'todo' | 'working' | 'review' | 'done' | 'stuck'
export type MondayTaskPriority = 'low' | 'medium' | 'high' | 'critical'
export type MondaySprintStatus = 'planned' | 'active' | 'completed'
export type MondayMemberRole = 'owner' | 'admin' | 'member' | 'viewer'

export interface MondayProject {
  id: string
  name: string
  key: string
  description: string | null
  color: string
  owner_id: string
  archived: boolean
  created_at: string
  updated_at: string
}

export interface MondayProjectMember {
  project_id: string
  user_id: string
  role: MondayMemberRole
  created_at: string
}

export interface MondayBoard {
  id: string
  project_id: string
  name: string
  description: string | null
  position: number
  created_at: string
  updated_at: string
}

export interface MondayGroup {
  id: string
  board_id: string
  name: string
  color: string
  position: number
  created_at: string
}

export interface MondaySprint {
  id: string
  project_id: string
  name: string
  goal: string | null
  status: MondaySprintStatus
  start_date: string | null
  end_date: string | null
  position: number
  created_at: string
  updated_at: string
}

export interface MondayTask {
  id: string
  board_id: string
  group_id: string | null
  sprint_id: string | null
  title: string
  description: string | null
  status: MondayTaskStatus
  priority: MondayTaskPriority
  assignee_id: string | null
  estimate: number | null
  start_date: string | null
  due_date: string | null
  position: number
  archived: boolean
  created_by: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface MondayTag {
  id: string
  project_id: string
  name: string
  color: string
  created_at: string
}

export interface MondayTaskComment {
  id: string
  task_id: string
  author_id: string | null
  body: string
  created_at: string
}

/** Ultimo comentario de uma tarefa (vem da view monday_task_last_comment) +
 *  nome do autor resolvido no server. Usado no preview do card. */
export interface MondayTaskLastComment {
  task_id: string
  comment_id: string
  body: string
  author_id: string | null
  author_name: string | null
  created_at: string
}

export interface MondayProjectOverview {
  project_id: string
  total_tasks: number
  done_tasks: number
  working_tasks: number
  stuck_tasks: number
  board_count: number
  total_points: number
  done_points: number
}

export interface MondaySprintStats {
  sprint_id: string
  project_id: string
  total_tasks: number
  done_tasks: number
  total_points: number
  done_points: number
}

export interface MondayBurndownPoint {
  day: string
  ideal: number | null
  remaining: number | null
}

/** Subconjunto do profile do Blue Desk usado para responsavel/membro. */
export interface MondayMemberProfile {
  id: string
  name: string | null
  email: string | null
}

/** Usuario que pode ser adicionado a um projeto (vem da RPC monday_assignable_users). */
export interface MondayAssignableUser {
  id: string
  name: string | null
  email: string | null
  role: string
}

export type MondayTaskCommentWithAuthor = MondayTaskComment & { author: MondayMemberProfile | null }

// ─── Tipos derivados (usados nas telas) ─────────────────────────────────────
export type MondayTaskWithTags = MondayTask & {
  tags: MondayTag[]
  /** Ultimo comentario (para o preview do card). undefined = nao carregado. */
  lastComment?: MondayTaskLastComment | null
}

export type MondayBoardData = {
  board: MondayBoard | null
  groups: MondayGroup[]
  tasks: MondayTaskWithTags[]
}

export type MondayProjectWithStats = MondayProject & {
  overview: MondayProjectOverview | null
  /** Perfil do dono do projeto (para agrupar por pessoa na lista). */
  owner?: MondayMemberProfile | null
}
export type MondaySprintWithStats = MondaySprint & { stats: MondaySprintStats | null }
export type MondayMemberWithProfile = MondayProjectMember & { profile: MondayMemberProfile | null }

export type MondayMemberOption = { id: string; label: string }

// ─── Daily (resumo por pessoa: feito hoje/ontem + a entregar) ────────────────
export interface DailyTaskItem {
  id: string
  title: string
  status: MondayTaskStatus
  priority: MondayTaskPriority
  due_date: string | null
  completed_at: string | null
  overdue: boolean
  projectId: string
  projectName: string
  projectKey: string
  projectColor: string
}

export interface DailyPersonGroup {
  assigneeId: string | null
  person: MondayMemberProfile | null
  doneToday: DailyTaskItem[]
  doneYesterday: DailyTaskItem[]
  toDeliver: DailyTaskItem[]
}

export interface DailyReport {
  groups: DailyPersonGroup[]
}
