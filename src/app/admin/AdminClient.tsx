'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sidebar } from '@/components/Sidebar'
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

type Tab = 'users' | 'departments'

interface Props {
  profiles: Profile[]
  departments: Department[]
}

export function AdminClient({ profiles, departments }: Props) {
  const [tab, setTab] = useState<Tab>('users')

  return (
    <div className="min-h-screen bg-[#0f172a] flex">
      <Sidebar />
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="max-w-3xl mx-auto space-y-5">
          <div className="flex items-center gap-1">
            {(['users', 'departments'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  tab === t ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
                }`}
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
      </div>
    </div>
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
          <h2 className="text-white text-sm font-medium mb-3">
            Aguardando aprovação <span className="text-yellow-400">({pending.length})</span>
          </h2>
          <div className="space-y-2">
            {pending.map((p) => (
              <UserRow key={p.id} profile={p} departments={departments} highlight />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-white text-sm font-medium mb-3">
          Usuários <span className="text-slate-500">({others.length})</span>
        </h2>
        {others.length === 0 ? (
          <p className="text-slate-500 text-sm py-2">Nenhum usuário aprovado ainda.</p>
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
      className={`bg-[#1e293b] border rounded-xl p-4 ${
        highlight ? 'border-yellow-700/50' : 'border-slate-800'
      }`}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-white text-sm font-medium truncate">{profile.name}</p>
          <p className="text-slate-500 text-xs truncate">{profile.email ?? '—'}</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="shrink-0 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="block text-[11px] text-slate-500 mb-1">Papel</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="w-full bg-[#111827] border border-slate-700 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-1">Departamento</label>
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="w-full bg-[#111827] border border-slate-700 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"
          >
            <option value="">—</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-1">Ramal</label>
          <input
            type="number"
            min={5125}
            max={5150}
            value={extension}
            onChange={(e) => setExtension(e.target.value)}
            placeholder="—"
            className="w-full bg-[#111827] border border-slate-700 rounded-lg px-2 py-1.5 text-white text-sm placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
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
      <section className="bg-[#1e293b] border border-slate-700/60 rounded-2xl p-5">
        <h2 className="text-white text-sm font-medium mb-3">Novo departamento</h2>
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Nome do departamento"
            className="flex-1 bg-[#111827] border border-slate-600 rounded-xl px-3 py-2.5 text-white text-sm placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-semibold px-5 rounded-xl transition-colors"
          >
            Adicionar
          </button>
        </div>
        {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
      </section>

      <div className="space-y-2">
        {departments.length === 0 ? (
          <p className="text-slate-500 text-sm py-2">Nenhum departamento cadastrado.</p>
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
    <div className="bg-[#1e293b] border border-slate-800 rounded-xl p-3">
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleRename}
          onKeyDown={(e) => e.key === 'Enter' && handleRename()}
          className="flex-1 bg-[#111827] border border-slate-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"
        />
        {confirming ? (
          <>
            <button
              onClick={handleDelete}
              disabled={busy}
              className="text-red-400 hover:text-red-300 text-xs font-semibold px-2 transition-colors"
            >
              Confirmar
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="text-slate-500 hover:text-slate-300 text-xs px-1 transition-colors"
            >
              Cancelar
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            disabled={busy}
            className="text-slate-500 hover:text-red-400 text-xs px-2 transition-colors"
          >
            Excluir
          </button>
        )}
      </div>
      {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
    </div>
  )
}
