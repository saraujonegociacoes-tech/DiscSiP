'use client'

import { useRef, useState, useEffect } from 'react'
import { useSipAgent } from '@/hooks/useSipAgent'
import { useSoftphoneStore } from '@/store/softphoneStore'
import { getSipCredentials, saveCallLog } from '@/app/actions/sip'
import { DialPad } from './DialPad'
import { CallHistory } from './CallHistory'
import { Sidebar } from '@/components/Sidebar'

type Tab = 'softphone' | 'history'

export default function SoftphoneClient() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const { connect, disconnect, call, hangup, answerCall, rejectCall } = useSipAgent(audioRef)
  const {
    agentId, agentName, extension,
    sipStatus, sipError,
    callStatus, callNumber, incomingFrom, callStartedAt,
    setAgent, resetCall, logout,
  } = useSoftphoneStore()

  const [extensionInput, setExtensionInput] = useState('')
  const [loginError, setLoginError] = useState('')
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [dialNumber, setDialNumber] = useState('')
  const [callDuration, setCallDuration] = useState(0)
  const [activeTab, setActiveTab] = useState<Tab>('softphone')
  const [showDialPad, setShowDialPad] = useState(false)
  const callLogSavedRef = useRef(false)

  // Cronômetro da chamada
  useEffect(() => {
    if (callStatus !== 'answered') {
      setCallDuration(0)
      return
    }
    const interval = setInterval(() => setCallDuration((d) => d + 1), 1000)
    return () => clearInterval(interval)
  }, [callStatus])

  // Salva call_log quando chamada termina
  useEffect(() => {
    if (callStatus !== 'ended' || !agentId || !extension || !callNumber) return
    if (callLogSavedRef.current) return
    callLogSavedRef.current = true

    const durationSeconds = callStartedAt
      ? Math.floor((Date.now() - callStartedAt.getTime()) / 1000)
      : 0

    saveCallLog({
      agentId,
      extension,
      phoneNumber: callNumber,
      direction: 'outbound',
      status: durationSeconds > 0 ? 'answered' : 'no_answer',
      durationSeconds,
      startedAt: callStartedAt ? callStartedAt.toISOString() : null,
      endedAt: new Date().toISOString(),
    })
  }, [callStatus, agentId, extension, callNumber, callStartedAt])

  useEffect(() => {
    if (callStatus === 'idle') callLogSavedRef.current = false
  }, [callStatus])

  const handleLogin = async () => {
    const ext = parseInt(extensionInput)
    if (isNaN(ext)) {
      setLoginError('Informe um número de ramal válido.')
      return
    }
    setIsLoggingIn(true)
    setLoginError('')

    const result = await getSipCredentials(ext)
    if ('error' in result) {
      setLoginError(result.error)
      setIsLoggingIn(false)
      return
    }

    setAgent(result.agent.id, result.agent.name, result.agent.extension)
    await connect({
      extension: result.agent.extension,
      password: result.password,
      sipServer: result.sipServer,
      sipDomain: result.sipDomain,
    })
    setIsLoggingIn(false)
  }

  const handleLogout = async () => {
    await disconnect()
    logout()
    resetCall()
    setExtensionInput('')
    setDialNumber('')
  }

  const formatDuration = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`

  const sipIndicator = {
    disconnected: { dot: 'bg-slate-500', label: 'Desconectado' },
    connecting: { dot: 'bg-yellow-400 animate-pulse', label: 'Conectando...' },
    registered: { dot: 'bg-green-400', label: 'Registrado' },
    error: { dot: 'bg-red-500', label: 'Erro SIP' },
  }[sipStatus]

  // ─── Tela de login ───────────────────────────────────────────────────────────
  if (!agentId) {
    return (
      <div className="min-h-screen bg-[#070d1a] flex items-center justify-center p-4">
        <div className="w-full max-w-xs">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-white tracking-tight">
              Disc<span className="text-blue-500">SiP</span>
            </h1>
            <p className="text-slate-500 text-sm mt-1">Softphone Web</p>
          </div>
          <div className="bg-[#111827] border border-slate-700/60 rounded-2xl p-8">
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
              className="w-full bg-[#1a2234] border border-slate-600 rounded-xl px-4 py-3 text-white text-xl text-center placeholder:text-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
            />
            {loginError && (
              <p className="text-red-400 text-sm mt-2 text-center">{loginError}</p>
            )}
            <button
              onClick={handleLogin}
              disabled={isLoggingIn || !extensionInput}
              className="w-full mt-4 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold py-3 rounded-xl transition-colors"
            >
              {isLoggingIn ? 'Conectando...' : 'Entrar'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─── Layout principal ────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#070d1a] flex">
      <Sidebar />

      <div className="flex-1 flex flex-col">
        {/* Top bar */}
        <header className="flex items-center justify-between px-6 py-3 border-b border-slate-800">
          <div className="flex gap-1">
            {(['softphone', 'history'] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === tab
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tab === 'softphone' ? 'Softphone' : 'Histórico'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full shrink-0 ${sipIndicator.dot}`} />
              <span className="text-xs text-slate-400">{sipIndicator.label}</span>
            </div>
            <button
              onClick={handleLogout}
              className="text-slate-500 hover:text-slate-300 text-xs transition-colors"
            >
              Sair
            </button>
          </div>
        </header>

        <main className="flex-1 p-6">
          {/* ─── Aba Softphone ─── */}
          {activeTab === 'softphone' && (
            <div className="max-w-sm mx-auto space-y-3">
              {/* Chamada recebida */}
              {callStatus === 'incoming' && (
                <div className="bg-[#111827] border border-blue-500/50 rounded-2xl p-6 text-center">
                  <p className="text-blue-400 text-xs font-medium uppercase tracking-wider animate-pulse mb-2">
                    Chamada recebida
                  </p>
                  <p className="text-white text-2xl font-mono">{incomingFrom}</p>
                  <div className="flex gap-3 mt-5">
                    <button
                      onClick={answerCall}
                      className="flex-1 bg-green-600 hover:bg-green-500 active:bg-green-700 text-white py-3 rounded-xl font-semibold transition-colors"
                    >
                      Atender
                    </button>
                    <button
                      onClick={rejectCall}
                      className="flex-1 bg-red-600 hover:bg-red-500 active:bg-red-700 text-white py-3 rounded-xl font-semibold transition-colors"
                    >
                      Rejeitar
                    </button>
                  </div>
                </div>
              )}

              {/* Chamada ativa */}
              {(callStatus === 'ringing' || callStatus === 'answered') && (
                <div className="bg-[#111827] border border-slate-700/60 rounded-2xl p-6 text-center">
                  {callStatus === 'ringing' ? (
                    <p className="text-yellow-400 text-xs font-medium uppercase tracking-wider animate-pulse">
                      Chamando...
                    </p>
                  ) : (
                    <p className="text-green-400 text-xs font-medium uppercase tracking-wider">
                      Em chamada
                    </p>
                  )}
                  <p className="text-white text-2xl font-mono mt-2">{callNumber}</p>
                  {callStatus === 'answered' && (
                    <p className="text-blue-400 text-4xl font-mono mt-3 tabular-nums">
                      {formatDuration(callDuration)}
                    </p>
                  )}
                  <button
                    onClick={hangup}
                    className="mt-5 w-full bg-red-600 hover:bg-red-500 active:bg-red-700 text-white py-3 rounded-xl font-semibold transition-colors"
                  >
                    {callStatus === 'ringing' ? 'Cancelar' : 'Encerrar'}
                  </button>
                </div>
              )}

              {/* Chamada encerrada */}
              {callStatus === 'ended' && (
                <div className="bg-[#111827] border border-slate-700/60 rounded-2xl px-6 py-4 text-center">
                  <p className="text-slate-400 text-sm">Chamada encerrada</p>
                </div>
              )}

              {/* Discagem (idle ou ended) */}
              {(callStatus === 'idle' || callStatus === 'ended') && (
                <div className="bg-[#111827] border border-slate-700/60 rounded-2xl p-5">
                  <div className="flex gap-2">
                    <input
                      type="tel"
                      value={dialNumber}
                      onChange={(e) => setDialNumber(e.target.value)}
                      onKeyDown={(e) =>
                        e.key === 'Enter' &&
                        sipStatus === 'registered' &&
                        dialNumber.trim() &&
                        call(dialNumber.trim())
                      }
                      placeholder="Número para discar"
                      className="flex-1 bg-[#1a2234] border border-slate-600 rounded-xl px-3 py-3 text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500 transition-colors text-sm"
                    />
                    <button
                      onClick={() => call(dialNumber.trim())}
                      disabled={sipStatus !== 'registered' || !dialNumber.trim()}
                      className="bg-green-600 hover:bg-green-500 active:bg-green-700 disabled:bg-slate-700 disabled:text-slate-500 text-white px-4 rounded-xl transition-colors text-xl"
                      title="Ligar"
                    >
                      ✆
                    </button>
                    {dialNumber && (
                      <button
                        onClick={() => setDialNumber((n) => n.slice(0, -1))}
                        className="bg-[#1a2234] hover:bg-slate-700 text-slate-400 px-3 rounded-xl transition-colors text-sm"
                        title="Apagar"
                      >
                        ⌫
                      </button>
                    )}
                  </div>

                  <button
                    onClick={() => setShowDialPad((v) => !v)}
                    className="w-full mt-3 text-slate-500 hover:text-slate-300 text-xs transition-colors py-1"
                  >
                    {showDialPad ? 'Ocultar teclado' : 'Mostrar teclado'}
                  </button>

                  {showDialPad && (
                    <DialPad onKey={(k) => setDialNumber((n) => n + k)} />
                  )}
                </div>
              )}

              {sipError && (
                <p className="text-red-400 text-xs text-center">{sipError}</p>
              )}
            </div>
          )}

          {/* ─── Aba Histórico ─── */}
          {activeTab === 'history' && agentId && (
            <div className="max-w-lg mx-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-white font-semibold">Histórico de chamadas</h2>
                <span className="text-slate-500 text-xs">Ramal {extension} · últimas 20</span>
              </div>
              <CallHistory agentId={agentId} key={agentId} />
            </div>
          )}
        </main>
      </div>

      {/* Agente logado no sidebar já está via Zustand — sem necessidade de nome aqui */}
      <audio ref={audioRef} autoPlay hidden />
    </div>
  )
}
