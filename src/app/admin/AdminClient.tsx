'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import { AppShell } from '@/components/bluedesk/AppShell'
import { PageHeader } from '@/components/bluedesk/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  updateProfile,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  deleteUser,
  getDeletionPreview,
  type DeletionPreview,
} from '@/app/actions/admin'
import type { Profile, Department, Role } from '@/lib/types/database'

// Espelha o ROLES de src/app/actions/admin.ts (que valida no servidor) — as duas listas
// precisam andar juntas: sem a entrada aqui, o papel fica inatribuível pela UI.
const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'pending', label: 'Pendente' },
  { value: 'agent', label: 'Agente' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'manager', label: 'Gerente' },
  { value: 'admin', label: 'Admin' },
  { value: 'ceo', label: 'CEO' },
  { value: 'tester', label: 'Tester' },
]

// estilo compartilhado para selects/inputs nativos
const fieldClass =
  'w-full rounded-lg border border-input bg-transparent px-2 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15'

type Tab = 'users' | 'departments'

interface Props {
  profiles: Profile[]
  departments: Department[]
  // Id de quem esta com o /admin aberto, so para nao oferecer "Excluir" na propria
  // linha (a Server Action recusa de qualquer jeito — isto evita o botao sem saida).
  currentUserId: string | null
}

export function AdminClient({ profiles, departments, currentUserId }: Props) {
  const [tab, setTab] = useState<Tab>('users')

  return (
    <AppShell>
      <PageHeader title="Administração" description="Usuários, papéis, ramais e departamentos." />

      <div className="mx-auto max-w-3xl space-y-5">
        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card/60 p-0.5 shadow-card">
          {(['users', 'departments'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
                tab === t
                  ? 'bg-gradient-primary text-primary-foreground shadow-glow'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t === 'users' ? 'Usuários' : 'Departamentos'}
            </button>
          ))}
        </div>

        {tab === 'users' ? (
          <UsersTab profiles={profiles} departments={departments} currentUserId={currentUserId} />
        ) : (
          <DepartmentsTab departments={departments} />
        )}
      </div>
    </AppShell>
  )
}

// ─── Usuários ────────────────────────────────────────────────────────────────

