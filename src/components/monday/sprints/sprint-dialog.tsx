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
import type { MemberOption } from '@/components/monday/board/task-dialog'
import {
  SprintSubtasks,
  isBlankSubtask,
  toSubtaskInput,
  type SubtaskDraft,
} from '@/components/monday/sprints/sprint-subtasks'

const SPRINT_STATUS_ORDER: MondaySprintStatus[] = ['planned', 'active', 'completed']

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  /** Presente = modo edição; ausente = criação. */
  sprint?: MondaySprint | null
  /** Responsáveis possíveis das subtarefas (só usado na criação). */
  members?: MemberOption[]
}

export function SprintDialog({ open, onOpenChange, projectId, sprint, members = [] }: Props) {
  const editing = Boolean(sprint)
  const [pending, startTransition] = useTransition()

  const [name, setName] = useState(sprint?.name ?? '')
  const [goal, setGoal] = useState(sprint?.goal ?? '')
  const [status, setStatus] = useState<MondaySprintStatus>(sprint?.status ?? 'planned')
  const [start, setStart] = useState(sprint?.start_date ?? '')
  const [end, setEnd] = useState(sprint?.end_date ?? '')
  // Subtarefas só existem na criação: na edição as tarefas já estão no board/backlog.
  const [subtasks, setSubtasks] = useState<SubtaskDraft[]>([])

  function submit() {
    if (!name.trim()) {
      toast.error('Nome obrigatório')
      return
    }

    if (editing) {
      startTransition(async () => {
        const res = await updateSprint(
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
        if (res.error) {
          toast.error(res.error)
          return
        }
        toast.success('Sprint atualizado')
        onOpenChange(false)
      })
      return
    }

    const rows = subtasks.filter((d) => !isBlankSubtask(d))
    if (rows.some((d) => !d.title.trim())) {
      toast.error('Dê um título a todas as subtarefas')
      return
    }

    startTransition(async () => {
      const res = await createSprint({
        projectId,
        name,
        goal: goal || null,
        start_date: start || null,
        end_date: end || null,
        subtasks: rows.map(toSubtaskInput),
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      // O sprint foi criado mesmo com aviso (as subtarefas é que falharam) — fecha.
      if (res.warning) {
        toast.error(res.warning)
      } else {
        const n = rows.length
        toast.success(n ? `Sprint criado com ${n} subtarefa${n === 1 ? '' : 's'}` : 'Sprint criado')
      }
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar sprint' : 'Novo sprint'}</DialogTitle>
        </DialogHeader>
        {/* O limite de altura fica AQUI, no elemento que rola — nao no DialogContent.
            Ele e `display:grid` com linhas implicitas `auto`, que se dimensionam pelo
            conteudo: um `max-h` la em cima faz o grid transbordar em vez de encolher a
            linha do meio, e o formulario vaza para fora do diálogo (aparecia com zoom
            alto, que e quando a viewport fica menor que o formulario).

            O `min()` diz "60% da tela, mas nunca mais do que sobra depois do cabecalho,
            do rodape e do respiro do diálogo (~12rem)". A segunda metade e o que segura
            o zoom alto: `dvh` encolhe junto com a viewport, mas rem nao — sem ela o
            corte voltaria a partir de ~350px de altura util.
            `-mx-1 px-1` dá folga lateral para o anel de foco dos campos não ser cortado. */}
        <div className="scrollbar-slim -mx-1 max-h-[min(60dvh,calc(100dvh-12rem))] space-y-4 overflow-y-auto px-1 py-2">
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

          {!editing && (
            <SprintSubtasks drafts={subtasks} onChange={setSubtasks} members={members} />
          )}
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
