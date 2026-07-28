'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { deleteSprint } from '@/app/actions/monday-sprints'
import type { MondaySprint } from '@/lib/monday/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SprintDialog } from '@/components/monday/sprints/sprint-dialog'

export function SprintCardActions({
  sprint,
  projectId,
}: {
  sprint: MondaySprint
  projectId: string
}) {
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function onConfirmDelete() {
    startTransition(async () => {
      const res = await deleteSprint(sprint.id, projectId)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success('Sprint apagado')
      setDeleteOpen(false)
      router.refresh()
    })
  }

  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground hover:text-foreground"
        onClick={() => setEditOpen(true)}
        aria-label="Editar sprint"
      >
        <Pencil className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground hover:text-destructive"
        onClick={() => setDeleteOpen(true)}
        aria-label="Apagar sprint"
      >
        <Trash2 className="size-3.5" />
      </Button>

      <SprintDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        projectId={projectId}
        sprint={sprint}
      />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apagar sprint</DialogTitle>
            <DialogDescription>
              O sprint <strong className="text-foreground">{sprint.name}</strong> será apagado. As
              tarefas vinculadas <strong className="text-foreground">não</strong> são excluídas —
              elas voltam para o backlog.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={pending}>
                Cancelar
              </Button>
            </DialogClose>
            <Button variant="destructive" onClick={onConfirmDelete} disabled={pending}>
              {pending ? 'Apagando…' : 'Apagar sprint'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
