'use client'

import { useState } from 'react'
import { Mic, MicOff, Volume2, VolumeX, PhoneOff } from 'lucide-react'
import { useSoftphoneStore } from '@/store/softphoneStore'
import { useDialerStore } from '@/store/dialerStore'
import { getTransport } from '@/lib/telephony'
import { cn } from '@/lib/utils'

// O painel de áudio (mute mic/alto-falante) precisa do helper >= 1.7 (endpoint /mute). Em
// versões antigas o /mute não existe, então deixamos os botões desabilitados com um aviso —
// o site fica compatível com helpers 1.6 e 1.7 durante o rollout. O "Desligar" funciona em 1.6.
function helperSupportsMute(version: string | null): boolean {
  if (!version) return false
  const [a, b] = version.split('.').map((n) => parseInt(n, 10) || 0)
  return a > 1 || (a === 1 && b >= 7)
}

// Painel de controle da discagem ativa: o agente liga/desliga mic e alto-falante e encerra a
// chamada. Só aparece depois do "Iniciar discagem" (discador rodando/pausado) — não na seleção
// da campanha. O mute é guardado no store e reaplicado pelo helper a cada discagem, então
// esconder/mostrar o painel não faz o estado divergir.
export function CallControls() {
  const {
    callStatus,
    helperOnline,
    helperVersion,
    micMuted,
    speakerMuted,
    manualActive,
    setMuted,
    setCallStatus,
  } = useSoftphoneStore()
  const { dialerStatus } = useDialerStore()
  const [busy, setBusy] = useState<'mic' | 'speaker' | 'hangup' | null>(null)

  const muteReady = helperOnline && helperSupportsMute(helperVersion)
  const inCall = callStatus === 'calling' || callStatus === 'answered'

  const toggle = async (device: 'mic' | 'speaker') => {
    if (!muteReady || busy) return
    const target = device === 'mic' ? !micMuted : !speakerMuted
    setBusy(device)
    try {
      // Só vira o botão se o transporte confirmou que aplicou (assertividade: a UI não mente).
      const applied = await getTransport().setMuted(device, target)
      if (applied) setMuted(device, target)
    } finally {
      setBusy(null)
    }
  }

  const hangup = async () => {
    if (!helperOnline || busy) return
    setBusy('hangup')
    try {
      await getTransport().hangup()
    } finally {
      setBusy(null)
    }
    if (inCall) setCallStatus('ended')
  }

  // Só aparece com a discagem iniciada (rodando ou pausada). Pausar não derruba a chamada em
  // curso, então o painel continua à mão; some na seleção da campanha e quando a campanha conclui.
  // Vale também para a discagem manual: mutar e desligar são os mesmos comandos do helper.
  const dialerActive = dialerStatus === 'running' || dialerStatus === 'paused'
  if (!dialerActive && !manualActive) return null

  const btn =
    'inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <div className="mb-6 rounded-2xl border border-border bg-gradient-card px-4 py-3 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Áudio
        </span>

        <button
          onClick={() => toggle('mic')}
          disabled={!muteReady || busy !== null}
          className={cn(
            btn,
            micMuted
              ? 'bg-destructive/15 text-destructive hover:bg-destructive/25'
              : 'border border-border bg-background/40 text-foreground hover:bg-accent/60'
          )}
        >
          {micMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {micMuted ? 'Microfone mudo' : 'Microfone'}
        </button>

        <button
          onClick={() => toggle('speaker')}
          disabled={!muteReady || busy !== null}
          className={cn(
            btn,
            speakerMuted
              ? 'bg-destructive/15 text-destructive hover:bg-destructive/25'
              : 'border border-border bg-background/40 text-foreground hover:bg-accent/60'
          )}
        >
          {speakerMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          {speakerMuted ? 'Som mudo' : 'Som'}
        </button>

        <button
          onClick={hangup}
          disabled={!helperOnline || busy !== null}
          className={cn(btn, 'ml-auto bg-destructive text-destructive-foreground hover:bg-destructive/90')}
        >
          <PhoneOff className="h-4 w-4" /> Desligar
        </button>
      </div>

      {helperOnline && !helperSupportsMute(helperVersion) && (
        <p className="mt-2 text-xs text-warning">
          Mute indisponível neste helper — atualize para a v1.7 para liberar.
        </p>
      )}
    </div>
  )
}
