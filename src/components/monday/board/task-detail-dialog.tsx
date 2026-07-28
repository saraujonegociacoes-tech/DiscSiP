'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { format, formatDistanceToNow, isPast, isToday, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { CalendarClock, MessageSquare, Pencil, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  addTaskComment,
  deleteTaskComment,
  getTaskComments,
} from '@/app/actions/monday-comments'
import { initials } from '@/lib/monday/domain'
import { extractMentionIds } from '@/lib/monday/mentions'
import type { MondayTaskCommentWithAuthor, MondayTaskWithTags } from '@/lib/monday/types'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { StatusBadge } from '@/components/monday/status-badge'
import { PriorityBadge } from '@/components/monday/priority-badge'
import { RichText } from '@/components/monday/rich-text'
import { MentionTextarea } from '@/components/monday/board/mention-textarea'
import { CommentBody } from '@/components/monday/board/comment-body'
import type { MemberOption } from '@/components/monday/board/task-dialog'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  task: MondayTaskWithTags | null
  assigneeName: string | null
  currentUserId: string
  projectId: string
  members: MemberOption[]
  onEdit: () => void
}

export function TaskDetailDialog({
  open,
  onOpenChange,
  task,
  assigneeName,
  currentUserId,
  projectId,
  members,
  onEdit,
}: Props) {
  // Autocomplete de @menção: todos os membros menos o proprio usuario.
  const mentionMembers = members.filter((m) => m.id !== currentUserId)
  const [comments, setComments] = useState<MondayTaskCommentWithAuthor[]>([])
  const [loading, setLoading] = useState(false)
  const [body, setBody] = useState('')
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const taskId = task?.id ?? null

  // Carrega os comentarios ao abrir (ou trocar de tarefa).
  useEffect(() => {
    if (!open || !taskId) return
    let alive = true
    setComments([])
    setBody('')
    setLoading(true)
    getTaskComments(taskId).then((c) => {
      if (!alive) return
      setComments(c)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [open, taskId])

  if (!task) return null

  const due = task.due_date ? parseISO(task.due_date) : null
  const overdue = due ? isPast(due) && !isToday(due) && task.status !== 'done' : false

  function send() {
    const text = body.trim()
    if (!text || !task) return
    const mentionedIds = extractMentionIds(text, mentionMembers)
    startTransition(async () => {
      const res = await addTaskComment(task.id, text, projectId, mentionedIds)
      if (res.error) {
        toast.error(res.error)
        return
      }
      if (res.comments) setComments(res.comments)
      setBody('')
      router.refresh() // atualiza o preview do ultimo comentario no card
    })
  }

  function remove(commentId: string) {
    if (!task) return
    startTransition(async () => {
      const res = await deleteTaskComment(commentId, task.id, projectId)
      if (res.error) {
        toast.error(res.error)
        return
      }
      if (res.comments) setComments(res.comments)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="pr-6 leading-snug">{task.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Meta: status, prioridade, pontos, prazo */}
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            {task.estimate != null && (
              <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {task.estimate} pts
              </span>
            )}
            {due && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs',
                  overdue
                    ? 'bg-status-stuck/10 font-medium text-status-stuck'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                <CalendarClock className="size-3.5" />
                {format(due, "dd 'de' MMM", { locale: ptBR })}
                {overdue && ' · atrasada'}
              </span>
            )}
          </div>

          {task.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {task.tags.map((tag) => (
                <span
                  key={tag.id}
                  className="rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
                  style={{ backgroundColor: tag.color }}
                >
                  {tag.name}
                </span>
              ))}
            </div>
          )}

          {assigneeName && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Responsável:</span>
              <span className="inline-flex items-center gap-1.5 font-medium">
                <Avatar className="size-5">
                  <AvatarFallback className="text-[9px]">{initials(assigneeName)}</AvatarFallback>
                </Avatar>
                {assigneeName}
              </span>
            </div>
          )}

          {task.description && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Descrição</p>
              <RichText content={task.description} className="text-sm" />
            </div>
          )}

          {/* Comentarios */}
          <div className="space-y-2 border-t border-border pt-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <MessageSquare className="size-3.5" />
              Comentários{comments.length > 0 ? ` (${comments.length})` : ''}
            </p>

            <div className="max-h-56 space-y-3 overflow-y-auto pr-1">
              {loading ? (
                <p className="text-sm text-muted-foreground">Carregando…</p>
              ) : comments.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum comentário ainda.</p>
              ) : (
                comments.map((c) => {
                  const name = c.author?.name || c.author?.email || 'Alguém'
                  return (
                    <div key={c.id} className="flex gap-2">
                      <Avatar className="size-6 shrink-0">
                        <AvatarFallback className="text-[9px]">
                          {initials(c.author?.name, c.author?.email)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium">{name}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {formatDistanceToNow(parseISO(c.created_at), {
                              locale: ptBR,
                              addSuffix: true,
                            })}
                          </span>
                          {c.author_id === currentUserId && (
                            <button
                              type="button"
                              onClick={() => remove(c.id)}
                              disabled={pending}
                              className="ml-auto text-muted-foreground transition-colors hover:text-destructive"
                              aria-label="Excluir comentário"
                            >
                              <Trash2 className="size-3" />
                            </button>
                          )}
                        </div>
                        <CommentBody body={c.body} members={members} />
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            <div className="flex items-end gap-2">
              <MentionTextarea
                value={body}
                onChange={setBody}
                members={mentionMembers}
                onSubmit={send}
                rows={2}
                placeholder="Escreva um comentário… (@ menciona, Ctrl+Enter envia)"
              />
              <Button
                size="icon"
                onClick={send}
                disabled={pending || !body.trim()}
                aria-label="Comentar"
              >
                <Send className="size-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="flex justify-end border-t border-border pt-3">
          <Button variant="outline" onClick={onEdit}>
            <Pencil className="size-4" />
            Editar tarefa
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
