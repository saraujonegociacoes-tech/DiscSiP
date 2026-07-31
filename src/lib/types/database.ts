// Papéis do RBAC (Sprint 7). 'pending' = cadastrado, aguardando aprovação do admin.
// 'ceo' NÃO é hierárquico — não é "acima de admin". É uma trava LATERAL: dá acesso só
// ao painel executivo /ceo e a nada mais (não opera discador, não gere usuários), e
// nenhum outro papel herda dele. Ver docs/projetopainelceo-docs/updates/painel-ceo-sprints.md.
export type Role = 'pending' | 'agent' | 'supervisor' | 'manager' | 'admin' | 'ceo'
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
  // Identificador estável de área de negócio ('comercial' | 'cs' | 'negociacao' | null).
  // Usado pro gating do menu lateral e do RLS dos painéis por vertical — não depende
  // do texto de `name`, que é editável.
  slug: string | null
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
  // Não é coluna de `profiles` — resolvido à parte por getCurrentProfile() a partir de
  // department_id, pra escopar o menu lateral por vertical (Comercial/CS/Negociação).
  department_slug?: string | null
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
  // Arquivamento reversível (distinto da exclusão definitiva). null = ativa.
  archived_at: string | null
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
  pipefy_card_id: string | null
  title: string | null
  current_phase: string | null
  responsible: string | null
  updated_at: string | null
}

// ── Painel de Sucesso do Cliente (CS, Pipefy) — domínio SEPARADO do leads/comercial ──
// Painel de CS reformulado (2026-07-21) — painel de 4 abas, ver docs/updates/
// painel-sucesso-cliente-cs.md. Domínio SEPARADO do leads: RLS mais estrito (só quem é
// do departamento de CS, ou manager/admin, enxerga qualquer linha).
//
// PÁGINA 1 (Matriz Fase × Idade): a RPC get_cs_matrix (migration
// 20260721_cs_age_windows.sql) devolve os cards escopados pelo RLS com a idade calculada
// AS-OF o fim do período, mais fase/ordem do funil/tempo na fase. A matriz (fase × janela
// 1-30/31-90/91-180/181+), o total e o tempo médio por fase, o filtro ativo/inativo e o
// drill-down por célula acontecem no cliente sobre `cards`.
export interface CsMatrixCard {
  pipefyCardId: string
  title: string | null // nome do cliente (dado sensível — só chega a quem o RLS libera)
  ageDays: number // referenceAt - pipefy_created_at, em dias (>= 0)
  dwellDays: number // tempo na fase atual, em dias (>= 0); ~idade enquanto faltar evento
  agentId: string | null
  agentName: string // "Sem responsável" quando agentId é null
  active: boolean // false = card em fase terminal (inativo)
  phaseId: string | null
  phase: string // nome da fase (denormalizado); "Sem fase" se não casar
  funnelOrder: number | null // ordem no funil (null se a fase não estiver seedada)
}

export interface CsMatrixData {
  referenceAt: string // LEAST(fim do período, now()) — a "data da foto" (ISO)
  cards: CsMatrixCard[]
}

// PÁGINA 2 (Equipe): a RPC get_cs_team(p_start, p_end) (migrations 20260722 + 20260723_v2)
// devolve, numa chamada só, o resumo por responsável no PERÍODO. Duas seções independentes:
//
// 1) MOVIMENTO (coorte = cards ATIVOS): moveu de fase no período × comentou no período,
//    ignorando entrada/saída de fases is_negotiation/exclude_from_movement. "Atualizou" =
//    qualquer comentário. + cards recebidos (troca de responsável).
export interface CsTeamMovementAgent {
  agentId: string | null
  agentName: string // "Sem responsável" quando agentId é null
  received: number // cards recebidos no período (troca de responsável)
  movedWithUpdate: number // moveu de fase E comentou
  movedNoUpdate: number // moveu de fase E não comentou
  onlyUpdate: number // não moveu E comentou
  idle: number // não moveu E não comentou (sem mover/atualizar)
}
export type CsTeamMovementTotals = Omit<CsTeamMovementAgent, 'agentId' | 'agentName'>

