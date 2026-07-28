'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { createTask, updateTask, deleteTask } from '@/app/actions/monday-tasks'
import { STATUS_ORDER, STATUS_META, PRIORITY_ORDER, PRIORITY_META } from '@/lib/monday/domain'
import type { MondayTaskStatus, MondayTaskPriority, MondayTaskWithTags } from '@/lib/monday/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export type MemberOption = { id: string; label: string }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  boardId: string
  members: MemberOption[]
  task?: MondayTaskWithTags | null
  defaultStatus?: MondayTaskStatus
}

const UNASSIGNED = '__none__'

export function TaskDialog({
  open,
  onOpenChange,
  projectId,
  boardId,
  members,
  task,
  defaultStatus = 'todo',
}: Props) {
  const editing = Boolean(task)
  const [pending, startTransition] = useTransition()

  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [status, setStatus] = useState<MondayTaskStatus>(task?.status ?? defaultStatus)
  const [priority, setPriority] = useState<MondayTaskPriority>(task?.priority ?? 'medium')
  const [assignee, setAssignee] = useState<string>(task?.assignee_id ?? UNASSIGNED)
  const [estimate, setEstimate] = useState<string>(
    task?.estimate != null ? String(task.estimate) : '',
  )
  const [dueDate, setDueDate] = useState<string>(task?.due_date ?? '')

  function submit() {
    if (!title.trim()) {
      toast.error('Título obrigatório')
      return
    }
    const assignee_id = assignee === UNASSIGNED ? null : assignee
    const est = estimate.trim() === '' ? null : Number(estimate)
    const due_date = dueDate.trim() === '' ? null : dueDate

    startTransition(async () => {
      const res = editing
        ? await updateTask(
            task!.id,
            { title, description: description || null, status, priority, assignee_id, estimate: est, due_date },
            projectId,
          )
        : await createTask({
            projectId,
            board_id: boardId,
            title,
            description: description || null,
            status,
            priority,
            assignee_id,
            estimate: est,
            due_date,
          })

      if (!res.error) {
        toast.success(editing ? 'Tarefa atualizada' : 'Tarefa criada')
        onOpenChange(false)
      } else {
        toast.error(res.error)
      }
    })
  }

  function onDelete() {
    if (!task) return
    startTransition(async () => {
      const res = await deleteTask(task.id, projectId)
      if (!res.error) {
        toast.success('Tarefa excluída')
        onOpenChange(false)
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar tarefa' : 'Nova tarefa'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="t-title">Título</Label>
            <Input
              id="t-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="O que precisa ser feito?"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="t-desc">Descrição</Label>
            <Textarea
              id="t-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder={'Detalhe a tarefa…\n- Passo um\n- Passo dois\n\nUse **negrito** e listas com - ou 1.'}
            />
            <p className="text-xs text-muted-foreground">
              Dica: <code className="rounded bg-muted px-1">-</code> para tópicos,{' '}
              <code className="rounded bg-muted px-1">1.</code> para lista numerada e{' '}
              <code className="rounded bg-muted px-1">**texto**</code> para negrito. As quebras de
              linha são preservadas.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as MondayTaskStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_ORDER.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_META[s].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Prioridade</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as MondayTaskPriority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_ORDER.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PRIORITY_META[p].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Responsável</Label>
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger>
                  <SelectValue placeholder="Ninguém" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Ninguém</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label htmlFor="t-est">Pontos</Label>
                <Input
                  id="t-est"
                  type="number"
                  min={0}
                  step={0.5}
                  value={estimate}
                  onChange={(e) => setEstimate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="t-due">Prazo</Label>
                <Input
                  id="t-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          {editing ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              disabled={pending}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="size-4" /> Excluir
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Salvando…' : editing ? 'Salvar' : 'Criar tarefa'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
