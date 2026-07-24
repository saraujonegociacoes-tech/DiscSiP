'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { AppShell } from '@/components/bluedesk/AppShell'
import { PageHeader } from '@/components/bluedesk/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  updateProfile,
  createDepartment,
  updateDepartment,
  deleteDepartment,
} from '@/app/actions/admin'
import type { Profile, Department, Role } from '@/lib/types/database'

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'pending', label: 'Pendente' },
  { value: 'agent', label: 'Agente' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'manager', label: 'Gerente' },
  { value: 'admin', label: 'Admin' },
]

// estilo compartilhado para selects/inputs nativos
const fieldClass =
  'w-full rounded-lg border border-input bg-transparent px-2 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15'

type Tab = 'users' | 'departments'

interface Props {
  profiles: Profile[]
  departments: Department[]
}

export function AdminClient({ profiles, departments }: Props) {
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
          <UsersTab profiles={profiles} departments={departments} />
        ) : (
          <DepartmentsTab departments={departments} />
        )}
      </div>
    </AppShell>
  )
}

// ─── Usuários ────────────────────────────────────────────────────────────────

function UsersTab({ profiles, departments }: Props) {
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
              <UserRow key={p.id} profile={p} departments={departments} highlight />
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
              <UserRow key={p.id} profile={p} departments={departments} />
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
  highlight,
}: {
  profile: Profile
  departments: Department[]
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
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving || !dirty}
          className="shrink-0 bg-primary hover:bg-primary/90"
        >
          {saving ? 'Salvando...' : 'Salvar'}
        </Button>
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
    </div>
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
