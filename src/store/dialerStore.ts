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

  setCampaign: (campaign: Campaign | null) => void
  setCurrentContact: (contact: CampaignContact | null) => void
  setDialerStatus: (status: DialerStatus) => void
  setPendingDisposition: (pending: boolean) => void
  setPauseBetweenCalls: (seconds: number) => void
  setParallelBatch: (contacts: CampaignContact[]) => void
  reset: () => void
}

export const useDialerStore = create<DialerState>((set) => ({
  campaign: null,
  currentContact: null,
  dialerStatus: 'idle',
  pauseBetweenCalls: 3,
  pendingDisposition: false,
  parallelBatch: [],

  setCampaign: (campaign) => set({ campaign }),
  setCurrentContact: (contact) => set({ currentContact: contact }),
  setDialerStatus: (status) => set({ dialerStatus: status }),
  setPendingDisposition: (pending) => set({ pendingDisposition: pending }),
  setPauseBetweenCalls: (seconds) => set({ pauseBetweenCalls: seconds }),
  setParallelBatch: (contacts) => set({ parallelBatch: contacts }),

  reset: () =>
    set({
      campaign: null,
      currentContact: null,
      dialerStatus: 'idle',
      pendingDisposition: false,
      parallelBatch: [],
    }),
}))
