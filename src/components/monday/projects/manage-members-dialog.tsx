'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Users, UserPlus, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  addProjectMember,
  removeProjectMember,
  updateProjectMemberRole,
} from '@/app/actions/monday-projects'
import type {
  MondayAssignableUser,
  MondayMemberRole,
  MondayMemberWithProfile,
} from '@/lib/monday/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

const ROLE_LABEL: Record<MondayMemberRole, string> = {
  owner: 'Dono',
  admin: 'Admin',
  member: 'Membro',
  viewer: 'Visualizador',
}

// Papeis atribuiveis pela UI. 'owner' e exclusivo do criador (nunca aparece aqui).
const ASSIGNABLE_ROLES: MondayMemberRole[] = ['admin', 'member', 'viewer']

function initials(name: string | null, email: string | null): string {
  const src = name?.trim() || email?.trim() || '?'
  return src
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

type Props = {
  projectId: string
  ownerId: string
  currentUserId: string
  initialMembers: MondayMemberWithProfile[]
  assignableUsers: MondayAssignableUser[]
}

export function ManageMembersButton({
  projectId,
  ownerId,
  currentUserId,
  initialMembers,
  assignableUsers,
}: Props) {
  const [open, setOpen] = useState(false)
  const [members, setMembers] = useState(initialMembers)
  const [selectedUser, setSelectedUser] = useState('')
  const [newRole, setNewRole] = useState<MondayMemberRole>('member')
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const available = useMemo(
    () => assignableUsers.filter((u) => !members.some((m) => m.user_id === u.id)),
    [assignableUsers, members],
  )

  function apply(
    action: Promise<{ members?: MondayMemberWithProfile[]; error?: string }>,
    ok: string,
  ) {
    startTransition(async () => {
      const res = await action
      if (res.error) {
        toast.error(res.error)
        return
      }
      if (res.members) setMembers(res.members)
      toast.success(ok)
      router.refresh() // atualiza os responsaveis de tarefa no board
    })
  }

  function onAdd() {
    if (!selectedUser) {
      toast.error('Selecione uma pessoa')
      return
    }
    apply(addProjectMember(projectId, selectedUser, newRole), 'Membro adicionado')
    setSelectedUser('')
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Users className="size-4" />
          Membros
          <span className="ml-1 rounded bg-muted px-1.5 text-xs font-medium">{members.length}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Membros do projeto</DialogTitle>
          <DialogDescription>
            Admins e gerentes já enxergam todos os projetos. Adicione aqui pessoas específicas
            (ex.: agentes ou supervisores) para dar acesso e poder atribuí-las às tarefas.
          </DialogDescription>
        </DialogHeader>

        {/* Adicionar membro */}
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <label className="text-xs text-muted-foreground">Pessoa</label>
            <Select
              value={selectedUser}
              onValueChange={setSelectedUser}
              disabled={pending || available.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder={available.length ? 'Selecionar…' : 'Todos já são membros'} />
              </SelectTrigger>
              <SelectContent>
                {available.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name || u.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-32 space-y-1">
            <label className="text-xs text-muted-foreground">Papel</label>
            <Select
              value={newRole}
              onValueChange={(v) => setNewRole(v as MondayMemberRole)}
              disabled={pending}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSIGNABLE_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={onAdd} disabled={pending || !selectedUser}>
            <UserPlus className="size-4" />
            Adicionar
          </Button>
        </div>

        {/* Lista de membros */}
        <div className="mt-1 max-h-72 space-y-1 overflow-y-auto">
          {members.map((m) => {
            const isOwner = m.user_id === ownerId || m.role === 'owner'
            const name = m.profile?.name || m.profile?.email || 'Sem nome'
            return (
              <div
                key={m.user_id}
                className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">
                  {initials(m.profile?.name ?? null, m.profile?.email ?? null)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {name}
                    {m.user_id === currentUserId && (
                      <span className="text-muted-foreground"> (você)</span>
                    )}
                  </p>
                  {m.profile?.email && (
                    <p className="truncate text-xs text-muted-foreground">{m.profile.email}</p>
                  )}
                </div>
                {isOwner ? (
                  <span className="rounded bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                    Dono
                  </span>
                ) : (
                  <>
                    <Select
                      value={m.role}
                      onValueChange={(v) =>
                        apply(
                          updateProjectMemberRole(projectId, m.user_id, v as MondayMemberRole),
                          'Papel atualizado',
                        )
                      }
                      disabled={pending}
                    >
                      <SelectTrigger className="h-8 w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ASSIGNABLE_ROLES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        apply(removeProjectMember(projectId, m.user_id), 'Membro removido')
                      }
                      disabled={pending}
                      aria-label={`Remover ${name}`}
                    >
                      <X className="size-4" />
                    </Button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
