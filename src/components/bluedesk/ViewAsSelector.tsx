'use client'

import { Eye } from 'lucide-react'
import { useSoftphoneStore } from '@/store/softphoneStore'
import type { Role } from '@/lib/types/database'

// Seletor "ver como" — SÓ aparece para o papel real 'tester'. Troca a NAVEGAÇÃO (menu +
// gates de página no cliente) para simular como cada papel/departamento enxerga o app, sem
// trocar de conta e sem alterar os dados reais (a impersonação vive no softphoneStore e é
// lida pela Sidebar). Para os demais papéis, renderiza null (custo zero).
const PRESETS: { key: string; label: string; role: Role | null; slug: string | null }[] = [
  { key: 'self', label: 'Tester (acesso total)', role: null, slug: null },
  { key: 'agent-comercial', label: 'Agente · Comercial', role: 'agent', slug: 'comercial' },
  { key: 'agent-cs', label: 'Agente · Sucesso do Cliente', role: 'agent', slug: 'cs' },
  { key: 'agent-negociacao', label: 'Agente · Negociação', role: 'agent', slug: 'negociacao' },
  { key: 'agent-juridico', label: 'Agente · Jurídico', role: 'agent', slug: 'juridico' },
  { key: 'supervisor-comercial', label: 'Supervisor · Comercial', role: 'supervisor', slug: 'comercial' },
  { key: 'manager', label: 'Gerente', role: 'manager', slug: null },
  { key: 'admin', label: 'Admin', role: 'admin', slug: null },
  { key: 'ceo', label: 'CEO', role: 'ceo', slug: null },
]

export function ViewAsSelector() {
  const { role, viewAsRole, viewAsSlug, setViewAs } = useSoftphoneStore()
  if (role !== 'tester') return null

  const currentKey = viewAsRole
    ? (PRESETS.find((p) => p.role === viewAsRole && p.slug === viewAsSlug)?.key ?? 'self')
    : 'self'

  return (
    <label className="flex items-center gap-1.5 rounded-lg border border-border bg-background/60 px-2 py-1 text-xs text-muted-foreground">
      <Eye className="h-3.5 w-3.5 text-primary" />
      <span className="hidden sm:inline">Ver como</span>
      <select
        aria-label="Ver como (visão de teste)"
        value={currentKey}
        onChange={(e) => {
          const p = PRESETS.find((x) => x.key === e.target.value)
          if (p) setViewAs(p.role, p.slug)
        }}
        className="bg-transparent text-xs font-medium text-foreground outline-none"
      >
        {PRESETS.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  )
}
