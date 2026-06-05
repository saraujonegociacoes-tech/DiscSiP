export type AgentRole = 'agent' | 'supervisor'
export type CallDirection = 'inbound' | 'outbound'
export type CallStatus = 'answered' | 'no_answer' | 'busy' | 'failed'

export interface Agent {
  id: string
  name: string
  extension: number
  role: AgentRole
  created_at: string
}

export interface CallLog {
  id: string
  agent_id: string
  extension: number
  phone_number: string
  direction: CallDirection
  status: CallStatus
  duration_seconds: number
  started_at: string | null
  ended_at: string | null
  campaign_id: string | null
  disposition: string | null
  notes: string | null
  created_at: string
}
