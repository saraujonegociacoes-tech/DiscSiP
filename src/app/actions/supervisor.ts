'use server'

import { createServerClient } from '@/lib/supabase/server'
import { hourInBRT } from '@/lib/timezone'
import { sanitizePeriod, type LeadPeriod } from '@/lib/period'
import type { Campaign, CallDirection, CallStatus } from '@/lib/types/database'

const HISTORY_PAGE_SIZE = 30

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

export interface CallHistoryRow {
  id: string
  agentName: string | null
  campaignName: string | null
  phoneNumber: string
  direction: CallDirection
  status: CallStatus
  disposition: string | null
  durationSeconds: number
  createdAt: string
}

// Histórico de chamadas do supervisor: período (obrigatório) + agente/campanha (opcionais),
// paginado. Nomes de agente/campanha são resolvidos à parte (evita depender de embed/FK do
// PostgREST) a partir dos poucos ids distintos da página atual.
export async function getCallHistoryFiltered(params: {
  period: LeadPeriod
  agentId?: string
  campaignId?: string
  page?: number
}): Promise<{ rows: CallHistoryRow[]; hasMore: boolean }> {
  const period = sanitizePeriod(params.period)
  const supabase = await createServerClient()
  const page = params.page ?? 0
  const from = page * HISTORY_PAGE_SIZE
  const to = from + HISTORY_PAGE_SIZE - 1

  let query = supabase
    .from('call_logs')
    .select('id, agent_id, campaign_id, phone_number, direction, status, disposition, duration_seconds, created_at')
    .gte('created_at', period.start)
    .lt('created_at', period.end)
    .order('created_at', { ascending: false })
    .range(from, to)

  if (params.agentId) query = query.eq('agent_id', params.agentId)
  if (params.campaignId) query = query.eq('campaign_id', params.campaignId)

  const { data } = await query
  const logs = (data ?? []) as {
    id: string
    agent_id: string | null
    campaign_id: string | null
    phone_number: string
    direction: CallDirection
    status: CallStatus
    disposition: string | null
    duration_seconds: number
    created_at: string
  }[]

  const agentIds = [...new Set(logs.map((l) => l.agent_id).filter((v): v is string => !!v))]
  const campaignIds = [...new Set(logs.map((l) => l.campaign_id).filter((v): v is string => !!v))]

  const [agentRows, campaignRows] = await Promise.all([
    agentIds.length
      ? supabase.from('profiles').select('id, name').in('id', agentIds).then((r) => r.data ?? [])
      : Promise.resolve([] as { id: string; name: string }[]),
    campaignIds.length
      ? supabase.from('campaigns').select('id, name').in('id', campaignIds).then((r) => r.data ?? [])
      : Promise.resolve([] as { id: string; name: string }[]),
  ])

  const agentNames = new Map(agentRows.map((a) => [a.id, a.name]))
  const campaignNames = new Map(campaignRows.map((c) => [c.id, c.name]))

  const rows: CallHistoryRow[] = logs.map((l) => ({
    id: l.id,
    agentName: l.agent_id ? (agentNames.get(l.agent_id) ?? null) : null,
    campaignName: l.campaign_id ? (campaignNames.get(l.campaign_id) ?? null) : null,
    phoneNumber: l.phone_number,
    direction: l.direction,
    status: l.status,
    disposition: l.disposition,
    durationSeconds: l.duration_seconds,
    createdAt: l.created_at,
  }))

  return { rows, hasMore: logs.length === HISTORY_PAGE_SIZE }
}
