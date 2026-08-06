'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { createSprint, updateSprint } from '@/app/actions/monday-sprints'
import { SPRINT_STATUS_META } from '@/lib/monday/domain'
import type { MondaySprint, MondaySprintStatus } from '@/lib/monday/types'
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
import { BrDateInput } from '@/components/bluedesk/BrDateInput'

const SPRINT_STATUS_ORDER: MondaySprintStatus[] = ['planned', 'active', 'completed']

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  /** Presente = modo edição; ausente = criação. */
  sprint?: MondaySprint | null
}

export function SprintDialog({ open, onOpenChange, projectId, sprint }: Props) {
  const editing = Boolean(sprint)
  const [pending, startTransition] = useTransition()

  const [name, setName] = useState(sprint?.name ?? '')
  const [goal, setGoal] = useState(sprint?.goal ?? '')
  const [status, setStatus] = useState<MondaySprintStatus>(sprint?.status ?? 'planned')
  const [start, setStart] = useState(sprint?.start_date ?? '')
  const [end, setEnd] = useState(sprint?.end_date ?? '')

  function submit() {
    if (!name.trim()) {
      toast.error('Nome obrigatório')
      return
    }
    startTransition(async () => {
      const res = editing
        ? await updateSprint(
            sprint!.id,
            {
              name,
              goal: goal || null,
              status,
              start_date: start || null,
              end_date: end || null,
            },
            projectId,
          )
        : await createSprint({
            projectId,
            name,
            goal: goal || null,
            start_date: start || null,
            end_date: end || null,
          })

      if (!res.error) {
        toast.success(editing ? 'Sprint atualizado' : 'Sprint criado')
        onOpenChange(false)
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar sprint' : 'Novo sprint'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="s-name">Nome</Label>
            <Input
              id="s-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sprint 1"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="s-goal">Objetivo</Label>
            <Textarea
              id="s-goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={4}
              placeholder={'Ex.:\n- Entregar o MVP do board\n- Validar com 3 clientes\n\nUse **negrito** e listas com - ou 1.'}
            />
            <p className="text-xs text-muted-foreground">
              Dica: comece a linha com <code className="rounded bg-muted px-1">-</code> para tópicos,{' '}
              <code className="rounded bg-muted px-1">1.</code> para lista numerada e{' '}
              <code className="rounded bg-muted px-1">**texto**</code> para negrito. As quebras de
              linha são preservadas.
            </p>
          </div>
          {editing && (
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as MondaySprintStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SPRINT_STATUS_ORDER.map((s) => (
                    <SelectItem key={s} value={s}>
                      {SPRINT_STATUS_META[s].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="s-start">Início</Label>
              <BrDateInput id="s-start" value={start} onChange={setStart} className="w-full" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-end">Fim</Label>
              <BrDateInput id="s-end" value={end} onChange={setEnd} className="w-full" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Salvando…' : editing ? 'Salvar' : 'Criar sprint'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