// 2) NEGOCIAÇÕES FEITAS NO PERÍODO (card com mudança real nos 5 campos no período),
//    classificadas pela completude ATUAL. Completa=5 · Parcial=3–4 com Q.D · Incompleta=resto.
//    `cards` alimenta o drill-down (campos faltando + link do Pipefy).
export type CsNegotiationClass = 'completa' | 'parcial' | 'incompleta'

export interface CsNegotiationCard {
  pipefyCardId: string
  title: string | null
  cls: CsNegotiationClass
  missing: string[] // rótulos dos 5 campos vazios agora (ex.: ['Q.A','P.V']); [] se completa
}

export interface CsTeamNegotiationAgent {
  agentId: string | null
  agentName: string
  total: number
  completa: number
  parcial: number
  incompleta: number
  cards: CsNegotiationCard[]
}
export type CsTeamNegotiationTotals = Pick<
  CsTeamNegotiationAgent,
  'total' | 'completa' | 'parcial' | 'incompleta'
>

export interface CsTeamData {
  periodStart: string // ISO (início do período, inclusivo)
  periodEnd: string // ISO (fim do período, exclusivo)
  movement: CsTeamMovementAgent[]
  movementTotals: CsTeamMovementTotals
  negotiations: CsTeamNegotiationAgent[]
  negotiationTotals: CsTeamNegotiationTotals
}

// PÁGINA 3 (Minutas): a RPC get_cs_minutas() (migration 20260727_cs_minutas.sql) devolve os
// cards escopados pelo RLS que TÊM minuta (data de quitação preenchida = vencimento), lidos do
// snapshot atual (metadata do Pipefy). SNAPSHOT de estado ATUAL — sem filtro de período (como a
// P1). Os buckets por vencimento (Vencidas/Mensal/Trimestral/Semestral/180+), as somas de valor
// e o drill/CSV acontecem no cliente (src/features/cs/components/CsMinutas.tsx). Mapeamento (dono
// 2026-07-27): valor da minuta = valor_resguardados_dos_clientes (Q.D); dívida original fixa =
// d_vida_atual_do_cliente; vencimento = data_da_quita_o; etiqueta = sele_o_de_etiqueta. Sem URL
// própria: a UI aponta pra URL do card (a minuta fica anexada nele).
export interface CsMinutaCard {
  pipefyCardId: string
  title: string | null // nome do cliente (dado sensível — só chega a quem o RLS libera)
  agentId: string | null
  agentName: string // "Sem responsável" quando agentId é null
  active: boolean // false = card em fase terminal (inativo)
  phaseId: string | null
  phase: string // nome da fase (denormalizado)
  valor: number | null // "Valor da Minuta Final" (valor_resguardados_dos_clientes) — null se vazio
  divida: number | null // "Dívida do Cliente" (d_vida_atual_do_cliente, fixa) — base do % de desconto
  ultimaNegociacao: number | null // "Última Negociação" = Q.D real da fase de negociação (q_d_valor_da_quita_o_com_desconto)
  descontoPct: number | null // (1 − Minuta Final/Dívida)·100, derivado; null se não dá pra calcular
  etiqueta: string | null // rótulo de desconto marcado (sele_o_de_etiqueta), se houver
  resguardo: number | null // valor de resguardo do mês mais avançado preenchido (>0); null se nenhum
  resguardoMonth: number | null // qual mês (N) da série valor_de_resguardo_N alimentou o resguardo
  dueDate: string // data de quitação = vencimento da minuta (ISO date; sempre presente aqui)
  daysToDue: number // vencimento − hoje, em dias (negativo = vencida)
}

// Resguardo da carteira quebrado por situação, pra o KPI acompanhar o filtro Ativos/Inativos/
// Todos (o cliente soma active+inactive pra "Todos"). Cada card entra com UM valor (o maior mês).
export interface CsResguardoBucket {
  total: number // Σ do resguardo dos cards dessa situação
  count: number // quantos cards (dessa situação) têm resguardo > 0
}

export interface CsMinutasData {
  referenceAt: string // "agora" (ISO) — a data da foto
  withoutMinuta: number // nº de cards escopados SEM data de quitação (negociações sem minuta ainda)
  resguardo: {
    active: CsResguardoBucket // cards não-terminais
    inactive: CsResguardoBucket // cards em fase terminal
  }
  cards: CsMinutaCard[]
}

