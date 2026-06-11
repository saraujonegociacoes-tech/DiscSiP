'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSoftphoneStore } from '@/store/softphoneStore'
import { useDialerStore } from '@/store/dialerStore'
import { getCurrentProfile, signOut } from '@/app/actions/auth'
import { CallHistory } from './CallHistory'
import { DialerTab } from './DialerTab'
import { Sidebar } from '@/components/Sidebar'
import { HELPER_URL } from '@/lib/constants'

type Tab = 'dialer' | 'history'

export default function SoftphoneClient() {
  const router = useRouter()
  const {
    agentId, extension,
    callStatus, callNumber,
    helperOnline,
    setProfile, setCallStatus, setHelperOnline, logout, resetCall,
  } = useSoftphoneStore()
  const { reset: resetDialer } = useDialerStore()

  const [loadingProfile, setLoadingProfile] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('dialer')
  const [callDuration, setCallDuration] = useState(0)

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

  // Verifica se o helper local está online a cada 10s
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(`${HELPER_URL}/ping`, {
          signal: AbortSignal.timeout(2000),
        })
        setHelperOnline(res.ok)
      } catch {
        setHelperOnline(false)
      }
    }
    check()
    const interval = setInterval(check, 10000)
    return () => clearInterval(interval)
  }, [setHelperOnline])

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
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-slate-600 border-t-blue-500 rounded-full animate-spin" />
      </div>
    )
  }

  // ─── Layout principal ────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0f172a] flex">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="flex items-center justify-between px-6 py-3 border-b border-slate-800 shrink-0">
          <div className="flex gap-1">
            {(['dialer', 'history'] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === tab
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tab === 'dialer' ? 'Dialer' : 'Histórico'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  helperOnline ? 'bg-green-400' : 'bg-red-500 animate-pulse'
                }`}
              />
              <span className="text-xs text-slate-400">
                {helperOnline ? 'Helper online' : 'Helper offline'}
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="text-slate-500 hover:text-slate-300 text-xs transition-colors"
            >
              Sair
            </button>
          </div>
        </header>

        {/* Banner de chamada ativa */}
        {callStatus === 'calling' && (
          <div className="bg-[#0a1f0a] border-b border-green-800/50 px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-green-400 text-sm font-medium">
                Em chamada — {callNumber}
              </span>
              <span className="text-slate-400 text-sm tabular-nums">
                {formatDuration(callDuration)}
              </span>
            </div>
            <button
              onClick={() => setCallStatus('ended')}
              className="bg-red-600 hover:bg-red-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              Encerrar
            </button>
          </div>
        )}

        <main className="flex-1 p-6 overflow-y-auto">
          {/* Aba Dialer — sempre montada para manter o hook ativo */}
          <div className={activeTab === 'dialer' ? 'block' : 'hidden'}>
            <DialerTab />
          </div>

          {/* Aba Histórico */}
          {activeTab === 'history' && agentId && (
            <div className="max-w-lg mx-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-white font-semibold">Histórico de chamadas</h2>
                <span className="text-slate-500 text-xs">
                  Ramal {extension} · últimas 20
                </span>
              </div>
              <CallHistory agentId={agentId} key={agentId} />
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
