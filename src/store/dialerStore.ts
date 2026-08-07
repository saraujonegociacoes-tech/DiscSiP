'use client'

import { create } from 'zustand'
import type { Campaign, CampaignContact } from '@/lib/types/database'

export type DialerStatus = 'idle' | 'running' | 'paused' | 'completed'

interface DialerState {
  campaign: Campaign | null
  currentContact: CampaignContact | null
  dialerStatus: DialerStatus
  pauseBetweenCalls: number // segundos entre chamadas
  pendingDisposition: boolean // aguardando agente definir disposição
  parallelBatch: CampaignContact[] // contatos do lote em discagem paralela (modo preditivo)
  // Id da sessão paralela no helper (retornado pelo /dial-parallel). O /parallel-status só é
  // aceito quando o id bate — sem isso a UI pode ler o resultado do lote ANTERIOR (que fica
  // no helper com um vencedor já definido) e resolver o lote novo com dados velhos.
  parallelSessionId: number | null
  // Último erro que impediu a discagem (ex.: MicroSIP em chamada única, helper offline).
  // Mostrado ao agente em vez de deixar a tela parada sem explicação.
  dialerError: string | null

  setCampaign: (campaign: Campaign | null) => void
  setCurrentContact: (contact: CampaignContact | null) => void
  setDialerStatus: (status: DialerStatus) => void
  setPendingDisposition: (pending: boolean) => void
  setPauseBetweenCalls: (seconds: number) => void
  setParallelBatch: (contacts: CampaignContact[]) => void
  setParallelSessionId: (id: number | null) => void
  setDialerError: (message: string | null) => void
  reset: () => void
}

export const useDialerStore = create<DialerState>((set) => ({
  campaign: null,
  currentContact: null,
  dialerStatus: 'idle',
  pauseBetweenCalls: 3,
  pendingDisposition: false,
  parallelBatch: [],
  parallelSessionId: null,
  dialerError: null,

  setCampaign: (campaign) => set({ campaign }),
  setCurrentContact: (contact) => set({ currentContact: contact }),
  setDialerStatus: (status) => set({ dialerStatus: status }),
  setPendingDisposition: (pending) => set({ pendingDisposition: pending }),
  setPauseBetweenCalls: (seconds) => set({ pauseBetweenCalls: seconds }),
  setParallelBatch: (contacts) => set({ parallelBatch: contacts }),
  setParallelSessionId: (id) => set({ parallelSessionId: id }),
  setDialerError: (message) => set({ dialerError: message }),

  reset: () =>
    set({
      campaign: null,
      currentContact: null,
      dialerStatus: 'idle',
      pendingDisposition: false,
      parallelBatch: [],
      parallelSessionId: null,
      dialerError: null,
    }),
}))