// PÁGINA 4 (Pagamento) — design HÍBRIDO (migration 20260730b_cs_pagamento.sql):
//   · PROJEÇÃO (o que vão pagar) = plano por parcela criado na fase "Aguardando Pagamento" do SC,
//     lido do cs_cards.metadata (slugs irregulares, ver a migration). RPC get_cs_pagamento_projecao()
//     (snapshot, sem período — como a P1/P3).
//   · REALIZADO/HISTÓRICO (o que já pagaram) = conexão do card do SC com o pipe do FINANCEIRO
//     (child_relations → tabela cs_card_payments); 1 card do Financeiro = 1 pagamento de 1 parcela.
//     RPC get_cs_pagamento_historico(p_start,p_end) (série, filtrável por período).
// A reconciliação prevista×paga (por número de parcela), os KPIs de carteira, o calendário e o
// status moram no cliente (src/features/cs/components/CsPagamento.tsx). RLS escopa igual às outras.

export interface CsPagamentoPlanoParcela {
  num: number // 1..3
  valorPrevisto: number | null // valor planejado da parcela (metadata do card do SC)
  dataPrevista: string | null // vencimento planejado (ISO date); null se não informado
}

export interface CsPagamentoRealizado {
  parcelaNum: number | null // esse_pagamento_referente_a_qual_parcela (a que parcela o pagamento se refere)
  valorPago: number | null // valor_de_contrata_o ("Valor que o Cliente Pagou?")
  dataPagamento: string | null // data_do_pagamento (ISO date)
  comprovanteUrl: string | null // 1º anexo de comprovante_de_pagamento
  pagamentoId: string | null // n_mera_o_do_pagamento_id
}

export interface CsPagamentoCard {
  pipefyCardId: string
  title: string | null // nome do cliente (dado sensível — só chega a quem o RLS libera)
  agentId: string | null
  agentName: string // "Sem responsável" quando agentId é null
  active: boolean // false = card em fase terminal (inativo)
  phaseId: string | null
  phase: string
  forma: string | null // forma_de_pagamento do card do SC (ex.: "Parcelado 3x")
  plano: CsPagamentoPlanoParcela[] // parcelas previstas (só as com valor/data preenchidos)
  pagamentos: CsPagamentoRealizado[] // parcelas efetivamente pagas (da conexão com o Financeiro)
}

export interface CsPagamentoProjecaoData {
  referenceAt: string // "agora" (ISO) — a data da foto
  cards: CsPagamentoCard[]
}

export interface CsPagamentoRecebido {
  pipefyCardId: string // card do SC (link do card)
  paymentCardId: string // card do Financeiro
  title: string | null // nome do cliente
  agentId: string | null
  agentName: string
  parcelaNum: number | null
  valorPago: number | null
  dataPagamento: string | null // ISO date
  comprovanteUrl: string | null
}

export interface CsPagamentoHistoricoData {
  periodStart: string // ISO (início do período, inclusivo)
  periodEnd: string // ISO (fim do período, exclusivo)
  totalRecebido: number // Σ valor_pago no período
  count: number // nº de pagamentos no período
  payments: CsPagamentoRecebido[]
}

// ── Painel do CEO — camada de leitura/agregação (não tem schema próprio) ────
// Ver docs/projetopainelceo-docs/updates/painel-ceo-sprints.md. Cada aba tem uma RPC
// SECURITY DEFINER com guarda ceo_current_role() que já devolve o painel pronto em 1
// linha jsonb — nada é agregado no Worker.
//
// ABA 1 (Financeiro): get_ceo_financeiro(p_start, p_end), migration
// 20260731_financeiro_schema.sql. Os valores JÁ vêm com sinal aplicado (desconto e
// devolução entram negativos; distrato e reversão, positivos — decisão do dono).

/** Uma fatia de um breakdown (categoria, departamento ou forma de pagamento). */
export interface CeoFinanceiroBucket {
  key: string
  total: number
  count: number
}

/** Um mês civil da série. `month` é 'YYYY-MM'. */
export interface CeoFinanceiroMonth {
  month: string
  total: number
  count: number
}

/**
 * Suspeita de lançamento em duplicata: mesmo contrato + mesmo valor + mesma categoria
 * + mesmo dia. É AVISO, não dedupe — o mesmo contrato com categorias diferentes (um
 * pagamento e um desconto, p.ex.) é dado legítimo e nem aparece aqui.
 */
