'use server'

import { createServerClient } from '@/lib/supabase/server'
import { hourInBRT } from '@/lib/timezone'
import type { Campaign } from '@/lib/types/database'

export interface DashboardStats {
  totalContacts: number
  contactedPercent: number
  callsToday: number
  activeAgents: number
}

export interface CampaignSummary {
  id: string
  name: string
  status: Campaign['status']
  total: number
  pending: number
  answered: number
  contactedPercent: number
}

export interface CallsByHour {
  hour: string
  calls: number
}

export interface AgentActivity {
  agentId: string
  name: string
  extension: number
  lastCallAt: string | null
  callsToday: number
  lastStatus: string | null
  // Presença em tempo real (heartbeat do softphone). online = visto há < 60s.
  online: boolean
  dialerStatus: 'idle' | 'running' | 'paused' | 'completed' | null
}

// Heartbeat visto há menos disto = agente online (3× o intervalo de ~20s do softphone)
const PRESENCE_FRESH_MS = 60_000

export async function getDashboardStats(): Promise<DashboardStats> {
  const supabase = await createServerClient()

  // Agregação feita no banco (view v_dashboard_stats) — o Worker só lê 1 linha.
  const { data } = await supabase.from('v_dashboard_stats').select('*').single()

  const total = data?.total_contacts ?? 0
  const contacted = data?.contacted ?? 0

  return {
    totalContacts: total,
    contactedPercent: total > 0 ? Math.round((contacted / total) * 100) : 0,
    callsToday: data?.calls_today ?? 0,
    activeAgents: data?.active_agents ?? 0,
  }
}

export async function getCampaignsSummary(): Promise<CampaignSummary[]> {
  const supabase = await createServerClient()

  // v_campaign_summary já agrega por campanha (LEFT JOIN + GROUP BY no banco).
  const { data } = await supabase.from('v_campaign_summary').select('*')

  const rows = (data ?? []) as {
    id: string
    name: string
    status: Campaign['status']
    total: number
    pending: number
    answered: number
    contacted: number
  }[]

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    total: r.total,
    pending: r.pending,
    answered: r.answered,
    contactedPercent: r.total > 0 ? Math.round((r.contacted / r.total) * 100) : 0,
  }))
}

export async function getCallsByHour(): Promise<CallsByHour[]> {
  const supabase = await createServerClient()

  // v_calls_by_hour_today devolve só as horas com chamadas (≤24 linhas), já no
  // fuso BRT. Aqui só preenchemos de 00h até a hora atual (formato do CallsChart).
  const { data } = await supabase.from('v_calls_by_hour_today').select('*')

  const buckets: Record<number, number> = {}
  for (const row of (data ?? []) as { hour: number; calls: number }[]) {
    buckets[row.hour] = row.calls
  }

  const now = hourInBRT(new Date())
  return Array.from({ length: now + 1 }, (_, h) => ({
    hour: `${String(h).padStart(2, '0')}h`,
    calls: buckets[h] ?? 0,
  }))
}

export async function getAgentActivity(): Promise<AgentActivity[]> {
  const supabase = await createServerClient()

  // v_agent_activity já agrega os logs de hoje por agente e junta a presença no
  // banco. Aqui só derivamos online (visto < 60s) e o dialerStatus — trivial.
  const { data } = await supabase.from('v_agent_activity').select('*')

  const rows = (data ?? []) as {
    agent_id: string
    name: string
    extension: number
    last_call_at: string | null
    calls_today: number
    last_status: string | null
    dialer_status: AgentActivity['dialerStatus']
    last_seen_at: string | null
  }[]

  const now = Date.now()

  return rows.map((r) => {
    const online =
      !!r.last_seen_at && now - new Date(r.last_seen_at).getTime() < PRESENCE_FRESH_MS
    return {
      agentId: r.agent_id,
      name: r.name,
      extension: r.extension,
      lastCallAt: r.last_call_at,
      callsToday: r.calls_today,
      lastStatus: r.last_status,
      online,
      dialerStatus: online ? (r.dialer_status ?? 'idle') : null,
    }
  })
}
