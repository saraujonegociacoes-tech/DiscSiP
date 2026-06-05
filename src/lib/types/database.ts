export type AgentRole = 'agent' | 'supervisor'
export type CallDirection = 'inbound' | 'outbound'
export type CallStatus = 'answered' | 'no_answer' | 'busy' | 'failed'
export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed'
export type ContactStatus =
  | 'pending'
  | 'dialing'
  | 'answered'
  | 'no_answer'
  | 'busy'
  | 'failed'
  | 'do_not_call'

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

export interface Campaign {
  id: string
  name: string
  status: CampaignStatus
  created_at: string
  updated_at: string
}

export interface CampaignContact {
  id: string
  campaign_id: string
  phone_number: string
  name: string | null
  status: ContactStatus
  disposition: string | null
  notes: string | null
  assigned_agent_id: string | null
  call_log_id: string | null
  dialed_at: string | null
  created_at: string
}
