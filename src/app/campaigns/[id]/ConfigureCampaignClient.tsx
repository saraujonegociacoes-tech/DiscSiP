'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { AppShell } from '@/components/blueline/AppShell'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { updateCampaignConfig, setCampaignAgents } from '@/app/actions/campaigns'
import { ListsSection } from './ListsSection'
import { DISPOSITIONS } from '@/lib/dispositions'
import type { Profile, Campaign, List, Department } from '@/lib/types/database'

// Campos base que existem em toda campanha. Campos extras vêm das listas (column_mapping).
const BASE_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'name', label: 'Nome' },
  { key: 'phone_number', label: 'Telefone' },
]

// 'HH:MM:SS' (Postgres time) → 'HH:MM' (input type=time)
const toInputTime = (t: string | null) => (t ? t.slice(0, 5) : '')

// estilo compartilhado para inputs nativos (select/time) coerente com o ui/Input
const fieldClass =
  'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15'

// Campos extras únicos a partir do mapeamento de colunas de todas as listas
function extraFieldsFromLists(lists: List[]): Array<{ key: string; label: string }> {
  const byKey = new Map<string, string>()
  for (const l of lists) {
    for (const ex of l.column_mapping?.extras ?? []) {
      if (!byKey.has(ex.key)) byKey.set(ex.key, ex.label)
    }
  }
  return [...byKey].map(([key, label]) => ({ key, label }))
}

interface Props {
  campaign: Campaign
  initialAgentIds: string[]
  agents: Pick<Profile, 'id' | 'name' | 'extension'>[]
  departments: Department[]
  initialLists: List[]
}

