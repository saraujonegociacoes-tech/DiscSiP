'use client'

import { useState, useTransition } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { createSprint } from '@/app/actions/monday-sprints'
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
  DialogTrigger,
} from '@/components/ui/dialog'

export function CreateSprintDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')

  function submit() {
    if (!name.trim()) {
      toast.error('Nome obrigatório')
      return
    }
    startTransition(async () => {
      const res = await createSprint({
        projectId,
        name,
        goal: goal || null,
        start_date: start || null,
        end_date: end || null,
      })
      if (!res.error) {
        toast.success('Sprint criado')
        setOpen(false)
        setName('')
        setGoal('')
        setStart('')
        setEnd('')
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" /> Novo sprint
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo sprint</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="s-name">Nome</Label>
            <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sprint 1" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="s-goal">Objetivo</Label>
            <Textarea id="s-goal" value={goal} onChange={(e) => setGoal(e.target.value)} rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="s-start">Início</Label>
              <Input id="s-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-end">Fim</Label>
              <Input id="s-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Criando…' : 'Criar sprint'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
