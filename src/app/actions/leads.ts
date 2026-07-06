'use server'

import { createServerClient } from '@/lib/supabase/server'
import { PRODUCTIVE_PHASES } from '@/features/leads/content/phases'
import type { LeadPeriod } from '@/lib/leads/period'
import type { LeadProgressRow, DuplicateResponsibilityRow } from '@/lib/types/database'

// Dashboard de Leads (Pipefy) — domínio SEPARADO do discador. Estas actions leem as
// views de S0 via createServerClient() (que propaga auth.uid() → RLS). As views são
// security_invoker, então o escopo por papel é do banco: o AGENTE só enxerga o próprio
// dado, o SUPERVISOR+ enxerga tudo. NÃO duplicamos lógica de permissão aqui — a mesma
// action serve às duas visões; o front decide só quais painéis extras (ranking, alertas)
// exibir por papel.
//
// Recorte por período: em vez de ler as views agregadas all-time, lemos v_lead_progress
// (1 linha por lead) filtrando created_at pelo ciclo escolhido — puxa só os leads do
// período (barato) e agregamos em memória. Se o volume por ciclo crescer muito, isto vira
// um RPC parametrizado (migration à parte).

export interface LeadKpis {
  totalLeads: number // recebidos no período
  openLeads: number
  wonLeads: number
  deadLeads: number
  conversionRate: number // 0..1 (ganhos / recebidos)
  deadRate: number // 0..1 (mortos / recebidos)
  avgHoursToFirstContact: number | null
}

export interface FunnelStage {
  order: number
  phase: string
  leadsReached: number
}

export interface DeadReason {
  reason: string
  leads: number
}

// "Em qual tentativa o lead mais morre" (S3): entre os leads mortos, a última etapa
// produtiva que alcançaram (max_funnel_order → nome da etapa). Distribuição da mortalidade
// pelo funil de acionamento.
export interface DeathByAttempt {
  order: number
  phase: string
  deaths: number
}

export interface AgentRankRow {
  agentId: string
  name: string
  totalLeads: number
  wonLeads: number
  deadLeads: number
  conversionRate: number
  deadRate: number
  avgHoursToFirstContact: number | null
}

export interface DuplicateAlert {
  leadId: string
  title: string | null
  currentPhase: string | null
  responsible: string | null
  updatedAt: string | null
}

export interface LeadsData {
  kpis: LeadKpis
  funnel: FunnelStage[]
  deadReasons: DeadReason[]
  deathByAttempt: DeathByAttempt[]
  ranking: AgentRankRow[]
}

// Só as colunas de v_lead_progress que a agregação consome (o filtro por created_at é
// server-side, então created_at nem precisa vir no payload). Mantém o egress enxuto.
const PROGRESS_COLS =
  'responsible_agent_id, discard_reason, duplicate_responsible, ' +
  'is_dead, is_open, is_won, max_funnel_order, hours_to_first_contact'

function kpisFromRows(rows: LeadProgressRow[]): LeadKpis {
  const total = rows.length
  const won = rows.filter((r) => r.is_won).length
  const dead = rows.filter((r) => r.is_dead).length
  const open = rows.filter((r) => r.is_open).length
  const ftc = rows
    .map((r) => r.hours_to_first_contact)
    .filter((h): h is number => h != null)
  const avg = ftc.length ? ftc.reduce((a, b) => a + b, 0) / ftc.length : null
  return {
    totalLeads: total,
    openLeads: open,
    wonLeads: won,
    deadLeads: dead,
    conversionRate: total > 0 ? won / total : 0,
    deadRate: total > 0 ? dead / total : 0,
    avgHoursToFirstContact: avg == null ? null : Math.round(avg * 10) / 10,
  }
}

