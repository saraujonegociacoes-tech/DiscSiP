'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw, LogOut, Wifi, WifiOff } from 'lucide-react'
import { useSoftphoneStore } from '@/store/softphoneStore'
import { useDialerStore } from '@/store/dialerStore'
import { getCurrentProfile, signOut } from '@/app/actions/auth'
import { reportPresence } from '@/app/actions/presence'
import { CallHistory } from './CallHistory'
import { DialerTab } from './DialerTab'
import { AgentPerformance } from './AgentPerformance'
import { CallControls } from './CallControls'
import { AppShell } from '@/components/blueline/AppShell'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { helperFetch } from '@/lib/constants'

type Tab = 'dialer' | 'history' | 'performance'

const TAB_LABEL: Record<Tab, string> = {
  dialer: 'Discador',
  history: 'Histórico',
  performance: 'Meu desempenho',
}

// Compara versões "X.Y.Z" numericamente: true só se `latest` for ESTRITAMENTE maior que
// `current`. Evita oferecer "atualização" para versão igual ou menor — antes, com `!==`, um
// version.json de deploy antigo/cacheado chegava a pedir downgrade (ex.: helper 1.6 vs site 1.5).
function isVersionNewer(latest: string, current: string): boolean {
  const a = latest.split('.').map((n) => parseInt(n, 10) || 0)
  const b = current.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

export default function SoftphoneClient() {
  const router = useRouter()
  const {
    agentId, extension,
    callStatus, callNumber,
    helperOnline, helperVersion,
    setProfile, setHelperOnline, logout, resetCall,
  } = useSoftphoneStore()
  const { reset: resetDialer } = useDialerStore()
  const dialerStatus = useDialerStore((s) => s.dialerStatus)
  const campaignId = useDialerStore((s) => s.campaign?.id ?? null)

  const [loadingProfile, setLoadingProfile] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('dialer')
  const [callDuration, setCallDuration] = useState(0)
  // Versão mais nova do helper publicada pelo Blue Line (public/helper/version.json)
  const [latestVersion, setLatestVersion] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)
  // Falha na atualização do helper (some sozinha em alguns segundos — ver efeito abaixo)
  const [updateError, setUpdateError] = useState(false)
  const helperOutdated =
    helperOnline && !!helperVersion && !!latestVersion && isVersionNewer(latestVersion, helperVersion)

  // Carrega o perfil da sessão (o middleware já garante sessão + aprovação aqui)
  useEffect(() => {
    let active = true
    getCurrentProfile().then((profile) => {
      if (!active) return
      if (!profile) {
        router.replace('/login')
        return
      }
      setProfile(profile)
      setLoadingProfile(false)
    })
    return () => {
      active = false
    }
  }, [router, setProfile])

  // Versão mais nova do helper publicada pelo Blue Line — para detectar helper desatualizado
  useEffect(() => {
    fetch('/helper/version.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.version && setLatestVersion(d.version))
      .catch(() => {})
  }, [])

  // Verifica se o helper local está online a cada 10s (e lê a versão dele no /ping)
  useEffect(() => {
    const check = async () => {
      try {
        const res = await helperFetch('/ping', {
          signal: AbortSignal.timeout(2000),
        })
        const data = res.ok ? await res.json().catch(() => null) : null
        setHelperOnline(res.ok, data?.version ?? null)
      } catch {
        setHelperOnline(false)
      }
    }
    check()
    const interval = setInterval(check, 10000)
    return () => clearInterval(interval)
  }, [setHelperOnline])

  // Heartbeat de presença (~20s): grava no agent_presence o estado do discador para o
  // dashboard mostrar online/offline (= está discando). Lê o estado por ref para não
  // recriar o intervalo a cada mudança de dialerStatus/campanha. Ao desmontar/deslogar
  // o batimento para → o agente vira offline por staleness (last_seen_at > 60s).
  const presenceRef = useRef({ dialerStatus, campaignId })
  presenceRef.current = { dialerStatus, campaignId }
  useEffect(() => {
    if (!agentId) return
    const beat = () => {
      const { dialerStatus, campaignId } = presenceRef.current
      reportPresence(dialerStatus, campaignId).catch(() => {})
    }
    beat()
    const interval = setInterval(beat, 20000)
    return () => clearInterval(interval)
  }, [agentId])

  // O aviso de falha na atualização some sozinho após alguns segundos (não fica preso)
  useEffect(() => {
    if (!updateError) return
    const t = setTimeout(() => setUpdateError(false), 6000)
    return () => clearTimeout(t)
  }, [updateError])

  // Dispara a auto-atualização do helper: ele baixa o código novo de /helper/index.js
  // (passamos nossa origem), sobrescreve a si mesmo e reinicia. Ficamos esperando voltar.
  const handleUpdateHelper = async () => {
    setUpdating(true)
    setUpdateError(false)
    try {
      const res = await helperFetch('/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: window.location.origin }),
      })
      if (!res.ok) throw new Error('update falhou')
      // O helper reinicia (cai por alguns segundos). Espera ele voltar já na versão nova.
      let updated = false
      const deadline = Date.now() + 20000
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1500))
        try {
          const ping = await helperFetch('/ping', { signal: AbortSignal.timeout(2000) })
          const data = ping.ok ? await ping.json() : null
          if (data?.version) {
            setHelperOnline(true, data.version)
            if (data.version === latestVersion) {
              updated = true
              break
            }
          }
        } catch {
          // ainda reiniciando
        }
      }
      // Não voltou na versão nova dentro do tempo — provável que tenha caído ao reiniciar
      if (!updated) setUpdateError(true)
    } catch {
      // helper offline, sem /update (versão antiga) ou erro de rede
      setUpdateError(true)
    } finally {
      setUpdating(false)
    }
  }

  // Cronômetro: conta a partir do momento que a chamada foi disparada
  useEffect(() => {
    if (callStatus !== 'calling') {
      setCallDuration(0)
      return
    }
    const interval = setInterval(() => setCallDuration((d) => d + 1), 1000)
    return () => clearInterval(interval)
  }, [callStatus])

  const formatDuration = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`

  const handleLogout = async () => {
    logout()
    resetCall()
    resetDialer()
    await signOut()
  }

  // ─── Carregando o perfil ───────────────────────────────────────────────────────
  if (loadingProfile || !agentId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background bg-gradient-mesh">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    )
  }

  const header = (
    <>
      {/* Abas */}
      <div className="flex items-center gap-1 rounded-lg border border-border bg-card/60 p-0.5 shadow-card">
        {(['dialer', 'history', 'performance'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              activeTab === tab
                ? 'bg-gradient-primary text-primary-foreground shadow-glow'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {TAB_LABEL[tab]}
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-3">
        {/* Status do helper */}
        <span
          className={cn(
            'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium',
            helperOnline
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-destructive/30 bg-destructive/10 text-destructive'
          )}
        >
          {helperOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          {helperOnline ? 'Helper online' : 'Helper offline'}
          {helperOnline && helperVersion && (
            <span className="opacity-70">v{helperVersion}</span>
          )}
        </span>

        {helperOutdated && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleUpdateHelper}
              disabled={updating}
              title={`Atualizar helper para v${latestVersion}`}
              className="border-warning/40 bg-warning/10 text-warning hover:bg-warning/20"
            >
              <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', updating && 'animate-spin')} />
              {updating ? 'Atualizando…' : `v${latestVersion}`}
            </Button>
            {updateError && !updating && (
              <span className="text-xs text-destructive">Falhou — tente de novo</span>
            )}
          </div>
        )}

        <button
          onClick={handleLogout}
          title="Sair"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </>
  )

  return (
    <AppShell header={header}>
      {/* Painel de controle de áudio + desligar (sempre visível) */}
      <CallControls />

      {/* Banner de chamada ativa (informativo; o Desligar vive no painel acima) */}
      {callStatus === 'calling' && (
        <div className="mb-6 flex items-center gap-3 overflow-hidden rounded-2xl border border-success/30 bg-success/10 px-5 py-3 shadow-card">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-success shadow-glow" />
          <span className="text-sm font-medium text-success">Em chamada — {callNumber}</span>
          <span className="font-mono text-sm tabular-nums text-muted-foreground">
            {formatDuration(callDuration)}
          </span>
        </div>
      )}

      {/* Aba Discador — sempre montada para manter o hook ativo */}
      <div className={activeTab === 'dialer' ? 'block' : 'hidden'}>
        <DialerTab />
      </div>

      {/* Aba Histórico */}
      {activeTab === 'history' && agentId && (
        <div className="mx-auto max-w-2xl">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Histórico de chamadas</h2>
            <span className="text-xs text-muted-foreground">Ramal {extension} · últimas 20</span>
          </div>
          <CallHistory agentId={agentId} key={agentId} />
        </div>
      )}

      {/* Aba Meu desempenho */}
      {activeTab === 'performance' && (
        <div className="mx-auto max-w-4xl">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Meu desempenho — hoje</h2>
            <span className="text-xs text-muted-foreground">Ramal {extension}</span>
          </div>
          <AgentPerformance />
        </div>
      )}
    </AppShell>
  )
}
