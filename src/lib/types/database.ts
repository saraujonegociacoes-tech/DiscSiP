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
  | 'exhausted'

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
  // Horário de funcionamento ('HH:MM:SS'); null = sem restrição de horário
  schedule_start: string | null
  schedule_end: string | null
  // Chaves de campos que o agente vê na discagem (ex: 'name', 'phone_number', ou keys de extra_data)
  visible_fields: string[]
  // Valores de disposição que disparam notificação ao Make (ex: 'interested', 'callback')
  notify_dispositions: string[]
  created_at: string
  updated_at: string
}

// Agente participante de uma campanha (N:N)
export interface CampaignAgent {
  id: string
  campaign_id: string
  agent_id: string
  created_at: string
}

// Coluna extra do arquivo importado, exibida ao agente como campo nomeado
export interface ColumnMappingExtra {
  key: string // chave usada em campaign_contacts.extra_data
  label: string // rótulo exibido ao agente
  column: string // cabeçalho/identificador da coluna no arquivo
}

// Mapeamento das colunas do arquivo (.csv/.xlsx) para os campos do contato
export interface ColumnMapping {
  name: string | null // coluna usada como nome
  phone: string | null // coluna usada como telefone
  extras: ColumnMappingExtra[]
}

// Mailing carregado dentro de uma campanha, com regras de reciclagem
export interface List {
  id: string
  campaign_id: string
  name: string
  column_mapping: ColumnMapping
  recycle_enabled: boolean
  recycle_statuses: ContactStatus[] // status que voltam à fila
  recycle_after_hours: number
  recycle_max_attempts: number
  created_at: string
}

export interface CampaignContact {
  id: string
  campaign_id: string
  list_id: string | null
  phone_number: string
  name: string | null
  extra_data: Record<string, string> // campos extras vindos da lista
  status: ContactStatus
  disposition: string | null
  notes: string | null
  assigned_agent_id: string | null
  call_log_id: string | null
  dialed_at: string | null
  attempts: number
  created_at: string
}