export interface CeoFinanceiroDuplicate {
  contractRef: string
  category: string | null
  paidDate: string // ISO date
  value: number
  cards: number // quantos cards no grupo
  cardIds: string[] // pipefy_card_id de cada um (link do card)
  departments: string[]
}

export interface CeoFinanceiroData {
  periodStart: string // ISO date (inclusivo)
  periodEnd: string // ISO date (EXCLUSIVO)
  total: number // Σ das entradas da janela, com sinal
  count: number // nº de pagamentos na janela
  previousTotal: number // mesma coisa na janela anterior de igual tamanho (delta do KPI)
  previousCount: number
  monthly: CeoFinanceiroMonth[] // 12 meses civis terminando no mês de periodEnd
  byCategory: CeoFinanceiroBucket[]
  byDepartment: CeoFinanceiroBucket[]
  byPaymentMethod: CeoFinanceiroBucket[]
  duplicates: CeoFinanceiroDuplicate[]
}

// ── Aquecimento de números WhatsApp — domínio SEPARADO ──────────────────────
// Espelham as tabelas de supabase/migrations/20260719_warmup_schema.sql. Módulo
// sensível: só manager/admin leem/configuram (RLS). As tabelas de execução
// (conversations/messages) só são escritas pelo tick/callback via service_role.

export type WarmupNumberStatus = 'active' | 'paused' | 'blocked' | 'cooling'
export type WarmupQualityRating = 'GREEN' | 'YELLOW' | 'RED'
export type WarmupTemplateKind = 'template' | 'session_snippet'
export type WarmupMessageType = 'template' | 'session'
export type WarmupDispatchMode = 'live' | 'dry_run'
export type WarmupConversationStatus = 'active' | 'idle' | 'closed'

// Número do pool. `sender_id` = phone_number_id da Meta; `phone_number` = E.164.
export interface WarmupNumber {
  id: string
  sender_id: string
  phone_number: string
  display_name: string | null
  waba_id: string | null
  status: WarmupNumberStatus
  participating: boolean
  added_at: string
  quality_rating: WarmupQualityRating | null
  notes: string | null
  created_at: string
  updated_at: string
}

// Modo de aquecimento: 'sessao' = intensivo num período fixo (ex.: 24h);
// 'gradual' = rampa multi-dia (warmup_ramp_stages).
export type WarmupMode = 'sessao' | 'gradual'

// Configuração em key/value. Chaves com valor padrão no código (getWarmupSettings/
// readSettings), então funcionam mesmo sem seed — a primeira gravação as cria.
export interface WarmupSettings {
  qntd_numbers: number
  max_numbers_cap: number
  dry_run: boolean
  tick_max_sends: number
  min_gap_minutes: number
  max_gap_minutes: number
  // ── Modo e parâmetros do modo Sessão ──
  warmup_mode: WarmupMode
  sessao_duracao_horas: number
  sessao_msgs_por_numero: number
  sessao_conversas_por_numero: number
  sessao_iniciada_em: string | null // ISO; null = sessão não iniciada
}

export interface WarmupRampStage {
  id: number
  day_from: number
  day_to: number | null
  daily_message_cap: number
  new_conversations_per_day_cap: number
}

// Catálogo único: template aprovado (abre conversa) ou frase livre de sessão.
export interface WarmupTemplate {
  id: string
  kind: WarmupTemplateKind
  meta_template_name: string | null
  meta_template_language: string | null
  body: string
  active: boolean
  created_at: string
}

export interface WarmupConversation {
  id: string
  number_a_id: string
  number_b_id: string
  opener_number_id: string
  opened_at: string
  last_message_at: string
  last_sender_id: string | null
  message_count: number
  status: WarmupConversationStatus
}

export interface WarmupMessage {
  id: string
  conversation_id: string | null
  from_number_id: string
  to_number_id: string
  message_type: WarmupMessageType
  template_id: string | null
  content: string | null
  dispatch_mode: WarmupDispatchMode
  make_dispatch_ok: boolean | null
  graph_message_id: string | null
  error_detail: string | null
  sent_at: string
}

// Estatística por número exibida no painel (dias aquecendo, volume, etc.).
export interface WarmupNumberStats {
  numberId: string
  daysWarming: number
  sentTotal: number
  sentLive: number
  sentDryRun: number
  sentToday: number
  dailyCap: number
}