// Tudo que deriva dos leads do período, numa leitura só de v_lead_progress + os nomes
// dos agentes (para o ranking do supervisor).
export async function getLeadsData(period: LeadPeriod): Promise<LeadsData> {
  const supabase = await createServerClient()

  const [progressRes, agentsRes] = await Promise.all([
    supabase
      .from('v_lead_progress')
      .select(PROGRESS_COLS)
      .gte('created_at', period.start)
      .lt('created_at', period.end),
    supabase.from('lead_agents').select('id, pipefy_name'),
  ])

  // Cast via unknown: o select é uma string montada (não literal), então o supabase-js
  // não consegue inferir o shape e cai em GenericStringError[].
  const rows = (progressRes.data ?? []) as unknown as LeadProgressRow[]
  const nameById = new Map(
    ((agentsRes.data ?? []) as { id: string; pipefy_name: string | null }[]).map((a) => [
      a.id,
      a.pipefy_name ?? 'Sem nome',
    ])
  )

  // Funil: em cada etapa produtiva, quantos leads alcançaram aquela ordem ou além.
  const funnel: FunnelStage[] = PRODUCTIVE_PHASES.map((p) => ({
    order: p.order,
    phase: p.name,
    leadsReached: rows.filter((r) => (r.max_funnel_order ?? -1) >= p.order).length,
  }))

  // Motivos de descarte (só leads mortos).
  const reasonCount = new Map<string, number>()
  for (const r of rows) {
    if (!r.is_dead) continue
    const reason = r.discard_reason?.trim() || 'Não informado'
    reasonCount.set(reason, (reasonCount.get(reason) ?? 0) + 1)
  }
  const deadReasons: DeadReason[] = [...reasonCount]
    .map(([reason, leads]) => ({ reason, leads }))
    .sort((a, b) => b.leads - a.leads)

  // "Em qual tentativa o lead mais morre": entre os mortos, a última etapa produtiva
  // alcançada (max_funnel_order). Monta a escada 0…maior-ordem-com-morte, preenchendo os
  // vãos com zero (a forma da queda importa); ordens sem nenhuma morte no topo são cortadas.
  const deathByOrder = new Map<number, number>()
  for (const r of rows) {
    if (!r.is_dead) continue
    const ord = r.max_funnel_order ?? -1
    if (ord < 0) continue // morreu sem nenhuma etapa produtiva registrada
    deathByOrder.set(ord, (deathByOrder.get(ord) ?? 0) + 1)
  }
  const maxDeathOrder = deathByOrder.size ? Math.max(...deathByOrder.keys()) : -1
  const deathByAttempt: DeathByAttempt[] = PRODUCTIVE_PHASES.filter(
    (p) => p.order <= maxDeathOrder
  ).map((p) => ({ order: p.order, phase: p.name, deaths: deathByOrder.get(p.order) ?? 0 }))

  // Ranking por agente. Exclui leads sem responsável e os de responsabilidade duplicada
  // (esses vão só para a lista de alerta, para não distorcer a comparação — regra do S0).
  const byAgent = new Map<string, LeadProgressRow[]>()
  for (const r of rows) {
    if (!r.responsible_agent_id || r.duplicate_responsible) continue
    const arr = byAgent.get(r.responsible_agent_id) ?? []
    arr.push(r)
    byAgent.set(r.responsible_agent_id, arr)
  }
  const ranking: AgentRankRow[] = [...byAgent]
    .map(([agentId, agentRows]) => {
      const k = kpisFromRows(agentRows)
      return {
        agentId,
        name: nameById.get(agentId) ?? 'Sem nome',
        totalLeads: k.totalLeads,
        wonLeads: k.wonLeads,
        deadLeads: k.deadLeads,
        conversionRate: k.conversionRate,
        deadRate: k.deadRate,
        avgHoursToFirstContact: k.avgHoursToFirstContact,
      }
    })
    .sort((a, b) => b.wonLeads - a.wonLeads || b.totalLeads - a.totalLeads)

  return { kpis: kpisFromRows(rows), funnel, deadReasons, deathByAttempt, ranking }
}

// ── Visão do agente (S2): fila de trabalho + desfechos do período ────────────

export type AgentLeadStatus = 'won' | 'dead' | 'stuck' | 'open'
export type LeadOrigin = 'ciclo' | 'retroativo'

export interface AgentLeadRow {
  leadId: string
  title: string | null
  currentPhase: string | null
  funnelOrder: number | null
  status: AgentLeadStatus
  isStuck: boolean
  origin: LeadOrigin // 'ciclo' = criado no período selecionado; 'retroativo' = arrastado de antes
  createdAt: string | null
  finalizedAt: string | null
  slaHours: number | null
  discardReason: string | null
}

