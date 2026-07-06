// Papéis do RBAC (Sprint 7). 'pending' = cadastrado, aguardando aprovação do admin.
export type Role = 'pending' | 'agent' | 'supervisor' | 'manager' | 'admin'
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
  // Discagem paralela: tocou mas foi derrubado (/hangupcalling) antes de atender.
  // Reciclável — pode entrar em recycle_statuses da lista.
  | 'abandoned'

export interface Department {
  id: string
  name: string
  created_at: string
}

// Identidade do app (1:1 com auth.users). Substitui o papel da tabela `agents`.
export interface Profile {
  id: string
  name: string
  email: string | null
  role: Role
  department_id: string | null
  extension: number | null
  created_at: string
}

export interface CallLog {
  id: string
  agent_id: string | null
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
  department_id: string | null
  // Horário de funcionamento ('HH:MM:SS'); null = sem restrição de horário
  schedule_start: string | null
  schedule_end: string | null
  // Chaves de campos que o agente vê na discagem (ex: 'name', 'phone_number', ou keys de extra_data)
  visible_fields: string[]
  // Valores de disposição que disparam notificação ao Make (ex: 'interested', 'callback')
  notify_dispositions: string[]
  // Linhas discadas em paralelo por agente. 1 = power dialer 1-a-1 (padrão); >=2 liga o
  // modo preditivo (disca N, conecta quem atende primeiro, derruba as outras).
  parallel_lines: number
  created_at: string
  updated_at: string
}

// Presença em tempo real do agente (heartbeat do softphone ~20s). online = última
// gravação < 60s; dialer_status espelha o DialerStatus do front.
export interface AgentPresence {
  agent_id: string
  dialer_status: 'idle' | 'running' | 'paused' | 'completed'
  campaign_id: string | null
  last_seen_at: string
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

// ── Dashboard de Leads (Pipefy) — domínio SEPARADO do discador ──────────────
// Espelham as tabelas/views de supabase/manual/leads_dashboard_setup.sql. As views
// são security_invoker: o RLS do usuário logado já filtra (agente vê o próprio dado,
// supervisor+ vê tudo). O front só lê — a escrita é do service_role (Make/import).

// Classificação da fase no funil: caminho de conversão vs lead descartado.
export type LeadPhaseKind = 'produtiva' | 'morta'

// Dimensão de fase (lookup lead_phases, chave = id da fase no Pipefy)
export interface LeadPhase {
  pipefy_phase_id: string
  name: string
  kind: LeadPhaseKind
  funnel_order: number | null
  is_won: boolean
  // Prazo (horas desde created_at) para o lead sair desta fase. NULL = sem SLA. (S2)
  sla_hours: number | null
}

// Dimensão de agente do Pipefy (lead_agents). profile_id é a ponte (vazia por ora)
// com o discador; não cruzar métricas agora.
export interface LeadAgent {
  id: string
  pipefy_user_id: string
  pipefy_name: string | null
  email: string | null
  profile_id: string | null
  active: boolean
  created_at: string
}

// Uma linha por lead (view v_lead_progress) — base de todas as métricas por período.
export interface LeadProgressRow {
  lead_id: string
  responsible_agent_id: string | null
  current_phase: string | null
  phase_kind: LeadPhaseKind | null
  current_funnel_order: number | null
  created_at: string | null
  first_contact_at: string | null
  finalized_at: string | null
  updated_at: string | null
  discard_reason: string | null
  channel: string | null
  duplicate_responsible: boolean
  is_dead: boolean
  is_open: boolean
  is_won: boolean
  max_funnel_order: number
  hours_to_first_contact: number | null
  hours_since_update: number | null
  // S2 — título do lead (para a tabela do agente), SLA da fase atual e "lead parado"
  // (aberto, não morto, não ganho e now − created_at > sla_hours). Ver 20260706_leads_sla.sql.
  title: string | null
  sla_hours: number | null
  is_stuck: boolean
}

// KPIs por agente, all-time (view v_agent_kpis). Para recorte por período, agregamos
// v_lead_progress na action; esta view fica para o ranking all-time se preciso.
export interface AgentKpiRow {
  agent_id: string
  pipefy_name: string | null
  email: string | null
  total_leads: number
  open_leads: number
  won_leads: number
  dead_leads: number
  stuck_leads: number
  avg_hours_to_first_contact: number | null
  conversion_rate: number | null
  dead_rate: number | null
}

// Funil de acionamento (view v_funnel)
export interface FunnelRow {
  funnel_order: number | null
  phase_name: string
  leads_reached: number
}

// Motivos de descarte (view v_dead_reasons)
export interface DeadReasonRow {
  reason: string
  leads: number
}

// Alerta de responsabilidade duplicada (view v_duplicate_responsibility) — now-alert,
// não é por período. Supervisor corrige a atribuição no Pipefy.
export interface DuplicateResponsibilityRow {
  lead_id: string
  title: string | null
  current_phase: string | null
  responsible: string | null
  updated_at: string | null
}
