'use server'

import { createServerClient } from '@/lib/supabase/server'
import type { CallLog } from '@/lib/types/database'

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

export async function getCallHistory(agentId: string): Promise<CallLog[]> {
  const supabase = await createServerClient()
  const { data } = await supabase
    .from('call_logs')
    .select('*')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(20)

  return (data ?? []) as CallLog[]
}
