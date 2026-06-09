'use client'

import { useState, useEffect } from 'react'
import { useSoftphoneStore } from '@/store/softphoneStore'
import { useDialerStore } from '@/store/dialerStore'
import { getAgentByExtension } from '@/app/actions/dialer'
import { CallHistory } from './CallHistory'
import { DialerTab } from './DialerTab'
import { Sidebar } from '@/components/Sidebar'
import { HELPER_URL } from '@/lib/constants'

type Tab = 'dialer' | 'history'

export default function SoftphoneClient() {
  const {
    agentId, agentName, extension,
    callStatus, callNumber,
    helperOnline,
    setAgent, setCallStatus, setHelperOnline, logout, resetCall,
  } = useSoftphoneStore()
  const { reset: resetDialer } = useDialerStore()

  const [extensionInput, setExtensionInput] = useState('')
  const [loginError, setLoginError] = useState('')
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('dialer')
  const [callDuration, setCallDuration] = useState(0)

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

  const handleLogin = async () => {
    const ext = parseInt(extensionInput)
    if (isNaN(ext)) {
      setLoginError('Informe um número de ramal válido.')
      return
    }
    setIsLoggingIn(true)
    setLoginError('')

    const result = await getAgentByExtension(ext)
    if ('error' in result) {
      setLoginError(result.error)
      setIsLoggingIn(false)
      return
    }

    setAgent(result.agent.id, result.agent.name, result.agent.extension)
    setIsLoggingIn(false)
  }

  const handleLogout = () => {
    logout()
    resetCall()
    resetDialer()
    setExtensionInput('')
  }

  // ─── Tela de login ───────────────────────────────────────────────────────────
  if (!agentId) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center p-4">
        <div className="w-full max-w-xs">
          <div className="text-center mb-8">
            <h1 className="text-3xl text-white tracking-tight">
              <span className="font-medium">Disc</span><span className="font-bold text-blue-500">SiP</span>
            </h1>
            <p className="text-slate-500 text-sm mt-1">Power Dialer</p>
          </div>
          <div className="bg-[#1e293b] border border-slate-700/60 rounded-2xl p-8">
            <label className="block text-xs text-slate-400 mb-2 uppercase tracking-wider">
              Ramal
            </label>
            <input
              type="number"
              min={5125}
              max={5150}
              value={extensionInput}
              onChange={(e) => setExtensionInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              placeholder="5125"
              className="w-full bg-[#111827] border border-slate-600 rounded-xl px-4 py-3 text-white text-xl text-center placeholder:text-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
            />
            {loginError && (
              <p className="text-red-400 text-sm mt-2 text-center">{loginError}</p>
            )}
            <button
              onClick={handleLogin}
              disabled={isLoggingIn || !extensionInput}
              className="w-full mt-4 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold py-3 rounded-xl transition-colors"
            >
              {isLoggingIn ? 'Carregando...' : 'Entrar'}
            </button>
          </div>
        </div>
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
