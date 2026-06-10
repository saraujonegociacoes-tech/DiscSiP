'use client'

import { create } from 'zustand'

export type CallStatus = 'idle' | 'calling' | 'ended'

interface AgentState {
  agentId: string | null
  agentName: string | null
  extension: number | null
  callStatus: CallStatus
  callNumber: string | null
  callStartedAt: Date | null
  helperOnline: boolean

  setAgent: (id: string, name: string, extension: number) => void
  setCallStatus: (status: CallStatus, number?: string) => void
  setHelperOnline: (online: boolean) => void
  resetCall: () => void
  logout: () => void
}

export const useSoftphoneStore = create<AgentState>((set) => ({
  agentId: null,
  agentName: null,
  extension: null,
  callStatus: 'idle',
  callNumber: null,
  callStartedAt: null,
  helperOnline: false,

  setAgent: (id, name, extension) => set({ agentId: id, agentName: name, extension }),

  setCallStatus: (status, number) =>
    set((state) => ({
      callStatus: status,
      callNumber: status === 'calling' ? (number ?? null) : state.callNumber,
      // Preserva o início da chamada em 'ended' para a duração ser calculada na disposição;
      // só zera ao voltar para 'idle'
      callStartedAt:
        status === 'calling' ? new Date() : status === 'idle' ? null : state.callStartedAt,
    })),

  setHelperOnline: (online) => set({ helperOnline: online }),

  resetCall: () => set({ callStatus: 'idle', callNumber: null, callStartedAt: null }),

  logout: () =>
    set({
      agentId: null,
      agentName: null,
      extension: null,
      callStatus: 'idle',
      callNumber: null,
      callStartedAt: null,
      helperOnline: false,
    }),
}))
