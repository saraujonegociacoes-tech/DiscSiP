'use client'

// Som de notificacao: clipe curto (~0.77s, AAC/MP4) embutido como data URI base64
// (ver notification-sound-data.ts) para nao depender de asset externo — mesma politica
// de CSP do sino. A preferencia de mudo fica no localStorage (som ligado por padrao).
//
// Autoplay: navegadores bloqueiam audio.play() disparado fora de um gesto do usuario. Como
// o som toca a partir de um evento de realtime (nao de um clique), "destravamos" o elemento
// no primeiro gesto da pessoa na pagina (primeNotificationSound); dai os toques seguintes
// vindos do realtime passam a ser permitidos.

import { NOTIFICATION_SOUND_DATA_URI } from './notification-sound-data'

const MUTE_KEY = 'bluedesk:notif-muted'

export function isNotificationMuted(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(MUTE_KEY) === '1'
}

export function setNotificationMuted(muted: boolean): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
}

// Um unico elemento reaproveitado — evita empilhar Audio a cada notificacao.
let audio: HTMLAudioElement | null = null

function element(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null
  if (!audio) {
    audio = new Audio(NOTIFICATION_SOUND_DATA_URI)
    audio.preload = 'auto'
  }
  return audio
}

let primed = false

/**
 * Destrava o audio no primeiro gesto do usuario (clique/tecla), para que os toques
 * seguintes disparados por eventos de realtime nao sejam bloqueados pelo autoplay.
 * Idempotente; chamar uma vez ao montar o sino.
 */
export function primeNotificationSound(): void {
  if (typeof window === 'undefined' || primed) return
  primed = true
  const unlock = () => {
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
    const el = element()
    if (!el) return
    // Toca mudo dentro do gesto so para "liberar" o elemento; depois reseta.
    el.muted = true
    el.play()
      .then(() => {
        el.pause()
        el.currentTime = 0
        el.muted = false
      })
      .catch(() => {
        el.muted = false
      })
  }
  window.addEventListener('pointerdown', unlock, { once: true })
  window.addEventListener('keydown', unlock, { once: true })
}

/** Toca o clipe de notificacao. No-op se estiver mudo (preferencia do usuario). */
export function playNotificationSound(): void {
  if (isNotificationMuted()) return
  const el = element()
  if (!el) return
  // Defensivo: a rotina de "priming" toca mudo pra destravar; se por corrida o elemento
  // ficou mudo/volume zerado, garante audivel aqui.
  el.muted = false
  el.volume = 1
  try {
    el.currentTime = 0
  } catch {
    // alguns browsers reclamam se setado antes dos metadados — ignora
  }
  const p = el.play()
  // Nao engole mais o erro: registra o motivo pra facilitar diagnostico.
  // NotAllowedError = autoplay bloqueado (nenhum clique na aba ainda neste carregamento).
  if (p && typeof p.catch === 'function') {
    p.catch((err: unknown) => {
      const e = err as { name?: string; message?: string }
      console.warn(`[notif] som nao tocou: ${e?.name ?? 'erro'} — ${e?.message ?? ''}`)
    })
  }
}