export function ConfigureCampaignClient({
  campaign,
  initialAgentIds,
  agents,
  departments,
  initialLists,
}: Props) {
  const [lists, setLists] = useState<List[]>(initialLists)
  const extraFields = extraFieldsFromLists(lists)
  const [departmentId, setDepartmentId] = useState<string>(campaign.department_id ?? '')
  const [start, setStart] = useState(toInputTime(campaign.schedule_start))
  const [end, setEnd] = useState(toInputTime(campaign.schedule_end))
  const [visibleFields, setVisibleFields] = useState<string[]>(
    campaign.visible_fields ?? ['name', 'phone_number']
  )
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(
    new Set(initialAgentIds)
  )
  const [notifyDispositions, setNotifyDispositions] = useState<string[]>(
    campaign.notify_dispositions ?? []
  )
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  const toggleField = (key: string) =>
    setVisibleFields((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    )

  const toggleNotify = (value: string) =>
    setNotifyDispositions((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    )

  const toggleAgent = (id: string) =>
    setSelectedAgents((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const allSelected = selectedAgents.size === agents.length && agents.length > 0
  const toggleAll = () =>
    setSelectedAgents(allSelected ? new Set() : new Set(agents.map((a) => a.id)))

  const handleSave = async () => {
    setSaving(true)
    setMessage(null)

    const configResult = await updateCampaignConfig(campaign.id, {
      department_id: departmentId || null,
      schedule_start: start || null,
      schedule_end: end || null,
      visible_fields: visibleFields,
      notify_dispositions: notifyDispositions,
    })
    const agentsResult = await setCampaignAgents(campaign.id, [...selectedAgents])

    setSaving(false)
    const err = configResult.error || agentsResult.error
    if (err) {
      setMessage({ type: 'error', text: `Erro ao salvar: ${err}` })
    } else {
      setMessage({ type: 'ok', text: 'Configuração salva.' })
      setTimeout(() => setMessage(null), 3000)
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-5">
        {/* Header */}
        <div>
          <Link
            href="/campaigns"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Campanhas
          </Link>
          <h1 className="mt-2 truncate text-2xl font-semibold tracking-tight text-foreground">
            {campaign.name}
          </h1>
        </div>

        {/* Departamento */}
        <section className="rounded-2xl border border-border bg-gradient-card p-5 shadow-card">
          <h2 className="text-sm font-semibold text-foreground">Departamento</h2>
          <p className="mb-4 mt-1 text-xs text-muted-foreground">
            Define qual supervisor enxerga e gerencia esta campanha.
          </p>
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className={fieldClass}
          >
            <option value="">Sem departamento</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </section>

        {/* Horário de funcionamento */}
        <section className="rounded-2xl border border-border bg-gradient-card p-5 shadow-card">
          <h2 className="text-sm font-semibold text-foreground">Horário de funcionamento</h2>
          <p className="mb-4 mt-1 text-xs text-muted-foreground">
            Fora desse horário a discagem fica bloqueada. Deixe em branco para sem restrição.
          </p>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="mb-1.5 block text-xs text-muted-foreground">Início</label>
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={fieldClass} />
            </div>
            <span className="mt-5 text-muted-foreground">—</span>
            <div className="flex-1">
              <label className="mb-1.5 block text-xs text-muted-foreground">Fim</label>
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={fieldClass} />
            </div>
          </div>
        </section>

        {/* Campos visíveis ao agente */}
        <section className="rounded-2xl border border-border bg-gradient-card p-5 shadow-card">
          <h2 className="text-sm font-semibold text-foreground">Campos visíveis ao agente</h2>
          <p className="mb-4 mt-1 text-xs text-muted-foreground">
            O que o agente vê na tela durante a ligação. Campos extras das listas aparecem
            aqui após o upload do mailing.
          </p>
          <div className="flex flex-wrap gap-2">
            {[...BASE_FIELDS, ...extraFields].map((f) => {
              const on = visibleFields.includes(f.key)
              return (
                <button
                  key={f.key}
                  onClick={() => toggleField(f.key)}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                    on
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background/40 text-muted-foreground hover:text-foreground'
                  )}
                >
                  {f.label}
                </button>
              )
            })}
          </div>
        </section>

        {/* Agentes participantes */}
        <section className="rounded-2xl border border-border bg-gradient-card p-5 shadow-card">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Agentes participantes</h2>
            <button
              onClick={toggleAll}
              className="text-xs text-primary transition-colors hover:underline"
            >
              {allSelected ? 'Limpar' : 'Selecionar todos'}
            </button>
          </div>
          <p className="mb-4 text-xs text-muted-foreground">
            {selectedAgents.size} de {agents.length} selecionados — só eles verão e discarão esta campanha.
          </p>
          {agents.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">Nenhum agente cadastrado.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {agents.map((a) => {
                const on = selectedAgents.has(a.id)
                return (
                  <button
                    key={a.id}
                    onClick={() => toggleAgent(a.id)}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                      on
                        ? 'border-primary/60 bg-primary/15 text-foreground'
                        : 'border-border bg-background/40 text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <span
                      className={cn('h-1.5 w-1.5 shrink-0 rounded-full', on ? 'bg-primary' : 'bg-muted-foreground')}
                    />
                    <span className="truncate">{a.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {a.extension ? `#${a.extension}` : 'sem ramal'}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        {/* Notificações (Make) */}
        <section className="rounded-2xl border border-border bg-gradient-card p-5 shadow-card">
          <h2 className="text-sm font-semibold text-foreground">Notificar o gerente</h2>
          <p className="mb-4 mt-1 text-xs text-muted-foreground">
            Ao registrar um destes resultados, o Blue Line envia os dados do lead ao Make
            (que dispara email/WhatsApp). Nenhum selecionado = sem notificação.
          </p>
          <div className="flex flex-wrap gap-2">
            {DISPOSITIONS.map((d) => {
              const on = notifyDispositions.includes(d.value)
              return (
                <button
                  key={d.value}
                  onClick={() => toggleNotify(d.value)}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                    on
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background/40 text-muted-foreground hover:text-foreground'
                  )}
                >
                  {d.label}
                </button>
              )
            })}
          </div>
        </section>

        {/* Listas (mailing) */}
        <ListsSection campaignId={campaign.id} lists={lists} onListsChange={setLists} />

        {/* Salvar */}
        <div className="sticky bottom-0 -mx-1 flex items-center gap-3 bg-background/80 py-3 backdrop-blur">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-primary px-6 hover:bg-primary/90"
          >
            {saving ? 'Salvando...' : 'Salvar configuração'}
          </Button>
          {message && (
            <span className={cn('text-sm', message.type === 'ok' ? 'text-success' : 'text-destructive')}>
              {message.text}
            </span>
          )}
        </div>
      </div>
    </AppShell>
  )
}
