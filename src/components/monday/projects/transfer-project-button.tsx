'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeftRight } from 'lucide-react'
import { toast } from 'sonner'
import { transferProject } from '@/app/actions/monday-projects'
import type { MondayAssignableUser } from '@/lib/monday/types'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * Passa o projeto para outra pessoa. Reusa a MESMA lista de `assignableUsers` que o
 * diálogo de membros ja recebe do layout — o botao nao faz nenhuma consulta propria.
 */
export function TransferProjectButton({
  projectId,
  projectName,
  ownerId,
  ownerName,
  assignableUsers,
}: {
  projectId: string
  projectName: string
  ownerId: string
  ownerName: string
  assignableUsers: MondayAssignableUser[]
}) {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState('')
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const candidates = useMemo(
    () => assignableUsers.filter((u) => u.id !== ownerId),
    [assignableUsers, ownerId],
  )

  function onConfirm() {
    if (!target) {
      toast.error('Selecione a pessoa')
      return
    }
    startTransition(async () => {
      const res = await transferProject(projectId, target)
      if (res.error) {
        toast.error(res.error)
        return
      }
      // Com aviso a transferencia valeu (so os papeis ficaram a meio caminho) — fecha.
      if (res.warning) toast.error(res.warning)
      else toast.success('Projeto transferido')
      setOpen(false)
      setTarget('')
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ArrowLeftRight className="size-4" />
          Transferir
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transferir projeto</DialogTitle>
          <DialogDescription>
            <strong className="text-foreground">{projectName}</strong> sai de{' '}
            <strong className="text-foreground">{ownerName}</strong> e passa a ser da pessoa
            escolhida. Quem era dono continua no projeto como{' '}
            <strong className="text-foreground">Admin</strong>, com acesso total — inclusive para
            transferir de volta.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label>Novo dono</Label>
          <Select
            value={target}
            onValueChange={setTarget}
            disabled={pending || candidates.length === 0}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={candidates.length ? 'Selecionar…' : 'Ninguém disponível'}
              />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name || u.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              Cancelar
            </Button>
          </DialogClose>
          <Button onClick={onConfirm} disabled={pending || !target}>
            {pending ? 'Transferindo…' : 'Transferir'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