function UsersTab({ profiles, departments, currentUserId }: Props) {
  const pending = profiles.filter((p) => p.role === 'pending')
  const others = profiles.filter((p) => p.role !== 'pending')

  return (
    <div className="space-y-5">
      {pending.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            Aguardando aprovação <span className="text-warning">({pending.length})</span>
          </h2>
          <div className="space-y-2">
            {pending.map((p) => (
              <UserRow
                key={p.id}
                profile={p}
                departments={departments}
                currentUserId={currentUserId}
                highlight
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold text-foreground">
          Usuários <span className="text-muted-foreground">({others.length})</span>
        </h2>
        {others.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">Nenhum usuário aprovado ainda.</p>
        ) : (
          <div className="space-y-2">
            {others.map((p) => (
              <UserRow
                key={p.id}
                profile={p}
                departments={departments}
                currentUserId={currentUserId}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function UserRow({
  profile,
  departments,
  currentUserId,
  highlight,
}: {
  profile: Profile
  departments: Department[]
  currentUserId: string | null
  highlight?: boolean
}) {
  const router = useRouter()
  const [role, setRole] = useState<Role>(profile.role)
  const [departmentId, setDepartmentId] = useState<string>(profile.department_id ?? '')
  const [extension, setExtension] = useState<string>(
    profile.extension != null ? String(profile.extension) : ''
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const dirty =
    role !== profile.role ||
    departmentId !== (profile.department_id ?? '') ||
    extension !== (profile.extension != null ? String(profile.extension) : '')

  const handleSave = async () => {
    setSaving(true)
    setError('')
    const result = await updateProfile(profile.id, {
      role,
      department_id: departmentId || null,
      extension: extension ? Number(extension) : null,
    })
    setSaving(false)
    if (result.error) {
      setError(result.error)
    } else {
      router.refresh()
    }
  }

  return (
    <div
      className={cn(
        'rounded-2xl border bg-gradient-card p-4 shadow-card',
        highlight ? 'border-warning/50' : 'border-border'
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{profile.name}</p>
          <p className="truncate text-xs text-muted-foreground">{profile.email ?? '—'}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !dirty}
            className="bg-primary hover:bg-primary/90"
          >
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
          {profile.id !== currentUserId && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmingDelete(true)}
              title="Excluir usuário"
              aria-label={`Excluir ${profile.name}`}
              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="mb-1 block text-[11px] text-muted-foreground">Papel</label>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} className={fieldClass}>
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-muted-foreground">Departamento</label>
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={fieldClass}>
            <option value="">—</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-muted-foreground">Ramal</label>
          <input
            type="number"
            min={5125}
            max={5150}
            value={extension}
            onChange={(e) => setExtension(e.target.value)}
            placeholder="—"
            className={fieldClass}
          />
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <DeleteUserDialog
        profile={profile}
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
      />
    </div>
  )
}

// ─── Exclusão de usuário ──────────────────────────────────────────────────────────
//
// Diálogo de confirmação em duas travas: o admin vê o impacto REAL (levantado no
// servidor, não estimado aqui) e só então consegue habilitar o botão, digitando o
// e-mail da pessoa. Exclusão de conta não tem desfazer — um "tem certeza?" comum
// vira reflexo depois da terceira vez.
function DeleteUserDialog({
  profile,
  open,
  onOpenChange,
}: {
  profile: Profile
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [preview, setPreview] = useState<DeletionPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [typed, setTyped] = useState('')

  // Quem não tem e-mail no perfil confirma pelo nome — a trava não pode ficar
  // impossível de satisfazer.
  const expected = profile.email ?? profile.name
  const confirmed = typed.trim().toLowerCase() === expected.toLowerCase()

  useEffect(() => {
    if (!open) return
    // Estado zerado a cada abertura: sem isso, reabrir depois de um erro mostraria a
    // mensagem velha com o campo já preenchido — ou seja, um clique só para excluir.
    setPreview(null)
    setError('')
    setTyped('')
    setLoading(true)

    let active = true
    getDeletionPreview(profile.id).then((result) => {
      if (!active) return
      setLoading(false)
      if (result.error) setError(result.error)
      else setPreview(result.preview ?? null)
    })
    return () => {
      active = false
    }
  }, [open, profile.id])

  const blocked = (preview?.ownedProjects.length ?? 0) > 0

  const handleDelete = async () => {
    setDeleting(true)
    setError('')
    const result = await deleteUser(profile.id)
    setDeleting(false)
    if (result.error) {
      setError(result.error)
      return
    }
    onOpenChange(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Excluir {profile.name}?</DialogTitle>
          <DialogDescription>
            A conta é apagada de vez e a pessoa perde o acesso na hora. Não há como desfazer.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="h-24 animate-pulse rounded-lg border border-border bg-card/60" />
        ) : preview ? (
          <div className="space-y-3 text-sm">
            {blocked ? (
              <div className="rounded-lg border border-warning/50 bg-warning/10 p-3">
                <p className="font-medium text-foreground">
                  Não dá para excluir ainda: é dono de {preview.ownedProjects.length} projeto(s).
                </p>
                <p className="mt-1 text-muted-foreground">
                  Excluir levaria junto os quadros, tarefas e comentários de todo mundo
                  nesses projetos. Transfira a propriedade primeiro (botão &ldquo;Transferir&rdquo;,
                  na página do projeto).
                </p>
                <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
                  {preview.ownedProjects.slice(0, 5).map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                  {preview.ownedProjects.length > 5 && (
                    <li>e mais {preview.ownedProjects.length - 5}</li>
                  )}
                </ul>
              </div>
            ) : (
              <>
                <div className="rounded-lg border border-border bg-card/60 p-3">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    O histórico fica
                  </p>
                  <p className="text-muted-foreground">
                    {preview.callLogs} ligação(ões) e {preview.assignedTasks} tarefa(s)
                    continuam nos painéis — só deixam de ter autor.
                  </p>
                </div>
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-destructive">
                    Some junto
                  </p>
                  <p className="text-muted-foreground">
                    {preview.quickTasks} tarefa(s) rápida(s) da lista pessoal, as
                    notificações e os vínculos com campanhas e projetos.
                  </p>
                </div>

                <div className="space-y-2 pt-1">
                  <Label htmlFor={`confirm-${profile.id}`} className="text-xs">
                    Digite <span className="font-medium text-foreground">{expected}</span> para
                    confirmar
                  </Label>
                  <Input
                    id={`confirm-${profile.id}`}
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    autoComplete="off"
                    placeholder={expected}
                  />
                </div>
              </>
            )}
          </div>
        ) : null}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={deleting}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting || loading || blocked || !confirmed}
          >
            {deleting ? 'Excluindo...' : 'Excluir definitivamente'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Departamentos ─────────────────────────────────────────────────────────────

function DepartmentsTab({ departments }: { departments: Department[] }) {
  const router = useRouter()
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    setError('')
    const result = await createDepartment(newName)
    setCreating(false)
    if (result.error) {
      setError(result.error)
    } else {
      setNewName('')
      router.refresh()
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border bg-gradient-card p-5 shadow-card">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Novo departamento</h2>
        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Nome do departamento"
            className="flex-1"
          />
          <Button
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            className="bg-primary hover:bg-primary/90"
          >
            <Plus className="mr-2 h-4 w-4" /> Adicionar
          </Button>
        </div>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </section>

      <div className="space-y-2">
        {departments.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">Nenhum departamento cadastrado.</p>
        ) : (
          departments.map((d) => <DepartmentRow key={d.id} department={d} />)
        )}
      </div>
    </div>
  )
}

function DepartmentRow({ department }: { department: Department }) {
  const router = useRouter()
  const [name, setName] = useState(department.name)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')

  const handleRename = async () => {
    if (name.trim() === department.name || !name.trim()) return
    setBusy(true)
    setError('')
    const result = await updateDepartment(department.id, name)
    setBusy(false)
    if (result.error) setError(result.error)
    else router.refresh()
  }

  const handleDelete = async () => {
    setBusy(true)
    setError('')
    const result = await deleteDepartment(department.id)
    setBusy(false)
    if (result.error) setError(result.error)
    else router.refresh()
  }

  return (
    <div className="rounded-2xl border border-border bg-gradient-card p-3 shadow-card">
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleRename}
          onKeyDown={(e) => e.key === 'Enter' && handleRename()}
          className="flex-1 rounded-lg border border-input bg-transparent px-3 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
        />
        {confirming ? (
          <>
            <button
              onClick={handleDelete}
              disabled={busy}
              className="px-2 text-xs font-semibold text-destructive transition-colors hover:text-destructive/80"
            >
              Confirmar
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="px-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Cancelar
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            disabled={busy}
            className="px-2 text-xs text-muted-foreground transition-colors hover:text-destructive"
          >
            Excluir
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  )
}
