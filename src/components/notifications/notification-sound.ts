'use client'

// Som de notificacao: primeiros ~4s de "ola-macaquito-messi", embutido como data URI
// base64 (ver notification-sound-data.ts) para nao depender de asset externo — mesma
// politica de CSP do restante do sino. A preferencia de mudo fica no localStorage
// (ligado por padrao; a pessoa pode silenciar no painel do sino).

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

/** Toca o clipe de notificacao (~4s). No-op se estiver mudo. */
export function playNotificationSound(): void {
  if (isNotificationMuted()) return
  const el = element()
  if (!el) return
  try {
    el.currentTime = 0
  } catch {
    // alguns browsers reclamam se setado antes dos metadados — ignora
  }
  el.play().catch(() => {
    // politica de autoplay pode bloquear ate a 1a interacao do usuario — silencioso
  })
}
