'use client'

import { Plus, Trash2 } from 'lucide-react'
import { PRIORITY_ORDER, PRIORITY_META } from '@/lib/monday/domain'
import type { MondayTaskPriority } from '@/lib/monday/types'
import type { CreateSprintSubtask } from '@/app/actions/monday-sprints'
import type { MemberOption } from '@/components/monday/board/task-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { BrDateInput } from '@/components/bluedesk/BrDateInput'

const UNASSIGNED = '__none__'

/** Linha do formulario. `key` e so da lista — nao vai para o banco. */
export type SubtaskDraft = {
  key: number
  title: string
  description: string
  priority: MondayTaskPriority
  assignee: string
  estimate: string
  dueDate: string
}

function emptyDraft(key: number): SubtaskDraft {
  return {
    key,
    title: '',
    description: '',
    priority: 'medium',
    assignee: UNASSIGNED,
    estimate: '',
    dueDate: '',
  }
}

/** Linha intocada — o usuario adicionou e desistiu; e descartada sem reclamar. */
export function isBlankSubtask(d: SubtaskDraft): boolean {
  return (
    !d.title.trim() &&
    !d.description.trim() &&
    !d.estimate.trim() &&
    !d.dueDate &&
    d.assignee === UNASSIGNED
  )
}

/** Draft (formulario) → payload da action. Mesma conversao do TaskDialog. */
export function toSubtaskInput(d: SubtaskDraft): CreateSprintSubtask {
  return {
    title: d.title,
    description: d.description.trim() || null,
    priority: d.priority,
    assignee_id: d.assignee === UNASSIGNED ? null : d.assignee,
    estimate: d.estimate.trim() === '' ? null : Number(d.estimate),
    due_date: d.dueDate.trim() === '' ? null : d.dueDate,
  }
}

/**
 * Lista editavel de subtarefas do sprint. Os campos espelham os do TaskDialog
 * (titulo, descricao, prioridade, responsavel, pontos, prazo) — menos o status,
 * que e fixo: toda subtarefa nasce na fase "Fazendo".
 *
 * O estado vive no SprintDialog (fonte unica): aqui so entram `drafts` e `onChange`.
 */
export function SprintSubtasks({
  drafts,
  onChange,
  members,
}: {
  drafts: SubtaskDraft[]
  onChange: (drafts: SubtaskDraft[]) => void
  members: MemberOption[]
}) {
  function add() {
    const nextKey = drafts.reduce((max, d) => Math.max(max, d.key), 0) + 1
    onChange([...drafts, emptyDraft(nextKey)])
  }

  function patch(key: number, p: Partial<SubtaskDraft>) {
    onChange(drafts.map((d) => (d.key === key ? { ...d, ...p } : d)))
  }

  function remove(key: number) {
    onChange(drafts.filter((d) => d.key !== key))
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Subtarefas</Label>
        {drafts.length > 0 && (
          <Button type="button" variant="outline" size="sm" onClick={add}>
            <Plus className="size-4" /> Adicionar
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Criadas junto com o sprint, já na fase{' '}
        <strong className="font-medium text-foreground">Fazendo</strong> do board.
      </p>

      {drafts.length === 0 ? (
        <button
          type="button"
          onClick={add}
          className="w-full rounded-md border border-dashed py-4 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          + Adicionar subtarefa
        </button>
      ) : (
        <div className="space-y-3">
          {drafts.map((d, i) => (
            <div key={d.key} className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center gap-2">
                <span className="w-4 shrink-0 text-xs font-medium text-muted-foreground">
                  {i + 1}
                </span>
                <Input
                  value={d.title}
                  onChange={(e) => patch(d.key, { title: e.target.value })}
                  placeholder="O que precisa ser feito?"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => remove(d.key)}
                  aria-label={`Remover subtarefa ${i + 1}`}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>

              <Textarea
                value={d.description}
                onChange={(e) => patch(d.key, { description: e.target.value })}
                rows={2}
                placeholder="Descrição (opcional)"
              />

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Responsável</Label>
                  <Select
                    value={d.assignee}
                    onValueChange={(v) => patch(d.key, { assignee: v })}
                  >
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
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Prioridade</Label>
                  <Select
                    value={d.priority}
                    onValueChange={(v) => patch(d.key, { priority: v as MondayTaskPriority })}
                  >
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
                <div className="space-y-1.5">
                  <Label htmlFor={`st-${d.key}-est`} className="text-xs text-muted-foreground">
                    Pontos
                  </Label>
                  <Input
                    id={`st-${d.key}-est`}
                    type="number"
                    min={0}
                    step={0.5}
                    value={d.estimate}
                    onChange={(e) => patch(d.key, { estimate: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`st-${d.key}-due`} className="text-xs text-muted-foreground">
                    Prazo
                  </Label>
                  <BrDateInput
                    id={`st-${d.key}-due`}
                    value={d.dueDate}
                    onChange={(v) => patch(d.key, { dueDate: v })}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
