'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Sidebar } from '@/components/Sidebar'
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
    <div className="min-h-screen bg-[#0f172a] flex">
      <Sidebar />
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="max-w-2xl mx-auto space-y-5">
          {/* Header */}
          <div className="flex items-center gap-3">
            <Link
              href="/campaigns"
              className="text-slate-400 hover:text-white transition-colors text-sm shrink-0"
            >
              ← Campanhas
            </Link>
            <span className="text-slate-700">/</span>
            <h1 className="text-white font-semibold truncate">{campaign.name}</h1>
          </div>

          {/* Departamento */}
          <section className="bg-[#1e293b] border border-slate-700/60 rounded-2xl p-5">
            <h2 className="text-white text-sm font-medium">Departamento</h2>
            <p className="text-slate-500 text-xs mt-1 mb-4">
              Define qual supervisor enxerga e gerencia esta campanha.
            </p>
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="w-full bg-[#111827] border border-slate-600 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors text-sm"
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
          <section className="bg-[#1e293b] border border-slate-700/60 rounded-2xl p-5">
            <h2 className="text-white text-sm font-medium">Horário de funcionamento</h2>
            <p className="text-slate-500 text-xs mt-1 mb-4">
              Fora desse horário a discagem fica bloqueada. Deixe em branco para sem restrição.
            </p>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="block text-xs text-slate-400 mb-1.5">Início</label>
                <input
                  type="time"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  className="w-full bg-[#111827] border border-slate-600 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors text-sm"
                />
              </div>
              <span className="text-slate-600 mt-5">—</span>
              <div className="flex-1">
                <label className="block text-xs text-slate-400 mb-1.5">Fim</label>
                <input
                  type="time"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  className="w-full bg-[#111827] border border-slate-600 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors text-sm"
                />
              </div>
            </div>
          </section>

          {/* Campos visíveis ao agente */}
          <section className="bg-[#1e293b] border border-slate-700/60 rounded-2xl p-5">
            <h2 className="text-white text-sm font-medium">Campos visíveis ao agente</h2>
            <p className="text-slate-500 text-xs mt-1 mb-4">
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
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                      on
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'bg-[#111827] border-slate-700 text-slate-400 hover:text-white'
                    }`}
                  >
                    {f.label}
                  </button>
                )
              })}
            </div>
          </section>

          {/* Agentes participantes */}
          <section className="bg-[#1e293b] border border-slate-700/60 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-white text-sm font-medium">Agentes participantes</h2>
              <button
                onClick={toggleAll}
                className="text-blue-400 hover:text-blue-300 text-xs transition-colors"
              >
                {allSelected ? 'Limpar' : 'Selecionar todos'}
              </button>
            </div>
            <p className="text-slate-500 text-xs mb-4">
              {selectedAgents.size} de {agents.length} selecionados — só eles verão e discarão esta campanha.
            </p>
            {agents.length === 0 ? (
              <p className="text-slate-500 text-sm py-2">Nenhum agente cadastrado.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {agents.map((a) => {
                  const on = selectedAgents.has(a.id)
                  return (
                    <button
                      key={a.id}
                      onClick={() => toggleAgent(a.id)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors border text-left ${
                        on
                          ? 'bg-blue-600/20 border-blue-500/60 text-white'
                          : 'bg-[#111827] border-slate-700 text-slate-400 hover:text-white'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${on ? 'bg-blue-400' : 'bg-slate-600'}`}
                      />
                      <span className="truncate">{a.name}</span>
                      <span className="text-slate-500 text-xs ml-auto">
                        {a.extension ? `#${a.extension}` : 'sem ramal'}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </section>

          {/* Notificações (Make) */}
          <section className="bg-[#1e293b] border border-slate-700/60 rounded-2xl p-5">
            <h2 className="text-white text-sm font-medium">Notificar o gerente</h2>
            <p className="text-slate-500 text-xs mt-1 mb-4">
              Ao registrar um destes resultados, o DiscSiP envia os dados do lead ao Make
              (que dispara email/WhatsApp). Nenhum selecionado = sem notificação.
            </p>
            <div className="flex flex-wrap gap-2">
              {DISPOSITIONS.map((d) => {
                const on = notifyDispositions.includes(d.value)
                return (
                  <button
                    key={d.value}
                    onClick={() => toggleNotify(d.value)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                      on
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'bg-[#111827] border-slate-700 text-slate-400 hover:text-white'
                    }`}
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
          <div className="flex items-center gap-3 sticky bottom-0 bg-[#0f172a] py-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white px-6 py-2.5 rounded-xl text-sm font-semibold transition-colors"
            >
              {saving ? 'Salvando...' : 'Salvar configuração'}
            </button>
            {message && (
              <span
                className={`text-sm ${message.type === 'ok' ? 'text-green-400' : 'text-red-400'}`}
              >
                {message.text}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
