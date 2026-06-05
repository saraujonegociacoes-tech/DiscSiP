'use client'

import { useRef, useState, useEffect } from 'react'
import { useSipAgent } from '@/hooks/useSipAgent'
import { useSoftphoneStore } from '@/store/softphoneStore'
import { getSipCredentials, saveCallLog } from '@/app/actions/sip'

export default function SoftphoneClient() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const { connect, disconnect, call, hangup } = useSipAgent(audioRef)
  const {
    agentId,
    agentName,
    extension,
    sipStatus,
    sipError,
    callStatus,
    callNumber,
    callStartedAt,
    setAgent,
    resetCall,
    logout,
  } = useSoftphoneStore()

  const [extensionInput, setExtensionInput] = useState('')
  const [loginError, setLoginError] = useState('')
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [dialNumber, setDialNumber] = useState('')
  const [callDuration, setCallDuration] = useState(0)
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

  // Salva call_log quando a chamada termina
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

  // Reseta flag de save quando volta para idle
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
    disconnected: { color: 'bg-slate-500', label: 'Desconectado' },
    connecting: { color: 'bg-yellow-400 animate-pulse', label: 'Conectando...' },
    registered: { color: 'bg-green-400', label: 'Registrado' },
    error: { color: 'bg-red-500', label: 'Erro SIP' },
  }[sipStatus]

  // ─── Tela de login ───────────────────────────────────────────────────────────
  if (!agentId) {
    return (
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
    )
  }

  // ─── Tela do softphone ───────────────────────────────────────────────────────
  return (
    <div className="w-full max-w-xs">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-white">
          Disc<span className="text-blue-500">SiP</span>
        </h1>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${sipIndicator.color}`} />
          <span className="text-xs text-slate-400">{sipIndicator.label}</span>
        </div>
      </div>

      {/* Info do agente */}
      <div className="bg-[#111827] border border-slate-700/60 rounded-2xl px-5 py-4 mb-3">
        <div className="flex items-center justify-between">
          <span className="text-white font-medium text-sm">{agentName}</span>
          <span className="text-blue-400 text-sm font-mono">Ramal {extension}</span>
        </div>
        {sipError && (
          <p className="text-red-400 text-xs mt-1">{sipError}</p>
        )}
      </div>

      {/* Área de discagem / chamada */}
      <div className="bg-[#111827] border border-slate-700/60 rounded-2xl px-5 py-5">
        {callStatus === 'idle' && (
          <>
            <label className="block text-xs text-slate-400 mb-2 uppercase tracking-wider">
              Número
            </label>
            <div className="flex gap-2">
              <input
                type="tel"
                value={dialNumber}
                onChange={(e) => setDialNumber(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sipStatus === 'registered' && call(dialNumber.trim())}
                placeholder="Ex: 11987654321"
                className="flex-1 bg-[#1a2234] border border-slate-600 rounded-xl px-3 py-3 text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500 transition-colors text-sm"
              />
              <button
                onClick={() => call(dialNumber.trim())}
                disabled={sipStatus !== 'registered' || !dialNumber.trim()}
                className="bg-green-600 hover:bg-green-500 active:bg-green-700 disabled:bg-slate-700 disabled:text-slate-500 text-white px-4 rounded-xl transition-colors text-lg"
                title="Ligar"
              >
                ✆
              </button>
            </div>
          </>
        )}

        {callStatus === 'ringing' && (
          <div className="text-center py-3">
            <p className="text-yellow-400 text-sm font-medium animate-pulse">Chamando...</p>
            <p className="text-white text-xl font-mono mt-1">{callNumber}</p>
            <button
              onClick={hangup}
              className="mt-4 bg-red-600 hover:bg-red-500 active:bg-red-700 text-white px-8 py-3 rounded-xl font-semibold transition-colors"
            >
              Cancelar
            </button>
          </div>
        )}

        {callStatus === 'answered' && (
          <div className="text-center py-3">
            <p className="text-green-400 text-sm font-medium">Em chamada</p>
            <p className="text-white text-lg font-mono mt-1">{callNumber}</p>
            <p className="text-blue-400 text-3xl font-mono mt-2 tabular-nums">
              {formatDuration(callDuration)}
            </p>
            <button
              onClick={hangup}
              className="mt-4 w-full bg-red-600 hover:bg-red-500 active:bg-red-700 text-white py-3 rounded-xl font-semibold transition-colors"
            >
              Encerrar
            </button>
          </div>
        )}

        {callStatus === 'ended' && (
          <div className="text-center py-3">
            <p className="text-slate-400 text-sm">Chamada encerrada</p>
          </div>
        )}
      </div>

      <button
        onClick={handleLogout}
        className="w-full mt-4 text-slate-600 hover:text-slate-400 text-xs transition-colors py-2"
      >
        Sair do ramal {extension}
      </button>

      {/* Elemento de áudio para o stream remoto da chamada */}
      <audio ref={audioRef} autoPlay hidden />
    </div>
  )
}