// Só as colunas de v_lead_progress que a tabela do agente consome (egress enxuto).
const AGENT_LEAD_COLS =
  'lead_id, title, current_phase, current_funnel_order, created_at, finalized_at, ' +
  'discard_reason, is_dead, is_won, is_stuck, sla_hours'

// Leads do agente para a tabela de autoavaliação. Combina DUAS análises (decisão do dono):
//   • Fila de trabalho ("agora"): TODOS os abertos, independente do período — é onde o SLA
//     por fase destaca os parados, inclusive o backlog antigo.
//   • Desfechos do período: os finalizados (ganho/morto) cujo finalized_at cai no ciclo
//     selecionado — para o agente ver o que fechou naquele período.
// Como is_open ⟺ finalized_at IS NULL, o filtro é: aberto OU finalizado-no-período.
// O RLS escopa ao próprio agente (a mesma view serve ao supervisor em S3, sem filtro extra).
export async function getAgentLeads(period: LeadPeriod): Promise<AgentLeadRow[]> {
  const supabase = await createServerClient()
  const { data } = await supabase
    .from('v_lead_progress')
    .select(AGENT_LEAD_COLS)
    .or(`finalized_at.is.null,and(finalized_at.gte.${period.start},finalized_at.lt.${period.end})`)
    .order('is_stuck', { ascending: false })
    .order('created_at', { ascending: true })

  // Cast via unknown: o select é string montada, o supabase-js cai em GenericStringError[].
  const rows = (data ?? []) as unknown as LeadProgressRow[]
  return rows.map((r) => {
    const inCycle =
      r.created_at != null && r.created_at >= period.start && r.created_at < period.end
    const status: AgentLeadStatus = r.is_won
      ? 'won'
      : r.is_dead
        ? 'dead'
        : r.is_stuck
          ? 'stuck'
          : 'open'
    return {
      leadId: r.lead_id,
      title: r.title,
      currentPhase: r.current_phase,
      funnelOrder: r.current_funnel_order,
      status,
      isStuck: r.is_stuck,
      origin: inCycle ? 'ciclo' : 'retroativo',
      createdAt: r.created_at,
      finalizedAt: r.finalized_at,
      slaHours: r.sla_hours,
      discardReason: r.discard_reason,
    }
  })
}

// Alerta de responsabilidade duplicada — estado ATUAL (not por período). Supervisor+ usa
// para corrigir a atribuição no Pipefy. Para o agente, o RLS reduz à sua própria carga.
export async function getDuplicateAlerts(): Promise<DuplicateAlert[]> {
  const supabase = await createServerClient()
  const { data } = await supabase
    .from('v_duplicate_responsibility')
    .select('lead_id, title, current_phase, responsible, updated_at')
    .order('updated_at', { ascending: false })

  return ((data ?? []) as DuplicateResponsibilityRow[]).map((r) => ({
    leadId: r.lead_id,
    title: r.title,
    currentPhase: r.current_phase,
    responsible: r.responsible,
    updatedAt: r.updated_at,
  }))
}

// ── Visão do supervisor (S3): métricas de ESTADO ATUAL (não por período) ─────
// "Parados agora" e "sem acionamento" são NOW-scoped: leem a base aberta inteira via a
// MESMA v_lead_progress (o RLS deixa o supervisor ver tudo; a página nem chama isto para o
// papel agent). Agregamos em memória com colunas enxutas — se o egress pesar, vira uma view
// v_agent_stuck / RPC parametrizado (sem tocar no banco por ora).

// Limite (horas desde created_at) para um lead aberto e sem 1º contato virar "esquecido".
// Ajustável; efeito imediato (calculado na leitura, sem tocar no banco). NÃO exportado como
// const: este é um módulo 'use server' (só pode exportar funções async) — o valor viaja para
// o client dentro de SupervisorMetrics.forgottenThresholdHours.
const FORGOTTEN_THRESHOLD_HOURS = 24
// Teto de itens listados no alerta de esquecidos (os mais antigos primeiro). O total real
// vem separado em forgottenTotal.
const FORGOTTEN_LIMIT = 100

