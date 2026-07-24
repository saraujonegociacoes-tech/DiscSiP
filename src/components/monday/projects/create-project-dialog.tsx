'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { createProject } from '@/app/actions/monday-projects'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

const COLORS = ['#3B82F6', '#00C875', '#FDAB3D', '#E2445C', '#A25DDC', '#579BFC']

export function CreateProjectDialog() {
  const [open, setOpen] = useState(false)
  const [color, setColor] = useState(COLORS[0])
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function onSubmit(formData: FormData) {
    formData.set('color', color)
    startTransition(async () => {
      const res = await createProject(formData)
      if (res.id) {
        toast.success('Projeto criado')
        setOpen(false)
        router.push(`/projects/${res.id}`)
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          Novo projeto
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={onSubmit}>
          <DialogHeader>
            <DialogTitle>Novo projeto</DialogTitle>
            <DialogDescription>
              Crie um projeto para organizar boards, sprints e tarefas.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-2">
                <Label htmlFor="name">Nome</Label>
                <Input id="name" name="name" placeholder="Blue Desk App" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="key">Chave</Label>
                <Input
                  id="key"
                  name="key"
                  placeholder="BL"
                  required
                  maxLength={10}
                  className="uppercase"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Descrição</Label>
              <Textarea id="description" name="description" rows={2} />
            </div>
            <div className="space-y-2">
              <Label>Cor</Label>
              <div className="flex gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    aria-label={`Cor ${c}`}
                    className="size-7 rounded-full ring-offset-2 ring-offset-background transition"
                    style={{
                      backgroundColor: c,
                      boxShadow: color === c ? `0 0 0 2px var(--ring)` : undefined,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? 'Criando…' : 'Criar projeto'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
