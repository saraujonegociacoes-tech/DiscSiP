'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import type {
  MondayMemberProfile,
  MondayTaskComment,
  MondayTaskCommentWithAuthor,
} from '@/lib/monday/types'

type CommentMutation = { comments?: MondayTaskCommentWithAuthor[]; error?: string }

/** Comentarios de uma tarefa (mais antigos primeiro), com o autor resolvido. */
export async function getTaskComments(taskId: string): Promise<MondayTaskCommentWithAuthor[]> {
  const supabase = await createServerClient()
  const { data } = await supabase
    .from('monday_task_comments')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })

  const list = (data ?? []) as MondayTaskComment[]
  if (!list.length) return []

  const authorIds = [...new Set(list.map((c) => c.author_id).filter(Boolean))] as string[]
  let profiles: MondayMemberProfile[] = []
  if (authorIds.length) {
    const { data: rows } = await supabase
      .from('profiles')
      .select('id, name, email')
      .in('id', authorIds)
    profiles = (rows ?? []) as MondayMemberProfile[]
  }

  const byId = new Map(profiles.map((p) => [p.id, p]))
  return list.map((c) => ({ ...c, author: c.author_id ? byId.get(c.author_id) ?? null : null }))
}

/**
 * Adiciona um comentario (como o usuario atual) e devolve a lista atualizada.
 * `mentionedUserIds` sao os ids escolhidos no autocomplete de @menção; a RPC
 * SECURITY DEFINER revalida o acesso de cada um antes de criar a notificacao
 * (ids invalidos ou sem acesso a tarefa sao descartados).
 */
export async function addTaskComment(
  taskId: string,
  body: string,
  projectId: string,
  mentionedUserIds: string[] = [],
): Promise<CommentMutation> {
  const trimmed = body.trim()
  if (!trimmed) return { error: 'Comentário vazio.' }
  if (trimmed.length > 4000) return { error: 'Comentário muito longo (máx. 4000).' }

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const { data: inserted, error } = await supabase
    .from('monday_task_comments')
    .insert({ task_id: taskId, author_id: user.id, body: trimmed })
    .select('id')
    .single()
  if (error) return { error: error.message }

  // Notifica os mencionados (menos o proprio autor; dedup + acesso na RPC).
  const mentioned = [...new Set(mentionedUserIds)].filter((id) => id && id !== user.id)
  if (inserted?.id && mentioned.length) {
    await supabase.rpc('monday_notify_mentions', {
      p_comment_id: inserted.id,
      p_mentioned: mentioned,
    })
  }

  revalidatePath(`/projects/${projectId}`)
  return { comments: await getTaskComments(taskId) }
}

/** Apaga um comentario proprio (RLS: author_id = auth.uid()). */
export async function deleteTaskComment(
  commentId: string,
  taskId: string,
  projectId: string,
): Promise<CommentMutation> {
  const supabase = await createServerClient()
  const { error } = await supabase.from('monday_task_comments').delete().eq('id', commentId)
  if (error) return { error: error.message }

  revalidatePath(`/projects/${projectId}`)
  return { comments: await getTaskComments(taskId) }
}
