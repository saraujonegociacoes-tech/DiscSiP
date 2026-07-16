'use client'

import { create } from 'zustand'
import type { Profile, Role } from '@/lib/types/database'

// 'answered' é usado no modo paralelo: a chamada foi atendida e o agente deve falar agora
// (no modo 1-a-1 vai direto de 'calling' para 'ended').
export type CallStatus = 'idle' | 'calling' | 'answered' | 'ended'

interface AgentState {
  agentId: string | null
  agentName: string | null
  extension: number | null
  role: Role | null
  departmentId: string | null
  // Slug estável do departamento ('comercial' | 'cs' | 'negociacao' | null) — escopa os
  // grupos de vertical no Sidebar (ver setProfile).
  departmentSlug: string | null
  callStatus: CallStatus
  callNumber: string | null
  callStartedAt: Date | null
  helperOnline: boolean
  helperVersion: string | null
  // Estado do painel de áudio. O painel fica sempre visível e é a fonte de verdade do mute
  // (o MicroSIP não devolve o estado real), então persiste entre chamadas até o agente trocar.
  micMuted: boolean
  speakerMuted: boolean

  setProfile: (profile: Profile) => void
  setCallStatus: (status: CallStatus, number?: string) => void
  setHelperOnline: (online: boolean, version?: string | null) => void
  setMuted: (device: 'mic' | 'speaker', muted: boolean) => void
  resetCall: () => void
  logout: () => void
}

export const useSoftphoneStore = create<AgentState>((set) => ({
  agentId: null,
  agentName: null,
  extension: null,
  role: null,
  departmentId: null,
  departmentSlug: null,
  callStatus: 'idle',
  callNumber: null,
  callStartedAt: null,
  helperOnline: false,
  helperVersion: null,
  micMuted: false,
  speakerMuted: false,

  setProfile: (profile) =>
    set({
      agentId: profile.id,
      agentName: profile.name,
      extension: profile.extension,
      role: profile.role,
      departmentId: profile.department_id,
      departmentSlug: profile.department_slug ?? null,
    }),

  setCallStatus: (status, number) =>
    set((state) => ({
      callStatus: status,
      callNumber:
        status === 'calling' || status === 'answered' ? (number ?? state.callNumber) : state.callNumber,
      // No 1-a-1 o cronômetro começa em 'calling'. No paralelo a conversa só começa quando
      // alguém atende, então 'answered' (re)inicia o cronômetro. Preserva em 'ended' para a
      // duração ser calculada na disposição; só zera ao voltar para 'idle'.
      callStartedAt:
        status === 'calling' || status === 'answered'
          ? new Date()
          : status === 'idle'
            ? null
            : state.callStartedAt,
    })),

  setHelperOnline: (online, version) =>
    set((state) => ({
      helperOnline: online,
      helperVersion: online ? (version ?? state.helperVersion) : null,
    })),

  setMuted: (device, muted) =>
    set(device === 'mic' ? { micMuted: muted } : { speakerMuted: muted }),

  resetCall: () => set({ callStatus: 'idle', callNumber: null, callStartedAt: null }),

  logout: () =>
    set({
      agentId: null,
      agentName: null,
      extension: null,
      role: null,
      departmentId: null,
      callStatus: 'idle',
      callNumber: null,
      callStartedAt: null,
      helperOnline: false,
      helperVersion: null,
      micMuted: false,
      speakerMuted: false,
    }),
}))
