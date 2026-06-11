'use client'

import { useState, useEffect, useCallback } from 'react'
import { useDialerStore } from '@/store/dialerStore'
import { usePowerDialer } from '@/hooks/usePowerDialer'
import { useSoftphoneStore } from '@/store/softphoneStore'
import { getCampaignsForAgent, getCampaignStats } from '@/app/actions/campaigns'
import { getListFieldLabels } from '@/app/actions/lists'
import { DISPOSITIONS } from '@/lib/dispositions'
import type { Campaign } from '@/lib/types/database'

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

const pad = (n: number) => String(n).padStart(2, '0')

// Verifica se o horário atual está dentro da janela de funcionamento da campanha.
// start/end são 'HH:MM:SS' (ou null = sem restrição). Trata janela que vira a noite.
function isWithinSchedule(start: string | null, end: string | null): boolean {
  if (!start || !end) return true
  const d = new Date()
  const now = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return start <= end ? now >= start && now <= end : now >= start || now <= end
}

type View = 'list' | 'campaign'

export function DialerTab() {
  const {
    campaign,
    currentContact,
    dialerStatus,
    pendingDisposition,
    pauseBetweenCalls,
    setCampaign,
    setPauseBetweenCalls,
  } = useDialerStore()
  const { helperOnline, callStatus, callNumber, agentId, extension } = useSoftphoneStore()
  const { start, pause, resume, submitDisposition } = usePowerDialer()

  const [view, setView] = useState<View>('list')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loadingCampaigns, setLoadingCampaigns] = useState(true)
  const [stats, setStats] = useState<Record<string, number> | null>(null)
  const [fieldLabels, setFieldLabels] = useState<Record<string, string>>({})
  const [withinHours, setWithinHours] = useState(true)

  const loadCampaigns = useCallback(async () => {
    if (!agentId) return
    setLoadingCampaigns(true)
    setCampaigns(await getCampaignsForAgent(agentId))
    setLoadingCampaigns(false)
  }, [agentId])

  useEffect(() => { loadCampaigns() }, [loadCampaigns])

  const refreshStats = useCallback(async () => {
    if (campaign) setStats(await getCampaignStats(campaign.id))
  }, [campaign])

  useEffect(() => { refreshStats() }, [refreshStats, dialerStatus, pendingDisposition])

  // Reavalia o horário de funcionamento periodicamente
  useEffect(() => {
    const check = () =>
      setWithinHours(isWithinSchedule(campaign?.schedule_start ?? null, campaign?.schedule_end ?? null))
    check()
    const interval = setInterval(check, 30000)
    return () => clearInterval(interval)
  }, [campaign])

  const handleSelect = (c: Campaign) => {
    setCampaign(c)
    setView('campaign')
    getCampaignStats(c.id).then(setStats)
    getListFieldLabels(c.id).then(setFieldLabels)
  }

  const handleStart = async () => {
    if (!campaign || !withinHours) return
    await start()
  }

  const visibleFields = campaign?.visible_fields ?? ['name', 'phone_number']
  const extraKeys = visibleFields.filter((k) => k !== 'name' && k !== 'phone_number')

  // ─── Lista de campanhas ──────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div className="max-w-lg mx-auto">
        <h2 className="text-white font-semibold mb-5">Minhas campanhas</h2>

        {loadingCampaigns ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex items-center justify-between bg-[#1e293b] border border-slate-800 rounded-xl px-4 py-3 animate-pulse"
              >
                <div className="space-y-2">
                  <div className="h-3.5 w-32 bg-slate-700 rounded-full" />
                  <div className="h-2.5 w-16 bg-slate-800 rounded-full" />
                </div>
                <div className="h-4 w-3 bg-slate-800 rounded-full" />
              </div>
            ))}
          </div>
        ) : campaigns.length === 0 ? (
          <div className="flex flex-col items-center py-10 gap-3">
            <span className="text-4xl opacity-20">📋</span>
            <p className="text-slate-400 text-sm font-medium">Nenhuma campanha disponível</p>
            <p className="text-slate-600 text-xs text-center max-w-xs">
              Você ainda não participa de nenhuma campanha. Peça ao supervisor para adicioná-lo.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {campaigns.map((c) => (
              <button
                key={c.id}
                onClick={() => handleSelect(c)}
                className="w-full flex items-center justify-between bg-[#1e293b] border border-slate-800 hover:border-slate-600 rounded-xl px-4 py-3 transition-colors text-left group"
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
              className="bg-[#1e293b] border border-slate-800 rounded-xl p-3 text-center"
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
        <div className="bg-[#1e293b] border border-blue-500/40 rounded-2xl p-5">
          <p className="text-blue-400 text-xs font-medium uppercase tracking-wider mb-3">
            Resultado — {callNumber ?? currentContact?.phone_number}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {DISPOSITIONS.map((d) => (
              <button
                key={d.value}
                onClick={() => submitDisposition(d.status, d.value, d.label)}
                className="bg-[#111827] hover:bg-slate-700 active:scale-95 text-white text-sm py-3 px-3 rounded-xl transition-all text-left"
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Contato atual */}
      {currentContact && dialerStatus === 'running' && !pendingDisposition && (
        <div className="bg-[#1e293b] border border-slate-700/60 rounded-2xl p-4">
          <p className="text-slate-400 text-xs uppercase tracking-wider mb-2">Contato atual</p>
          {visibleFields.includes('name') && currentContact.name && (
            <p className="text-white font-medium">{currentContact.name}</p>
          )}
          {visibleFields.includes('phone_number') && (
            <p className="text-blue-400 font-mono text-lg">{currentContact.phone_number}</p>
          )}
          {extraKeys.map((k) => {
            const val = currentContact.extra_data?.[k]
            if (!val) return null
            return (
              <p key={k} className="text-sm mt-1">
                <span className="text-slate-500">{fieldLabels[k] ?? k}: </span>
                <span className="text-slate-200">{val}</span>
              </p>
            )
          })}
          <p className="text-xs mt-1.5">
            {callStatus === 'calling' && (
              <span className="text-yellow-400 animate-pulse">Chamando...</span>
            )}
            {(callStatus === 'idle' || callStatus === 'ended') && (
              <span className="text-slate-500">Aguardando próximo...</span>
            )}
          </p>
        </div>
      )}

      {/* Controles */}
      <div className="bg-[#1e293b] border border-slate-700/60 rounded-2xl p-4">
        {/* Banner: sem ramal atribuído */}
        {!extension && (
          <div className="flex items-start gap-2 bg-yellow-900/30 border border-yellow-700/50 rounded-xl px-3 py-2.5 mb-3 text-sm text-yellow-300">
            <span className="shrink-0 mt-0.5">☎</span>
            <span>
              Você não tem ramal atribuído. Peça a um administrador para definir seu ramal antes de discar.
            </span>
          </div>
        )}

        {/* Banner: helper offline */}
        {!helperOnline && (
          <div className="flex items-start gap-2 bg-red-900/30 border border-red-700/50 rounded-xl px-3 py-2.5 mb-3 text-sm text-red-300">
            <span className="shrink-0 mt-0.5">⚠</span>
            <span>
              Helper offline. Abra o <strong>start.bat</strong> na pasta{' '}
              <code className="text-red-200">local-helper</code> e aguarde o ícone ficar verde.
            </span>
          </div>
        )}

        {/* Banner: fora do horário da campanha */}
        {helperOnline && !withinHours && dialerStatus !== 'running' && (
          <div className="flex items-start gap-2 bg-yellow-900/30 border border-yellow-700/50 rounded-xl px-3 py-2.5 mb-3 text-sm text-yellow-300">
            <span className="shrink-0 mt-0.5">🕒</span>
            <span>
              Fora do horário desta campanha
              {campaign?.schedule_start && campaign?.schedule_end && (
                <> ({campaign.schedule_start.slice(0, 5)}–{campaign.schedule_end.slice(0, 5)})</>
              )}
              . A discagem fica bloqueada até o horário de funcionamento.
            </span>
          </div>
        )}

        {/* Banner: campanha sem contatos pendentes */}
        {helperOnline && withinHours && dialerStatus === 'idle' && stats && stats.pending === 0 && stats.total > 0 && (
          <div className="flex items-center gap-2 bg-slate-700/40 border border-slate-600/50 rounded-xl px-3 py-2.5 mb-3 text-sm text-slate-300">
            <span>✓</span>
            <span>Todos os contatos desta campanha já foram discados.</span>
          </div>
        )}

        <div className="flex gap-2">
          {dialerStatus === 'idle' && (
            <button
              onClick={handleStart}
              disabled={!extension || !helperOnline || !withinHours || !stats || stats.pending === 0}
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
              disabled={!helperOnline || !withinHours}
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
    </div>
  )
}
