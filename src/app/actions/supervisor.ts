'use server'

import { createServerClient } from '@/lib/supabase/server'
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
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const supabase = createServerClient()

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const [contactsRes, callsTodayRes, agentsRes] = await Promise.all([
    supabase.from('campaign_contacts').select('status'),
    supabase
      .from('call_logs')
      .select('agent_id')
      .gte('created_at', todayStart.toISOString()),
    supabase
      .from('call_logs')
      .select('agent_id')
      .gte('created_at', todayStart.toISOString()),
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
  const supabase = createServerClient()

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
  const supabase = createServerClient()

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const { data } = await supabase
    .from('call_logs')
    .select('created_at')
    .gte('created_at', todayStart.toISOString())

  const buckets: Record<number, number> = {}
  for (let h = 0; h < 24; h++) buckets[h] = 0

  for (const row of data ?? []) {
    const h = new Date(row.created_at).getHours()
    buckets[h] = (buckets[h] ?? 0) + 1
  }

  const now = new Date().getHours()
  return Array.from({ length: now + 1 }, (_, h) => ({
    hour: `${String(h).padStart(2, '0')}h`,
    calls: buckets[h] ?? 0,
  }))
}

export async function getAgentActivity(): Promise<AgentActivity[]> {
  const supabase = createServerClient()

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const [agentsRes, logsRes] = await Promise.all([
    supabase.from('agents').select('id, name, extension').order('extension'),
    supabase
      .from('call_logs')
      .select('agent_id, created_at, status')
      .gte('created_at', todayStart.toISOString())
      .order('created_at', { ascending: false }),
  ])

  const agents = agentsRes.data ?? []
  const logs = (logsRes.data ?? []) as Pick<CallLog, 'agent_id' | 'created_at' | 'status'>[]

  return agents.map((a) => {
    const agentLogs = logs.filter((l) => l.agent_id === a.id)
    const last = agentLogs[0] ?? null
    return {
      agentId: a.id,
      name: a.name,
      extension: a.extension,
      lastCallAt: last?.created_at ?? null,
      callsToday: agentLogs.length,
      lastStatus: last?.status ?? null,
    }
  })
}
