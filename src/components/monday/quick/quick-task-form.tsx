'use client'

import { useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { BorderGlow } from '@/components/ui/border-glow'
import { BrDateInput } from '@/components/bluedesk/BrDateInput'
import { PRIORITY_META, PRIORITY_ORDER, STATUS_META, STATUS_ORDER } from '@/lib/monday/domain'
import type { MondayAssignableUser, MondayQuickTaskWithAssignee } from '@/lib/monday/types'

import './quick-task-form.css'

export type QuickTaskFormProps = {
  /** Preenche o formulario para edicao; ausente = criacao. */
  task?: MondayQuickTaskWithAssignee
  /** Categorias ja usadas, para o autocomplete. */
  categories: string[]
  assignableUsers: MondayAssignableUser[]
  /** Recebe o FormData ja montado; devolve `error` para virar toast. */
  onSubmit: (formData: FormData) => Promise<{ error?: string }>
  submitLabel: string
  pendingLabel: string
  successMessage: string
  onDone?: () => void
  onCancel?: () => void
}

/**
 * Formulario da tarefa rapida, dentro do BorderGlow (borda que acende conforme o
 * cursor chega perto). O `due_date` usa o BrDateInput do Blue Desk — data sempre
 * em DD/MM/AAAA na tela, ISO no envio — e por isso vai por um input hidden.
 */
export function QuickTaskForm({
  task,
  categories,
  assignableUsers,
  onSubmit,
  submitLabel,
  pendingLabel,
  successMessage,
  onDone,
  onCancel,
}: QuickTaskFormProps) {
  const [dueDate, setDueDate] = useState(task?.due_date ?? '')
  const [pending, startTransition] = useTransition()
  const uid = useId()
  const listId = `quick-categories-${uid}`

  function handleSubmit(formData: FormData) {
    formData.set('due_date', dueDate)
    startTransition(async () => {
      const res = await onSubmit(formData)
      if (res.error) toast.error(res.error)
      else {
        toast.success(successMessage)
        onDone?.()
      }
    })
  }

  return (
    <BorderGlow borderRadius={16}>
      <form action={handleSubmit} className="quick-form">
        <div className="quick-form__group">
          <label htmlFor={`${uid}-title`}>O que precisa ser feito?</label>
          <input
            type="text"
            id={`${uid}-title`}
            name="title"
            required
            maxLength={500}
            autoComplete="off"
            placeholder="Responder o e-mail do cartório"
            defaultValue={task?.title ?? ''}
          />
        </div>

        <div className="quick-form__group">
          <label htmlFor={`${uid}-description`}>Detalhes (opcional)</label>
          <textarea
            id={`${uid}-description`}
            name="description"
            rows={4}
            placeholder="Contexto, link, número do protocolo…"
            defaultValue={task?.description ?? ''}
          />
        </div>

        <div className="quick-form__grid">
          <div className="quick-form__group">
            <label htmlFor={`${uid}-category`}>Categoria</label>
            <input
              type="text"
              id={`${uid}-category`}
              name="category"
              maxLength={60}
              autoComplete="off"
              list={listId}
              placeholder="Suporte, Financeiro…"
              defaultValue={task?.category ?? ''}
            />
            <datalist id={listId}>
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>

          <div className="quick-form__group">
            <label htmlFor={`${uid}-due`}>Prazo</label>
            <BrDateInput
              id={`${uid}-due`}
              value={dueDate}
              onChange={setDueDate}
              aria-label="Prazo"
              className="w-full rounded-lg border border-input bg-transparent px-4 py-3 text-sm shadow-none"
            />
          </div>

          <div className="quick-form__group">
            <label htmlFor={`${uid}-status`}>Status</label>
            <select id={`${uid}-status`} name="status" defaultValue={task?.status ?? 'todo'}>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </select>
          </div>

          <div className="quick-form__group">
            <label htmlFor={`${uid}-priority`}>Prioridade</label>
            <select
              id={`${uid}-priority`}
              name="priority"
              defaultValue={task?.priority ?? 'medium'}
            >
              {PRIORITY_ORDER.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_META[p].label}
                </option>
              ))}
            </select>
          </div>

          <div className="quick-form__group" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor={`${uid}-assignee`}>Responsável</label>
            <select
              id={`${uid}-assignee`}
              name="assignee_id"
              defaultValue={task?.assignee_id ?? ''}
            >
              <option value="">Ninguém (minha tarefa)</option>
              {assignableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name ?? u.email ?? u.id}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="quick-form__actions">
          <button type="submit" className="quick-form__submit" disabled={pending}>
            {pending ? pendingLabel : submitLabel}
          </button>
          {onCancel && (
            <button type="button" className="quick-form__ghost" onClick={onCancel}>
              Cancelar
            </button>
          )}
        </div>
      </form>
    </BorderGlow>
  )
}
