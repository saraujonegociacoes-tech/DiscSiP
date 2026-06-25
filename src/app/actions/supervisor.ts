'use server'

import { createServerClient } from '@/lib/supabase/server'
import { hourInBRT, brtTodayStartUtcISO } from '@/lib/timezone'
import type { CallLog, Campaign } from '@/lib/types/database'

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

  const todayStartISO = brtTodayStartUtcISO()

  const [contactsRes, callsTodayRes, agentsRes] = await Promise.all([
    supabase.from('campaign_contacts').select('status'),
    supabase
      .from('call_logs')
      .select('agent_id')
      .gte('created_at', todayStartISO),
    supabase
      .from('call_logs')
      .select('agent_id')
      .gte('created_at', todayStartISO),
  ])

  const contacts = contactsRes.data ?? []
  const total = contacts.length
  const contacted = contacts.filter((c) =>
    ['answered', 'no_answer', 'busy', 'failed', 'do_not_call'].includes(c.status)
  ).length

  const callsToday = callsTodayRes.data?.length ?? 0
  const activeAgents = new Set(agentsRes.data?.map((r) => r.agent_id) ?? []).size

  return {
    totalContacts: total,
    contactedPercent: total > 0 ? Math.round((contacted / total) * 100) : 0,
    callsToday,
    activeAgents,
  }
}

export async function getCampaignsSummary(): Promise<CampaignSummary[]> {
  const supabase = await createServerClient()

  const [campaignsRes, contactsRes] = await Promise.all([
    supabase.from('campaigns').select('*').order('created_at', { ascending: false }),
    supabase.from('campaign_contacts').select('campaign_id, status'),
  ])

  const campaigns = (campaignsRes.data ?? []) as Campaign[]
  const contacts = contactsRes.data ?? []

  return campaigns.map((c) => {
    const cc = contacts.filter((x) => x.campaign_id === c.id)
    const total = cc.length
    const pending = cc.filter((x) => x.status === 'pending').length
    const answered = cc.filter((x) => x.status === 'answered').length
    const contacted = cc.filter((x) =>
      ['answered', 'no_answer', 'busy', 'failed', 'do_not_call'].includes(x.status)
    ).length
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      total,
      pending,
      answered,
      contactedPercent: total > 0 ? Math.round((contacted / total) * 100) : 0,
    }
  })
}

export async function getCallsByHour(): Promise<CallsByHour[]> {
  const supabase = await createServerClient()

  const { data } = await supabase
    .from('call_logs')
    .select('created_at')
    .gte('created_at', brtTodayStartUtcISO())

  const buckets: Record<number, number> = {}
  for (let h = 0; h < 24; h++) buckets[h] = 0

  for (const row of data ?? []) {
    const h = hourInBRT(new Date(row.created_at))
    buckets[h] = (buckets[h] ?? 0) + 1
  }

  const now = hourInBRT(new Date())
  return Array.from({ length: now + 1 }, (_, h) => ({
    hour: `${String(h).padStart(2, '0')}h`,
    calls: buckets[h] ?? 0,
  }))
}

export async function getAgentActivity(): Promise<AgentActivity[]> {
  const supabase = await createServerClient()

  const todayStartISO = brtTodayStartUtcISO()

  const [agentsRes, logsRes, presenceRes] = await Promise.all([
    // Quem tem ramal atribuído aparece como agente na atividade do dashboard
    supabase
      .from('profiles')
      .select('id, name, extension')
      .not('extension', 'is', null)
      .order('extension'),
    supabase
      .from('call_logs')
      .select('agent_id, created_at, status')
      .gte('created_at', todayStartISO)
      .order('created_at', { ascending: false }),
    supabase.from('agent_presence').select('agent_id, dialer_status, last_seen_at'),
  ])

  const agents = (agentsRes.data ?? []) as { id: string; name: string; extension: number }[]
  const logs = (logsRes.data ?? []) as Pick<CallLog, 'agent_id' | 'created_at' | 'status'>[]
  const presence = new Map(
    ((presenceRes.data ?? []) as {
      agent_id: string
      dialer_status: AgentActivity['dialerStatus']
      last_seen_at: string
    }[]).map((p) => [p.agent_id, p])
  )

  const now = Date.now()

  return agents.map((a) => {
    const agentLogs = logs.filter((l) => l.agent_id === a.id)
    const last = agentLogs[0] ?? null
    const p = presence.get(a.id)
    const online = !!p && now - new Date(p.last_seen_at).getTime() < PRESENCE_FRESH_MS
    return {
      agentId: a.id,
      name: a.name,
      extension: a.extension,
      lastCallAt: last?.created_at ?? null,
      callsToday: agentLogs.length,
      lastStatus: last?.status ?? null,
      online,
      dialerStatus: online ? (p?.dialer_status ?? 'idle') : null,
    }
  })
}
