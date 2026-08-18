'use client'

// Ponto único de acesso à telefonia. Quem disca no Blue Desk passa por aqui — nunca mais por um
// `fetch` direto no helper.
//
// Hoje só existe o transporte `helper` (o fluxo em produção). O `webrtc` entra na Etapa 3 do
// plano e é plugado em `createTransport` sem tocar em nenhum componente:
// docs/discadora-docs/updates/softphone-webrtc-navegador.md

import { createHelperTransport } from './helperTransport'
import type { TelephonyMode, TelephonyTransport } from './types'

export * from './types'
export * from './number'

let current: TelephonyTransport | null = null
let currentMode: TelephonyMode = 'helper'

function createTransport(mode: TelephonyMode): TelephonyTransport {
  switch (mode) {
    case 'webrtc':
      // Etapa 3 — softphone no navegador (sip.js). Enquanto não existe, cair no helper é o
      // comportamento seguro: um agente marcado como 'webrtc' cedo demais continua discando.
      return createHelperTransport()
    case 'helper':
    default:
      return createHelperTransport()
  }
}

/** Transporte ativo. Cria sob demanda — seguro de chamar em qualquer render do cliente. */
export function getTransport(): TelephonyTransport {
  if (!current) current = createTransport(currentMode)
  return current
}

/** Modo ativo (por agente, vindo do banco na Etapa 2). */
export function getTelephonyMode(): TelephonyMode {
  return currentMode
}

/**
 * Troca o transporte em runtime. É o que permite migrar um agente de cada vez e voltar atrás
 * sem rebuild — uma flag `NEXT_PUBLIC_*` seria assada no build e não serviria (mesma armadilha
 * anotada no `.env.example` do `NEXT_PUBLIC_CEO_ENABLED`).
 */
export async function setTelephonyMode(mode: TelephonyMode): Promise<TelephonyTransport> {
  if (current && currentMode === mode) return current
  if (current) await current.dispose().catch(() => {})
  currentMode = mode
  current = createTransport(mode)
  await current.init().catch(() => {})
  return current
}
