'use client'

// Som de notificacao gerado via WebAudio (sem asset externo — atende a CSP) e a
// preferencia de mudo (localStorage). Ligado por padrao; a pessoa pode silenciar
// no painel do sino.

const MUTE_KEY = 'bluedesk:notif-muted'

export function isNotificationMuted(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(MUTE_KEY) === '1'
}

export function setNotificationMuted(muted: boolean): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
}

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext }

let ctx: AudioContext | null = null

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AC = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext
  if (!AC) return null
  if (!ctx) ctx = new AC()
  return ctx
}

/** Chime curto e discreto (dois tons ascendentes). No-op se estiver mudo. */
export function playNotificationSound(): void {
  if (isNotificationMuted()) return
  const ac = audioContext()
  if (!ac) return
  if (ac.state === 'suspended') ac.resume().catch(() => {})

  const now = ac.currentTime
  const notes: Array<[number, number]> = [
    [880, 0], // A5
    [1174.66, 0.12], // D6
  ]
  for (const [freq, offset] of notes) {
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    const t = now + offset
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.15, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
    osc.connect(gain).connect(ac.destination)
    osc.start(t)
    osc.stop(t + 0.24)
  }
}
