'use server'

import { createServerClient } from '@/lib/supabase/server'
import { sanitizePeriod, type LeadPeriod } from '@/lib/period'
import type { CallLog } from '@/lib/types/database'

const HISTORY_PAGE_SIZE = 30

interface SaveCallLogInput {
  agentId: string
  extension: number
  phoneNumber: string
  direction: 'inbound' | 'outbound'
  status: 'answered' | 'no_answer' | 'busy' | 'failed'
  durationSeconds: number
  startedAt: string | null
  endedAt: string | null
  campaignId?: string
  // Tabulação registrada pelo agente (value da disposição, ex.: 'interested'). É o que o
  // histórico exibe — sem isso o status grosso (answered/no_answer) era tudo que aparecia.
  disposition?: string
}

export async function saveCallLog(
  input: SaveCallLogInput
): Promise<{ id?: string; error?: string }> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('call_logs')
    .insert({
      agent_id: input.agentId,
      extension: input.extension,
      phone_number: input.phoneNumber,
      direction: input.direction,
      status: input.status,
      duration_seconds: input.durationSeconds,
      started_at: input.startedAt,
      ended_at: input.endedAt,
      ...(input.campaignId && { campaign_id: input.campaignId }),
      ...(input.disposition && { disposition: input.disposition }),
    })
    .select('id')
    .single()

  if (error) return { error: error.message }
  return { id: data?.id }
}

// Histórico do agente filtrado por período (ciclo do PeriodPicker), paginado — um ciclo
// inteiro tem bem mais que as 20 ligações que o histórico mostrava antes.
export async function getCallHistory(
  agentId: string,
  periodInput: LeadPeriod,
  page = 0
): Promise<{ logs: CallLog[]; hasMore: boolean }> {
  const period = sanitizePeriod(periodInput)
  const supabase = await createServerClient()
  const from = page * HISTORY_PAGE_SIZE
  const to = from + HISTORY_PAGE_SIZE - 1
  const { data } = await supabase
    .from('call_logs')
    .select('*')
    .eq('agent_id', agentId)
    .gte('created_at', period.start)
    .lt('created_at', period.end)
    .order('created_at', { ascending: false })
    .range(from, to)

  const logs = (data ?? []) as CallLog[]
  return { logs, hasMore: logs.length === HISTORY_PAGE_SIZE }
}
