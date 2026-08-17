'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Play, Pause, Check, AlertTriangle, Clock, Phone, ChevronRight, ArrowLeft, PhoneCall, Wrench,
} from 'lucide-react'
import { useDialerStore } from '@/store/dialerStore'
import { usePowerDialer } from '@/hooks/usePowerDialer'
import { useSoftphoneStore } from '@/store/softphoneStore'
import { getCampaignsForAgent, getCampaignStats } from '@/app/actions/campaigns'
import { getListFieldLabels } from '@/app/actions/lists'
import { DISPOSITIONS } from '@/lib/dispositions'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { getTransport } from '@/lib/telephony'
import type { Campaign } from '@/lib/types/database'

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  active: 'Ativa',
  paused: 'Pausada',
  completed: 'Concluída',
}

const STATUS_COLOR: Record<string, string> = {
  draft: 'text-muted-foreground',
  active: 'text-success',
  paused: 'text-warning',
  completed: 'text-primary',
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
    parallelBatch,
    dialerError,
    setCampaign,
    setPauseBetweenCalls,
  } = useDialerStore()
  const { helperOnline, helperVersion, multiCall, callStatus, callNumber, agentId, extension, setHelperOnline } =
    useSoftphoneStore()
  const { start, pause, resume, submitDisposition, isParallel } = usePowerDialer()

  const [view, setView] = useState<View>('list')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loadingCampaigns, setLoadingCampaigns] = useState(true)
  const [stats, setStats] = useState<Record<string, number> | null>(null)
  const [fieldLabels, setFieldLabels] = useState<Record<string, string>>({})
  const [withinHours, setWithinHours] = useState(true)
  const [preparingMicrosip, setPreparingMicrosip] = useState(false)
  const [prepareError, setPrepareError] = useState<string | null>(null)

  // A preditiva depende do MicroSIP em modo multi-chamada. `multiCall === false` é o helper
  // afirmando que está em chamada única — aí o lote de N vira uma ligação só. `null` = helper
  // antigo (< 1.8) ou ini ilegível: não dá para afirmar nada, então não assustamos o agente.
  const needsMultiCall = isParallel && helperOnline && multiCall === false

  // Liga o multi-chamada pelo helper (fecha e reabre o MicroSIP). Só ofertado com a discagem
  // parada — reiniciar o MicroSIP no meio de uma ligação derrubaria a conversa.
  const handlePrepareMicrosip = async () => {
    setPreparingMicrosip(true)
    setPrepareError(null)
    try {
      const result = await getTransport().prepareMultiCall()
      if (!result.ok) throw new Error(result.error ?? 'falhou')
      const st = getTransport().getStatus()
      setHelperOnline(true, st.version ?? helperVersion, st.multiCall ?? true)
    } catch (err) {
      setPrepareError(
        err instanceof Error && err.message !== 'falhou'
          ? err.message
          : 'Não foi possível preparar o MicroSIP. Feche o MicroSIP e tente de novo.'
      )
    } finally {
      setPreparingMicrosip(false)
    }
  }

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
    if (!campaign || !withinHours || needsMultiCall) return
    await start()
  }

  const visibleFields = campaign?.visible_fields ?? ['name', 'phone_number']
  const extraKeys = visibleFields.filter((k) => k !== 'name' && k !== 'phone_number')

  // ─── Lista de campanhas ──────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div className="mx-auto max-w-2xl">
        <h2 className="mb-5 text-lg font-semibold text-foreground">Minhas campanhas</h2>

        {loadingCampaigns ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-2xl border border-border bg-gradient-card px-4 py-4 shadow-card"
              >
                <div className="space-y-2">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-2.5 w-16" />
                </div>
                <Skeleton className="h-4 w-4 rounded-full" />
              </div>
            ))}
          </div>
        ) : campaigns.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-gradient-card py-12 shadow-card">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <PhoneCall className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium text-foreground">Nenhuma campanha disponível</p>
            <p className="max-w-xs text-center text-xs text-muted-foreground">
              Você ainda não participa de nenhuma campanha. Peça ao supervisor para adicioná-lo.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {campaigns.map((c) => (
              <button
                key={c.id}
                onClick={() => handleSelect(c)}
                className="group flex w-full items-center justify-between rounded-2xl border border-border bg-gradient-card px-4 py-4 text-left shadow-card transition-colors hover:bg-accent/40"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow transition-transform group-hover:scale-105">
                    <PhoneCall className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{c.name}</p>
                    <p className={cn('mt-0.5 text-xs', STATUS_COLOR[c.status])}>
                      {STATUS_LABEL[c.status]}
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground transition-colors group-hover:text-foreground" />
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ─── Campanha selecionada ────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-2xl space-y-3">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => { setView('list'); setCampaign(null) }}
          className="inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Campanhas
        </button>
        <span className="text-border">/</span>
        <h2 className="truncate text-lg font-semibold text-foreground">{campaign?.name}</h2>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Total', key: 'total', color: 'text-foreground' },
            { label: 'Pendentes', key: 'pending', color: 'text-primary' },
            { label: 'Atendidas', key: 'answered', color: 'text-success' },
            { label: 'Não Atend.', key: 'no_answer', color: 'text-warning' },
          ].map((s) => (
            <div
              key={s.key}
              className="rounded-2xl border border-border bg-gradient-card p-3 text-center shadow-card"
            >
              <p className={cn('text-2xl font-semibold tabular-nums', s.color)}>{stats[s.key] ?? 0}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Disposição após chamada */}
      {pendingDisposition && (
        <div className="rounded-2xl border border-primary/40 bg-gradient-card p-5 shadow-elevated">
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-primary">
            Resultado — {callNumber ?? currentContact?.phone_number}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {DISPOSITIONS.map((d) => (
              <button
                key={d.value}
                onClick={() => submitDisposition(d.status, d.value, d.label)}
                className="rounded-xl border border-border bg-background/40 px-3 py-3 text-left text-sm text-foreground transition-all hover:bg-accent/60 active:scale-95"
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Paralelo: discando N linhas */}
      {isParallel &&
        dialerStatus === 'running' &&
        callStatus === 'calling' &&
        parallelBatch.length > 0 &&
        !pendingDisposition && (
          <div className="overflow-hidden rounded-2xl border border-border bg-gradient-premium p-5 text-white shadow-elevated">
            <p className="mb-2 text-xs uppercase tracking-wider text-white/70">Discagem paralela</p>
            <p className="animate-pulse text-lg font-semibold">
              Discando {parallelBatch.length} {parallelBatch.length === 1 ? 'linha' : 'linhas'}…
            </p>
            <div className="mt-2 space-y-0.5">
              {parallelBatch.map((c) => (
                <p key={c.id} className="font-mono text-sm text-white/80">
                  {c.phone_number}
                  {c.name ? <span className="font-sans text-white/60"> · {c.name}</span> : null}
                </p>
              ))}
            </div>
            <p className="mt-3 text-xs text-white/60">
              Pode fazer outra coisa — você é avisado (com som) quando alguém atender.
            </p>
            <p className="mt-1 text-xs text-white/50">
              Cada linha toca até 20s e é derrubada antes da caixa postal; esses contatos voltam
              para a fila como abandonados.
            </p>
          </div>
        )}

      {/* Paralelo: ATENDEU, fale agora */}
      {isParallel && callStatus === 'answered' && currentContact && !pendingDisposition && (
        <div className="overflow-hidden rounded-2xl border-2 border-success bg-success/15 p-5 shadow-elevated">
          <p className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-success">
            <span className="animate-pulse">●</span> Atendeu — fale agora
          </p>
          {visibleFields.includes('name') && currentContact.name && (
            <p className="text-lg font-semibold text-foreground">{currentContact.name}</p>
          )}
          {visibleFields.includes('phone_number') && (
            <p className="font-mono text-xl text-success">{currentContact.phone_number}</p>
          )}
          {extraKeys.map((k) => {
            const val = currentContact.extra_data?.[k]
            if (!val) return null
            return (
              <p key={k} className="mt-1 text-sm">
                <span className="text-muted-foreground">{fieldLabels[k] ?? k}: </span>
                <span className="text-foreground">{val}</span>
              </p>
            )
          })}
        </div>
      )}

      {/* Contato atual (modo 1-a-1) */}
      {!isParallel && currentContact && dialerStatus === 'running' && !pendingDisposition && (
        <div
          className={cn(
            'overflow-hidden rounded-2xl border p-5 shadow-elevated',
            callStatus === 'calling'
              ? 'border-border bg-gradient-premium text-white'
              : 'border-border bg-gradient-card'
          )}
        >
          <p
            className={cn(
              'mb-2 text-xs uppercase tracking-wider',
              callStatus === 'calling' ? 'text-white/70' : 'text-muted-foreground'
            )}
          >
            Contato atual
          </p>
          {visibleFields.includes('name') && currentContact.name && (
            <p className={cn('text-lg font-semibold', callStatus === 'calling' ? 'text-white' : 'text-foreground')}>
              {currentContact.name}
            </p>
          )}
          {visibleFields.includes('phone_number') && (
            <p className={cn('font-mono text-xl', callStatus === 'calling' ? 'text-white' : 'text-primary')}>
              {currentContact.phone_number}
            </p>
          )}
          {extraKeys.map((k) => {
            const val = currentContact.extra_data?.[k]
            if (!val) return null
            return (
              <p key={k} className="mt-1 text-sm">
                <span className={callStatus === 'calling' ? 'text-white/60' : 'text-muted-foreground'}>
                  {fieldLabels[k] ?? k}:{' '}
                </span>
                <span className={callStatus === 'calling' ? 'text-white' : 'text-foreground'}>{val}</span>
              </p>
            )
          })}
          <p className="mt-2 text-xs">
            {callStatus === 'calling' && (
              <span className="animate-pulse font-medium text-white/90">Chamando...</span>
            )}
            {(callStatus === 'idle' || callStatus === 'ended') && (
              <span className="text-muted-foreground">Aguardando próximo...</span>
            )}
          </p>
        </div>
      )}

      {/* Controles */}
      <div className="rounded-2xl border border-border bg-gradient-card p-5 shadow-card">
        {/* Banner: sem ramal atribuído */}
        {!extension && (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warning">
            <Phone className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Você não tem ramal atribuído. Peça a um administrador para definir seu ramal antes de discar.
            </span>
          </div>
        )}

        {/* Banner: helper offline */}
        {!helperOnline && (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Helper offline. Abra o <strong>start.bat</strong> na pasta{' '}
              <code className="rounded bg-destructive/15 px-1">local-helper</code> e aguarde o ícone ficar verde.
            </span>
          </div>
        )}

        {/* Banner: MicroSIP em chamada única — a preditiva não sai do papel assim */}
        {needsMultiCall && (
          <div className="mb-3 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warning">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex-1">
                <p>
                  Esta campanha é <strong>preditiva ({campaign?.parallel_lines} linhas)</strong>, mas o
                  MicroSIP está em <strong>modo de chamada única</strong> — só sairia uma ligação por
                  vez. Prepare o MicroSIP para liberar a discagem paralela.
                </p>
                {prepareError && <p className="mt-1 text-xs text-destructive">{prepareError}</p>}
              </div>
            </div>
            <button
              onClick={handlePrepareMicrosip}
              disabled={preparingMicrosip || dialerStatus === 'running'}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-warning/50 bg-warning/15 px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-warning/25 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Wrench className={cn('h-3.5 w-3.5', preparingMicrosip && 'animate-spin')} />
              {preparingMicrosip ? 'Preparando…' : 'Preparar MicroSIP'}
            </button>
            <p className="mt-1.5 text-xs text-warning/80">
              O MicroSIP fecha e abre de novo (alguns segundos). Faça isso fora de ligação.
            </p>
          </div>
        )}

        {/* Banner: a última tentativa de discagem falhou */}
        {dialerError && (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{dialerError}</span>
          </div>
        )}

        {/* Banner: fora do horário da campanha */}
        {helperOnline && !withinHours && dialerStatus !== 'running' && (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warning">
            <Clock className="mt-0.5 h-4 w-4 shrink-0" />
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
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
            <Check className="h-4 w-4 shrink-0" />
            <span>Todos os contatos desta campanha já foram discados.</span>
          </div>
        )}

        <div className="flex gap-2">
          {dialerStatus === 'idle' && (
            <button
              onClick={handleStart}
              disabled={
                !extension || !helperOnline || !withinHours || !stats || stats.pending === 0 || needsMultiCall
              }
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-success py-3 text-sm font-semibold text-success-foreground transition-colors hover:bg-success/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
            >
              <Play className="h-4 w-4" /> Iniciar discagem
            </button>
          )}
          {dialerStatus === 'running' && !pendingDisposition && (
            <button
              onClick={pause}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-warning py-3 text-sm font-semibold text-warning-foreground transition-colors hover:bg-warning/90"
            >
              <Pause className="h-4 w-4" /> Pausar
            </button>
          )}
          {dialerStatus === 'paused' && (
            <button
              onClick={resume}
              disabled={!helperOnline || !withinHours || needsMultiCall}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-success py-3 text-sm font-semibold text-success-foreground transition-colors hover:bg-success/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
            >
              <Play className="h-4 w-4" /> Retomar
            </button>
          )}
          {dialerStatus === 'completed' && (
            <div className="flex flex-1 items-center justify-center gap-2 py-3 text-sm font-medium text-success">
              <Check className="h-4 w-4" /> Campanha concluída
            </div>
          )}
        </div>

        {(dialerStatus === 'idle' || dialerStatus === 'paused') && (
          <div className="mt-3 flex items-center gap-3">
            <label className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
              Pausa entre chamadas
            </label>
            <input
              type="range"
              min={1}
              max={30}
              value={pauseBetweenCalls}
              onChange={(e) => setPauseBetweenCalls(Number(e.target.value))}
              className="flex-1 accent-primary"
            />
            <span className="w-8 text-right text-sm tabular-nums text-primary">{pauseBetweenCalls}s</span>
          </div>
        )}
      </div>
    </div>
  )
}
