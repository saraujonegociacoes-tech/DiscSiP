'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { PRIORITY_ORDER, STATUS_ORDER } from '@/lib/monday/domain'
import type {
  MondayMemberProfile,
  MondayQuickTask,
  MondayQuickTaskWithAssignee,
  MondayTaskStatus,
  QuickTaskInput,
} from '@/lib/monday/types'

const QUICK_COLS =
  'id, owner_id, title, description, category, status, priority, assignee_id, due_date, completed_at, archived, position, created_at, updated_at'

const QUICK_PATH = '/projects/quick'

/** Revalida a aba e as telas que cruzam tarefa rapida com tarefa de projeto. */
function revalidateQuick() {
  revalidatePath(QUICK_PATH)
  revalidatePath('/projects/daily')
  revalidatePath('/projects/calendar')
  revalidatePath('/projects/history')
}

// ─── Leitura ────────────────────────────────────────────────────────────────

/**
 * Todas as tarefas rapidas visiveis (RLS: dono, responsavel ou gerencia), ja com
 * o profile do responsavel. Ordem: nao concluidas primeiro, depois prazo mais
 * proximo, depois prioridade — a mesma leitura da Daily, para a aba abrir no que
 * importa sem o usuario mexer em filtro.
 */
export async function getQuickTasks(): Promise<MondayQuickTaskWithAssignee[]> {
  const supabase = await createServerClient()

  const { data } = await supabase
    .from('monday_quick_tasks')
    .select(QUICK_COLS)
    .eq('archived', false)
    .order('created_at', { ascending: false })

  const tasks = (data ?? []) as MondayQuickTask[]
  if (!tasks.length) return []

  const assigneeIds = [...new Set(tasks.map((t) => t.assignee_id).filter(Boolean))] as string[]
  let profiles: MondayMemberProfile[] = []
  if (assigneeIds.length) {
    const { data: profileData } = await supabase
      .from('profiles')
      .select('id, name, email')
      .in('id', assigneeIds)
    profiles = (profileData ?? []) as MondayMemberProfile[]
  }
  const profileById = new Map(profiles.map((p) => [p.id, p]))

  return tasks
    .map((t) => ({
      ...t,
      assignee: t.assignee_id ? profileById.get(t.assignee_id) ?? null : null,
    }))
    .sort((a, b) => {
      const aDone = a.status === 'done'
      const bDone = b.status === 'done'
      if (aDone !== bDone) return aDone ? 1 : -1 // concluidas por ultimo
      if (a.due_date !== b.due_date) {
        if (!a.due_date) return 1 // sem prazo depois das com prazo
        if (!b.due_date) return -1
        return a.due_date.localeCompare(b.due_date)
      }
      const byPriority = PRIORITY_ORDER.indexOf(b.priority) - PRIORITY_ORDER.indexOf(a.priority)
      if (byPriority !== 0) return byPriority
      return b.created_at.localeCompare(a.created_at)
    })
}

// ─── Mutacao ────────────────────────────────────────────────────────────────

function parseInput(formData: FormData): QuickTaskInput | { error: string } {
  const title = String(formData.get('title') ?? '').trim()
  if (!title) return { error: 'Título obrigatório.' }
  if (title.length > 500) return { error: 'Título muito longo (máx. 500).' }

  const category = String(formData.get('category') ?? '').trim().slice(0, 60) || null
  const status = String(formData.get('status') ?? 'todo') as MondayTaskStatus
  const priority = String(formData.get('priority') ?? 'medium')
  const dueDate = String(formData.get('due_date') ?? '').trim() || null
  const assignee = String(formData.get('assignee_id') ?? '').trim()

  if (!STATUS_ORDER.includes(status)) return { error: 'Status inválido.' }
  if (!PRIORITY_ORDER.includes(priority as QuickTaskInput['priority'])) {
    return { error: 'Prioridade inválida.' }
  }
  // O input de data entrega YYYY-MM-DD; qualquer outra coisa e recusada aqui para
  // nao estourar o check da coluna `date` no Postgres.
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return { error: 'Prazo inválido.' }

  return {
    title,
    description: String(formData.get('description') ?? '').trim() || null,
    category,
    status,
    priority: priority as QuickTaskInput['priority'],
    assignee_id: assignee || null,
    due_date: dueDate,
  }
}

export async function createQuickTask(formData: FormData): Promise<{ id?: string; error?: string }> {
  const parsed = parseInput(formData)
  if ('error' in parsed) return { error: parsed.error }

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const { data, error } = await supabase
    .from('monday_quick_tasks')
    .insert({ ...parsed, owner_id: user.id, position: Date.now() })
    .select('id')
    .single()
  if (error || !data) return { error: error?.message ?? 'Falha ao criar tarefa.' }

  revalidateQuick()
  return { id: data.id as string }
}

export async function updateQuickTask(
  id: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const parsed = parseInput(formData)
  if ('error' in parsed) return { error: parsed.error }

  const supabase = await createServerClient()
  const { error } = await supabase.from('monday_quick_tasks').update(parsed).eq('id', id)
  if (error) return { error: error.message }

  revalidateQuick()
  return {}
}

/** Atalho de um clique no painel do accordion — o motivo da aba existir. */
export async function setQuickTaskStatus(
  id: string,
  status: MondayTaskStatus,
): Promise<{ error?: string }> {
  if (!STATUS_ORDER.includes(status)) return { error: 'Status inválido.' }

  const supabase = await createServerClient()
  const { error } = await supabase.from('monday_quick_tasks').update({ status }).eq('id', id)
  if (error) return { error: error.message }

  revalidateQuick()
  return {}
}

export async function deleteQuickTask(id: string): Promise<{ error?: string }> {
  const supabase = await createServerClient()
  const { error } = await supabase.from('monday_quick_tasks').delete().eq('id', id)
  if (error) return { error: error.message }

  revalidateQuick()
  return {}
}