export interface StuckSplit {
  now: number // leads parados agora (estado atual)
  cycle: number // dos quais, criados no período selecionado
}

export interface ForgottenLead {
  leadId: string
  title: string | null
  currentPhase: string | null
  responsible: string | null
  createdAt: string | null
}

export interface SupervisorMetrics {
  // Parados agora por agente (keyed by agentId) — exclui responsabilidade duplicada, para
  // casar com o ranking (que já os exclui). Estado atual; `cycle` reancorado ao período.
  stuckByAgent: Record<string, StuckSplit>
  // Total da equipe (inclui duplicados) com split ciclo × retroativo.
  teamStuck: { total: number; cycle: number; retro: number }
  // Leads abertos em Recebidos/1° Acionamento, sem 1º contato, há mais de X horas (os
  // FORGOTTEN_LIMIT mais antigos); forgottenTotal = quantos existem ao todo.
  forgotten: ForgottenLead[]
  forgottenTotal: number
  forgottenThresholdHours: number
}

// Só as colunas de v_lead_progress que cada agregação consome (egress enxuto).
const STUCK_COLS = 'responsible_agent_id, created_at, duplicate_responsible'
const FORGOTTEN_COLS = 'lead_id, title, current_phase, responsible_agent_id, created_at'

export async function getSupervisorMetrics(period: LeadPeriod): Promise<SupervisorMetrics> {
  const supabase = await createServerClient()
  const cutoff = new Date(Date.now() - FORGOTTEN_THRESHOLD_HOURS * 3_600_000).toISOString()

  const [stuckRes, forgottenRes, agentsRes] = await Promise.all([
    // (1) parados agora — toda a base aberta que estourou o SLA de fase.
    supabase.from('v_lead_progress').select(STUCK_COLS).eq('is_stuck', true),
    // (2) esquecidos — abertos em Recebidos/1° Acionamento, sem 1º contato, mais velhos que
    // o limite. count exact traz o total mesmo com o teto de linhas.
    supabase
      .from('v_lead_progress')
      .select(FORGOTTEN_COLS, { count: 'exact' })
      .eq('is_open', true)
      .is('first_contact_at', null)
      .in('current_funnel_order', [0, 1])
      .lt('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(FORGOTTEN_LIMIT),
    supabase.from('lead_agents').select('id, pipefy_name'),
  ])

  const inPeriod = (createdAt: string | null) =>
    createdAt != null && createdAt >= period.start && createdAt < period.end

  // (1) parados agora → por agente (sem duplicados) + total da equipe.
  const stuckRows = (stuckRes.data ?? []) as unknown as LeadProgressRow[]
  const stuckByAgent: Record<string, StuckSplit> = {}
  let teamTotal = 0
  let teamCycle = 0
  for (const r of stuckRows) {
    teamTotal++
    const cyc = inPeriod(r.created_at)
    if (cyc) teamCycle++
    if (!r.responsible_agent_id || r.duplicate_responsible) continue
    const s = (stuckByAgent[r.responsible_agent_id] ??= { now: 0, cycle: 0 })
    s.now++
    if (cyc) s.cycle++
  }

  // (2) esquecidos → resolve o nome do responsável para o alerta.
  const nameById = new Map(
    ((agentsRes.data ?? []) as { id: string; pipefy_name: string | null }[]).map((a) => [
      a.id,
      a.pipefy_name ?? 'Sem nome',
    ])
  )
  const forgottenRows = (forgottenRes.data ?? []) as unknown as LeadProgressRow[]
  const forgotten: ForgottenLead[] = forgottenRows.map((r) => ({
    leadId: r.lead_id,
    title: r.title,
    currentPhase: r.current_phase,
    responsible: r.responsible_agent_id
      ? nameById.get(r.responsible_agent_id) ?? 'Sem nome'
      : null,
    createdAt: r.created_at,
  }))

  return {
    stuckByAgent,
    teamStuck: { total: teamTotal, cycle: teamCycle, retro: teamTotal - teamCycle },
    forgotten,
    forgottenTotal: forgottenRes.count ?? forgotten.length,
    forgottenThresholdHours: FORGOTTEN_THRESHOLD_HOURS,
  }
}
