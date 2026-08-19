'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { createQuickTask, updateQuickTask } from '@/app/actions/monday-quick-tasks'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import type { MondayAssignableUser, MondayQuickTaskWithAssignee } from '@/lib/monday/types'
import { QuickTaskForm } from './quick-task-form'

type SharedProps = {
  categories: string[]
  assignableUsers: MondayAssignableUser[]
}

/**
 * O DialogContent perde fundo/borda/padding proprios: quem desenha o card e o
 * BorderGlow dentro do QuickTaskForm. Sem isso ficariam duas molduras empilhadas.
 */
const BARE_CONTENT = 'max-w-xl border-0 bg-transparent p-0 shadow-none'

export function CreateQuickTaskDialog({ categories, assignableUsers }: SharedProps) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          Nova tarefa
        </Button>
      </DialogTrigger>
      <DialogContent className={BARE_CONTENT}>
        <DialogHeader className="sr-only">
          <DialogTitle>Nova tarefa rápida</DialogTitle>
          <DialogDescription>
            Registre uma tarefa avulsa, sem precisar criar um projeto.
          </DialogDescription>
        </DialogHeader>
        <QuickTaskForm
          categories={categories}
          assignableUsers={assignableUsers}
          onSubmit={createQuickTask}
          submitLabel="Criar tarefa"
          pendingLabel="Criando…"
          successMessage="Tarefa criada"
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

export function EditQuickTaskDialog({
  task,
  categories,
  assignableUsers,
  open,
  onOpenChange,
}: SharedProps & {
  task: MondayQuickTaskWithAssignee
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={BARE_CONTENT}>
        <DialogHeader className="sr-only">
          <DialogTitle>Editar tarefa rápida</DialogTitle>
          <DialogDescription>Altere os campos da tarefa.</DialogDescription>
        </DialogHeader>
        <QuickTaskForm
          task={task}
          categories={categories}
          assignableUsers={assignableUsers}
          onSubmit={(formData) => updateQuickTask(task.id, formData)}
          submitLabel="Salvar"
          pendingLabel="Salvando…"
          successMessage="Tarefa atualizada"
          onDone={() => onOpenChange(false)}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
