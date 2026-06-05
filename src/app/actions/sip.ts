'use server'

import { createServerClient } from '@/lib/supabase/server'
import type { Agent, CallLog } from '@/lib/types/database'

type CredentialsResult =
  | { agent: Agent; password: string; sipServer: string; sipDomain: string }
  | { error: string }

export async function getSipCredentials(
  extension: number
): Promise<CredentialsResult> {
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

  const password = process.env.ramalkey_5125_5150
  if (!password) {
    return { error: 'Credenciais SIP não configuradas no servidor.' }
  }

  return {
    agent: agent as Agent,
    password,
    sipServer: process.env.NEXT_PUBLIC_SIP_SERVER!,
    sipDomain: process.env.NEXT_PUBLIC_SIP_DOMAIN!,
  }
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
}

export async function saveCallLog(
  input: SaveCallLogInput
): Promise<{ error?: string }> {
  const supabase = createServerClient()
  const { error } = await supabase.from('call_logs').insert({
    agent_id: input.agentId,
    extension: input.extension,
    phone_number: input.phoneNumber,
    direction: input.direction,
    status: input.status,
    duration_seconds: input.durationSeconds,
    started_at: input.startedAt,
    ended_at: input.endedAt,
  })

  if (error) return { error: error.message }
  return {}
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
