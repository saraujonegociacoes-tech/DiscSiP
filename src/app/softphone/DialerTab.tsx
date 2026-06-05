'use client'

import { useState, useEffect, useCallback } from 'react'
import { useDialerStore } from '@/store/dialerStore'
import { usePowerDialer } from '@/hooks/usePowerDialer'
import { useSoftphoneStore } from '@/store/softphoneStore'
import {
  getCampaigns,
  createCampaign,
  addContactsToCampaign,
  getCampaignStats,
  updateCampaignStatus,
} from '@/app/actions/campaigns'
import type { Campaign, ContactStatus } from '@/lib/types/database'

const DISPOSITIONS: Array<{ label: string; status: ContactStatus; value: string }> = [
  { label: 'Interessado', status: 'answered', value: 'interested' },
  { label: 'Sem Interesse', status: 'answered', value: 'not_interested' },
  { label: 'Ligar Depois', status: 'no_answer', value: 'callback' },
  { label: 'Não Atendeu', status: 'no_answer', value: 'no_answer' },
  { label: 'Ocupado', status: 'busy', value: 'busy' },
  { label: 'Não Perturbe', status: 'do_not_call', value: 'do_not_call' },
]

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  active: 'Ativa',
  paused: 'Pausada',
  completed: 'Concluída',
}

const STATUS_COLOR: Record<string, string> = {
  draft: 'text-slate-400',
  active: 'text-green-400',
  paused: 'text-yellow-400',
  completed: 'text-blue-400',
}

interface DialerTabProps {
  onCall: (phoneNumber: string) => Promise<void>
}

type View = 'list' | 'campaign'

