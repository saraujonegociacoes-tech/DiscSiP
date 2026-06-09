'use server'

import { createServerClient } from '@/lib/supabase/server'
import type { Agent, CallLog } from '@/lib/types/database'

type AgentResult = { agent: Agent } | { error: string }

export async function getAgentByExtension(extension: number): Promise<AgentResult> {
  if (extension < 5125 || extension > 5150) {
    return { error: 'Ramal inválido. Use um ramal entre 5125 e 5150.' }
  }

  const supabase = createServerClient()
  const { data: agent, error } = await supabase
    .from('agents')
    .select('*')
    .eq('extension', extension)
    .single()

  if (error || !agent) {
    return { error: 'Ramal não encontrado.' }
  }

  return { agent: agent as Agent }
}

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
}

export async function saveCallLog(
  input: SaveCallLogInput
): Promise<{ id?: string; error?: string }> {
  const supabase = createServerClient()
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
    })
    .select('id')
    .single()

  if (error) return { error: error.message }
  return { id: data?.id }
}

export async function getCallHistory(agentId: string): Promise<CallLog[]> {
  const supabase = createServerClient()
  const { data } = await supabase
    .from('call_logs')
    .select('*')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(20)

  return (data ?? []) as CallLog[]
}
