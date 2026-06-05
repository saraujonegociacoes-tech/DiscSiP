'use client'

import { create } from 'zustand'

export type SipStatus = 'disconnected' | 'connecting' | 'registered' | 'error'
export type CallStatus = 'idle' | 'ringing' | 'answered' | 'ended'

interface SoftphoneState {
  agentId: string | null
  agentName: string | null
  extension: number | null
  sipStatus: SipStatus
  sipError: string | null
  callStatus: CallStatus
  callNumber: string | null
  callStartedAt: Date | null
  setAgent: (id: string, name: string, extension: number) => void
  setSipStatus: (status: SipStatus, error?: string) => void
  setCallStatus: (status: CallStatus, number?: string) => void
  resetCall: () => void
  logout: () => void
}

export const useSoftphoneStore = create<SoftphoneState>((set) => ({
  agentId: null,
  agentName: null,
  extension: null,
  sipStatus: 'disconnected',
  sipError: null,
  callStatus: 'idle',
  callNumber: null,
  callStartedAt: null,

  setAgent: (id, name, extension) =>
    set({ agentId: id, agentName: name, extension }),

  setSipStatus: (status, error) =>
    set({ sipStatus: status, sipError: error ?? null }),

  setCallStatus: (status, number) =>
    set({
      callStatus: status,
      callNumber: number ?? null,
      callStartedAt: status === 'answered' ? new Date() : null,
    }),

  resetCall: () =>
    set({ callStatus: 'idle', callNumber: null, callStartedAt: null }),

  logout: () =>
    set({
      agentId: null,
      agentName: null,
      extension: null,
      sipStatus: 'disconnected',
      sipError: null,
      callStatus: 'idle',
      callNumber: null,
      callStartedAt: null,
    }),
}))