export function DialerTab({ onCall }: DialerTabProps) {
  const {
    campaign,
    currentContact,
    dialerStatus,
    pendingDisposition,
    pauseBetweenCalls,
    setCampaign,
    setPauseBetweenCalls,
  } = useDialerStore()
  const { sipStatus, callStatus, callNumber } = useSoftphoneStore()
  const { start, pause, resume, submitDisposition } = usePowerDialer({ onCall })

  const [view, setView] = useState<View>('list')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loadingCampaigns, setLoadingCampaigns] = useState(true)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [showAddContacts, setShowAddContacts] = useState(false)
  const [contactsText, setContactsText] = useState('')
  const [addingContacts, setAddingContacts] = useState(false)
  const [addResult, setAddResult] = useState<string | null>(null)
  const [stats, setStats] = useState<Record<string, number> | null>(null)

  const loadCampaigns = useCallback(async () => {
    setLoadingCampaigns(true)
    setCampaigns(await getCampaigns())
    setLoadingCampaigns(false)
  }, [])

  useEffect(() => { loadCampaigns() }, [loadCampaigns])

  const refreshStats = useCallback(async () => {
    if (campaign) setStats(await getCampaignStats(campaign.id))
  }, [campaign])

  useEffect(() => { refreshStats() }, [refreshStats, dialerStatus, pendingDisposition])

  const handleSelect = (c: Campaign) => {
    setCampaign(c)
    setView('campaign')
    getCampaignStats(c.id).then(setStats)
  }

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    const result = await createCampaign(newName.trim())
    setCreating(false)
    if ('error' in result) return
    setNewName('')
    await loadCampaigns()
    handleSelect(result)
  }

  const handleAddContacts = async () => {
    if (!campaign || !contactsText.trim()) return
    setAddingContacts(true)
    const result = await addContactsToCampaign(campaign.id, contactsText.split('\n'))
    setAddingContacts(false)
    if (result.error) {
      setAddResult(`Erro: ${result.error}`)
    } else {
      setAddResult(`${result.added} contatos adicionados`)
      setContactsText('')
      setShowAddContacts(false)
      refreshStats()
    }
    setTimeout(() => setAddResult(null), 4000)
  }

  const handleStart = async () => {
    if (!campaign) return
    await updateCampaignStatus(campaign.id, 'active')
    await start()
  }

  // ─── Lista de campanhas ──────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div className="max-w-lg mx-auto">
        <h2 className="text-white font-semibold mb-5">Campanhas</h2>

        {/* Criar campanha */}
        <div className="bg-[#111827] border border-slate-700/60 rounded-2xl p-4 mb-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="Nome da nova campanha"
              className="flex-1 bg-[#1a2234] border border-slate-600 rounded-xl px-3 py-2.5 text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500 transition-colors text-sm"
            />
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white px-4 rounded-xl text-sm font-medium transition-colors"
            >
              {creating ? '...' : 'Criar'}
            </button>
          </div>
        </div>

        {loadingCampaigns ? (
          <p className="text-slate-500 text-sm text-center py-6">Carregando...</p>
        ) : campaigns.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-6">Nenhuma campanha criada.</p>
        ) : (
          <div className="space-y-2">
            {campaigns.map((c) => (
              <button
                key={c.id}
                onClick={() => handleSelect(c)}
                className="w-full flex items-center justify-between bg-[#111827] border border-slate-800 hover:border-slate-600 rounded-xl px-4 py-3 transition-colors text-left group"
              >
                <div>
                  <p className="text-white text-sm font-medium">{c.name}</p>
                  <p className={`text-xs mt-0.5 ${STATUS_COLOR[c.status]}`}>
                    {STATUS_LABEL[c.status]}
                  </p>
                </div>
                <span className="text-slate-600 group-hover:text-slate-400 text-lg transition-colors">›</span>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ─── Campanha selecionada ────────────────────────────────────────────────────
  return (
    <div className="max-w-lg mx-auto space-y-3">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => { setView('list'); setCampaign(null) }}
          className="text-slate-400 hover:text-white transition-colors text-sm shrink-0"
        >
          ← Campanhas
        </button>
        <span className="text-slate-700">/</span>
        <h2 className="text-white font-semibold truncate">{campaign?.name}</h2>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Total', key: 'total', color: 'text-white' },
            { label: 'Pendentes', key: 'pending', color: 'text-blue-400' },
            { label: 'Atendidas', key: 'answered', color: 'text-green-400' },
            { label: 'Não Atend.', key: 'no_answer', color: 'text-yellow-400' },
          ].map((s) => (
            <div
              key={s.key}
              className="bg-[#111827] border border-slate-800 rounded-xl p-3 text-center"
            >
              <p className={`text-2xl font-bold tabular-nums ${s.color}`}>
                {stats[s.key] ?? 0}
              </p>
              <p className="text-slate-500 text-xs mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Disposição após chamada */}
      {pendingDisposition && (
        <div className="bg-[#111827] border border-blue-500/40 rounded-2xl p-5">
          <p className="text-blue-400 text-xs font-medium uppercase tracking-wider mb-3">
            Resultado — {callNumber ?? currentContact?.phone_number}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {DISPOSITIONS.map((d) => (
              <button
                key={d.value}
                onClick={() => submitDisposition(d.status, d.value)}
                className="bg-[#1a2234] hover:bg-slate-700 active:scale-95 text-white text-sm py-3 px-3 rounded-xl transition-all text-left"
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Contato atual */}
      {currentContact && dialerStatus === 'running' && !pendingDisposition && (
        <div className="bg-[#111827] border border-slate-700/60 rounded-2xl p-4">
          <p className="text-slate-400 text-xs uppercase tracking-wider mb-2">Contato atual</p>
          {currentContact.name && (
            <p className="text-white font-medium">{currentContact.name}</p>
          )}
          <p className="text-blue-400 font-mono text-lg">{currentContact.phone_number}</p>
          <p className="text-xs mt-1.5">
            {callStatus === 'ringing' && (
              <span className="text-yellow-400 animate-pulse">Chamando...</span>
            )}
            {callStatus === 'answered' && (
              <span className="text-green-400">Em chamada</span>
            )}
            {(callStatus === 'idle' || callStatus === 'ended') && (
              <span className="text-slate-500">Aguardando próximo...</span>
            )}
          </p>
        </div>
      )}

      {/* Controles */}
      <div className="bg-[#111827] border border-slate-700/60 rounded-2xl p-4">
        <div className="flex gap-2">
          {dialerStatus === 'idle' && (
            <button
              onClick={handleStart}
              disabled={sipStatus !== 'registered' || !stats || stats.pending === 0}
              className="flex-1 bg-green-600 hover:bg-green-500 active:bg-green-700 disabled:bg-slate-700 disabled:text-slate-500 text-white py-3 rounded-xl font-semibold text-sm transition-colors"
            >
              ▶ Iniciar discagem
            </button>
          )}
          {dialerStatus === 'running' && !pendingDisposition && (
            <button
              onClick={pause}
              className="flex-1 bg-yellow-600 hover:bg-yellow-500 active:bg-yellow-700 text-white py-3 rounded-xl font-semibold text-sm transition-colors"
            >
              ⏸ Pausar
            </button>
          )}
          {dialerStatus === 'paused' && (
            <button
              onClick={resume}
              disabled={sipStatus !== 'registered'}
              className="flex-1 bg-green-600 hover:bg-green-500 disabled:bg-slate-700 disabled:text-slate-500 text-white py-3 rounded-xl font-semibold text-sm transition-colors"
            >
              ▶ Retomar
            </button>
          )}
          {dialerStatus === 'completed' && (
            <div className="flex-1 text-center py-3 text-green-400 font-medium text-sm">
              ✓ Campanha concluída
            </div>
          )}
        </div>

        {(dialerStatus === 'idle' || dialerStatus === 'paused') && (
          <div className="flex items-center gap-3 mt-3">
            <label className="text-xs text-slate-400 whitespace-nowrap shrink-0">
              Pausa entre chamadas
            </label>
            <input
              type="range"
              min={1}
              max={30}
              value={pauseBetweenCalls}
              onChange={(e) => setPauseBetweenCalls(Number(e.target.value))}
              className="flex-1 accent-blue-500"
            />
            <span className="text-blue-400 text-sm tabular-nums w-8 text-right">
              {pauseBetweenCalls}s
            </span>
          </div>
        )}
      </div>

      {/* Adicionar contatos */}
      <div className="bg-[#111827] border border-slate-700/60 rounded-2xl p-4">
        <button
          onClick={() => setShowAddContacts((v) => !v)}
          className="w-full flex items-center justify-between text-sm text-slate-400 hover:text-white transition-colors"
        >
          <span>+ Adicionar contatos</span>
          <span className="text-slate-600 text-xs">{showAddContacts ? '▲' : '▼'}</span>
        </button>

        {showAddContacts && (
          <div className="mt-3">
            <p className="text-xs text-slate-500 mb-2">
              Um por linha:{' '}
              <code className="text-slate-400">Número</code>
              {' '}ou{' '}
              <code className="text-slate-400">Nome,Número</code>
            </p>
            <textarea
              value={contactsText}
              onChange={(e) => setContactsText(e.target.value)}
              placeholder={'11987654321\nMaria Silva,11976543210'}
              rows={5}
              className="w-full bg-[#1a2234] border border-slate-600 rounded-xl px-3 py-2.5 text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500 transition-colors text-sm font-mono resize-none"
            />
            {addResult && (
              <p className={`text-xs mt-1.5 ${addResult.startsWith('Erro') ? 'text-red-400' : 'text-green-400'}`}>
                {addResult}
              </p>
            )}
            <button
              onClick={handleAddContacts}
              disabled={addingContacts || !contactsText.trim()}
              className="w-full mt-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white py-2.5 rounded-xl text-sm font-medium transition-colors"
            >
              {addingContacts ? 'Adicionando...' : 'Adicionar'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
