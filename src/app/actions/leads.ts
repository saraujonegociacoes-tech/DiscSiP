'use server'

import { createServerClient } from '@/lib/supabase/server'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { PRODUCTIVE_PHASES, WON_ORDER } from '@/features/leads/content/phases'
import { sanitizePeriod, recentCycles, type LeadPeriod } from '@/lib/period'
import type { LeadPhaseKind, LeadProgressRow, DuplicateResponsibilityRow } from '@/lib/types/database'

// Dashboard de Leads (Pipefy) — domínio SEPARADO do discador. Estas actions leem as
// views de S0 via createServerClient() (que propaga auth.uid() → RLS). As views são
// security_invoker, então o escopo por papel é do banco: o AGENTE só enxerga o próprio
// dado, o SUPERVISOR+ enxerga tudo. NÃO duplicamos lógica de permissão aqui — a mesma
// action serve às duas visões; o front decide só quais painéis extras (ranking, alertas)
// exibir por papel.
//
// TRUNCAMENTO (fix): o PostgREST corta toda resposta no "Max Rows" do projeto (padrão
// 1000). Por isso NÃO agregamos linhas cruas no Worker: os KPIs/funil/ranking/canal do
// getLeadsData vêm de um RPC que conta no Postgres (get_leads_dashboard → 1 linha jsonb),
// e as poucas leituras que PRECISAM ser lista (fila do agente, órfãos, fallback de
// parados) são paginadas com fetchAllRows(). Assim nenhuma contagem trava em 1000.

export interface LeadKpis {
  totalLeads: number // recebidos no período
  openLeads: number
  wonLeads: number // por finalized_at (data da venda), não created_at — ver get_leads_won_by_sale_date
  deadLeads: number // idem, por finalized_at
  wonCycle: number // dos ganhos acima, quantos foram CRIADOS no próprio período
  wonRetro: number // dos ganhos acima, quantos foram criados ANTES do período (retroativo)
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

// Distribuição por fase ATUAL (volume): quantos leads do período estão agora em cada fase.
// kind marca produtiva × morta (a UI colore mortas de vermelho); order = ordem no funil
// (NULL nas mortas). A soma de `leads` == total recebido no período. Complementa o funil
// (que é fluxo cumulativo): aqui é o volume atual por fase.
export interface PhaseDistribution {
  phase: string
  kind: LeadPhaseKind | null
  order: number | null
  leads: number
}

// ── Funil "geral" (acionado no período, por ENTRADA de fase) ─────────────────
// Cohort "acionado" = leads que tiveram ao menos uma ENTRADA REAL de fase no período
// (não "qualquer updated_at"). funnel[N] = leads que ENTRARAM numa fase de ordem N
// dentro do período (não cumulativo `max >= N`, então pulos não preenchem etapas) —
// ver get_leads_activity (migration 20260731). phaseDistribution = onde esse cohort está
// agora. cycle/retro classificam cada linha pelo created_at do lead: dentro do período =
// cycle, antes = retro.
export interface StageActivity {
  order: number
  phase: string
  total: number
  cycle: number
  retro: number
}

export interface PhaseActivity {
  phase: string
  kind: LeadPhaseKind | null
  order: number | null
  total: number
  cycle: number
  retro: number
}

export interface LeadActivity {
  funnel: StageActivity[]
  phaseDistribution: PhaseActivity[]
}

// Detalhamento por responsável de uma fase (drill-down ao clicar numa barra). agentId nulo =
// "Sem responsável". Usado nos dois gráficos: por fase ATUAL (distribuição) e por ordem
// ALCANÇADA (funil).
export interface AgentCount {
  agentId: string | null
  name: string
  count: number
}

// "Em qual tentativa o lead mais morre" (S3): entre os leads mortos, a última etapa
// produtiva que alcançaram (max_funnel_order → nome da etapa). Distribuição da mortalidade
// pelo funil de acionamento.
export interface DeathByAttempt {
  order: number
  phase: string
  deaths: number
}

// Desempenho por canal de captação (S5.1). O canal (`capta_o_do_lead`) virou obrigatório no
// Pipefy — enquanto o histórico não enche, a UI usa `channelFillRate` para marcar o painel
// como "dado incompleto".
export interface ChannelStat {
  channel: string
  totalLeads: number
  wonLeads: number
  deadLeads: number
  conversionRate: number
  deadRate: number
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
  pipefyCardId: string | null // para o link "abrir no Pipefy" (open-cards)
  title: string | null
  currentPhase: string | null
  responsible: string | null
  updatedAt: string | null
}

export interface LeadsData {
  kpis: LeadKpis
  funnel: FunnelStage[]
  phaseDistribution: PhaseDistribution[]
  deadReasons: DeadReason[]
  deathByAttempt: DeathByAttempt[]
  ranking: AgentRankRow[]
  channelBreakdown: ChannelStat[]
  channelFillRate: number // 0..1 — fração dos leads do período com canal preenchido
  // Drill-down por responsável (clique na barra). Chaveado por nome da fase (distribuição
  // atual) e por ordem produtiva "<n>" (funil cumulativo). Vazio quando a migration não rodou.
  phaseByResponsible: Record<string, AgentCount[]>
  funnelByResponsible: Record<string, AgentCount[]>
}

// Evolução DIÁRIA dentro do período (linha da Visão Geral — Sprint 2). Um ponto por dia (BRT);
// recebidos por created_at, ganhos/mortos por finalized_at.
export interface DailyPoint {
  day: string // 'YYYY-MM-DD'
  received: number
  won: number
  dead: number
}

// Tendência ENTRE CICLOS (aba Performance — Sprint 2). Um ponto por ciclo (11→10). As taxas
// são derivadas no app a partir dos brutos do RPC.
export interface TrendPoint {
  key: string
  label: string // rótulo curto do ciclo (mês de início), ex.: "jun"
  received: number
  won: number
  dead: number
  conversionRate: number // 0..1
  deadRate: number // 0..1
  avgHoursToFirstContact: number | null
}

// Tempo médio por etapa (S3 — Funil aprofundado). Quanto tempo um lead fica em cada
// etapa produtiva ANTES de sair dela (dwell time), via lead_events. sampleSize = 0 /
// avgHours null quando não há transições completas no período (ou a migration do
// RPC não rodou ainda) — a UI trata como "sem dados", não como zero.
export interface StepDwellTime {
  order: number
  phase: string
  avgHours: number | null
  sampleSize: number
}

type SupabaseClient = Awaited<ReturnType<typeof createServerClient>>

// ── Shapers puros (compartilhados entre o caminho RPC e o fallback em memória) ──
// Recebem agregados JÁ pequenos e produzem a forma final. Nada aqui pode truncar.

// wonCycle/wonRetro default a won/0: até a RPC get_leads_won_by_sale_date rodar (ou no
// fallback antes do merge em getLeadsData), assume tudo "do ciclo" — degradação graciosa,
// mesmo padrão das outras métricas novas (ver getLeadsFunnelDepth).
function kpisFromCounts(
  total: number,
  open: number,
  won: number,
  dead: number,
  avgFtc: number | null,
  wonCycle: number = won,
  wonRetro: number = 0
): LeadKpis {
  return {
    totalLeads: total,
    openLeads: open,
    wonLeads: won,
    deadLeads: dead,
    wonCycle,
    wonRetro,
    conversionRate: total > 0 ? won / total : 0,
    deadRate: total > 0 ? dead / total : 0,
    avgHoursToFirstContact: avgFtc,
  }
}

// Funil: casa cada ordem produtiva com o rótulo LIMPO de PRODUCTIVE_PHASES (os nomes no
// banco têm lixo). reachedByOrder é { "<ordem>": leadsAlcançaram }.
function buildFunnel(reachedByOrder: Record<string, number>): FunnelStage[] {
  return PRODUCTIVE_PHASES.map((p) => ({
    order: p.order,
    phase: p.name,
    leadsReached: reachedByOrder[String(p.order)] ?? 0,
  }))
}

// Escada 0…maior-ordem-com-morte, preenchendo os vãos com zero (a forma da queda importa);
// ordens sem nenhuma morte no topo são cortadas. deathByOrder é { "<ordem>": mortos }.
function buildDeathByAttempt(deathByOrder: Record<string, number>): DeathByAttempt[] {
  const orders = Object.keys(deathByOrder).map(Number)
  const maxDeathOrder = orders.length ? Math.max(...orders) : -1
  return PRODUCTIVE_PHASES.filter((p) => p.order <= maxDeathOrder).map((p) => ({
    order: p.order,
    phase: p.name,
    deaths: deathByOrder[String(p.order)] ?? 0,
  }))
}

interface ChannelAgg {
  channel: string
  total: number
  won: number
  dead: number
}

// Cap top-12 por volume + "Outros" (não estoura se as campanhas crescerem). channelFillRate
// = fração dos leads do período com canal preenchido (a UI marca "incompleto" se for baixa).
const CHANNEL_TOP_N = 12
function buildChannels(
  aggs: ChannelAgg[],
  filled: number,
  totalRows: number
): { channelBreakdown: ChannelStat[]; channelFillRate: number } {
  const toStat = (a: ChannelAgg): ChannelStat => ({
    channel: a.channel,
    totalLeads: a.total,
    wonLeads: a.won,
    deadLeads: a.dead,
    conversionRate: a.total > 0 ? a.won / a.total : 0,
    deadRate: a.total > 0 ? a.dead / a.total : 0,
  })
  const sorted = [...aggs].sort((a, b) => b.total - a.total || a.channel.localeCompare(b.channel))
  let channelBreakdown: ChannelStat[]
  if (sorted.length <= CHANNEL_TOP_N) {
    channelBreakdown = sorted.map(toStat)
  } else {
    const outros = sorted.slice(CHANNEL_TOP_N).reduce<ChannelAgg>(
      (acc, a) => ({
        channel: 'Outros',
        total: acc.total + a.total,
        won: acc.won + a.won,
        dead: acc.dead + a.dead,
      }),
      { channel: 'Outros', total: 0, won: 0, dead: 0 }
    )
    channelBreakdown = [...sorted.slice(0, CHANNEL_TOP_N).map(toStat), toStat(outros)]
  }
  return { channelBreakdown, channelFillRate: totalRows > 0 ? filled / totalRows : 0 }
}

interface AgentAgg {
  agentId: string
  name: string
  total: number
  won: number
  dead: number
  avgHoursToFirstContact: number | null
}

function buildRanking(aggs: AgentAgg[]): AgentRankRow[] {
  return aggs
    .map((a) => ({
      agentId: a.agentId,
      name: a.name,
      totalLeads: a.total,
      wonLeads: a.won,
      deadLeads: a.dead,
      conversionRate: a.total > 0 ? a.won / a.total : 0,
      deadRate: a.total > 0 ? a.dead / a.total : 0,
      avgHoursToFirstContact: a.avgHoursToFirstContact,
    }))
    .sort((a, b) => b.wonLeads - a.wonLeads || b.totalLeads - a.totalLeads)
}

// Média de N valores, arredondada a 1 casa (mesma regra dos dois lados). null se vazio.
function avg1(values: number[]): number | null {
  if (values.length === 0) return null
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
}

// Só as colunas de v_lead_progress que a agregação em memória (fallback) consome.
const PROGRESS_COLS =
  'lead_id, responsible_agent_id, duplicate_responsible, channel, ' +
  'current_phase, phase_kind, current_funnel_order, ' +
  'is_dead, is_open, is_won, max_funnel_order, hours_to_first_contact'

// ── Preferido: agrega o dashboard NO POSTGRES (RPC get_leads_dashboard) ────────
// Devolve 1 linha (um jsonb) contando tudo no banco — imune ao teto de "Max Rows". Retorna
// null se a função ainda não existir (migration não rodada) → cai no fallback paginado.
interface DashboardRpc {
  kpis: { total: number; open: number; won: number; dead: number; avgHoursToFirstContact: number | null }
  funnelByOrder: Record<string, number>
  funnelByResponsible: Record<string, AgentCount[]>
  phaseDistribution: PhaseDistribution[]
  phaseByResponsible: Record<string, AgentCount[]>
  deadReasons: { reason: string; leads: number }[]
  deathByOrder: Record<string, number>
  channels: ChannelAgg[]
  channelFilled: number
  ranking: AgentAgg[]
}

async function dashboardFromRpc(
  supabase: SupabaseClient,
  period: LeadPeriod
): Promise<LeadsData | null> {
  const { data, error } = await supabase.rpc('get_leads_dashboard', {
    p_start: period.start,
    p_end: period.end,
  })
  if (error || !data) return null
  const d = data as unknown as DashboardRpc
  const k = d.kpis ?? { total: 0, open: 0, won: 0, dead: 0, avgHoursToFirstContact: null }
  const { channelBreakdown, channelFillRate } = buildChannels(
    d.channels ?? [],
    d.channelFilled ?? 0,
    k.total
  )
  return {
    kpis: kpisFromCounts(k.total, k.open, k.won, k.dead, k.avgHoursToFirstContact),
    funnel: buildFunnel(d.funnelByOrder ?? {}),
    phaseDistribution: d.phaseDistribution ?? [],
    deadReasons: (d.deadReasons ?? []).map((x) => ({ reason: x.reason, leads: x.leads })),
    deathByAttempt: buildDeathByAttempt(d.deathByOrder ?? {}),
    ranking: buildRanking(d.ranking ?? []),
    channelBreakdown,
    channelFillRate,
    phaseByResponsible: d.phaseByResponsible ?? {},
    funnelByResponsible: d.funnelByResponsible ?? {},
  }
}

// ── Fallback: agrega em memória a partir de v_lead_progress (paginado, correto mas mais
// lento). Só roda enquanto a migration do RPC não estiver aplicada. ────────────
async function dashboardFromScan(
  supabase: SupabaseClient,
  period: LeadPeriod
): Promise<LeadsData> {
  const [rows, agentsRes, finalizedRows] = await Promise.all([
    fetchAllRows<LeadProgressRow>(
      (from, to) =>
        supabase
          .from('v_lead_progress')
          .select(PROGRESS_COLS)
          .gte('created_at', period.start)
          .lt('created_at', period.end)
          .order('lead_id', { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: LeadProgressRow[] | null }>
    ),
    supabase.from('lead_agents').select('id, pipefy_name'),
    // Ganhos/mortos do KPI principal são por DATA DE VENDA (finalized_at), não created_at —
    // mesma correção da RPC get_leads_won_by_sale_date. Conjunto SEPARADO de `rows`: um lead
    // pode ter sido criado fora do período e vendido dentro dele (ver comentário no topo do
    // arquivo). Ranking/canal continuam usando `rows` (fora de escopo deste fix).
    fetchAllRows<LeadProgressRow>(
      (from, to) =>
        supabase
          .from('v_lead_progress')
          .select('lead_id, is_won, is_dead, created_at')
          .gte('finalized_at', period.start)
          .lt('finalized_at', period.end)
          .or('is_won.eq.true,is_dead.eq.true')
          .order('lead_id', { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: LeadProgressRow[] | null }>
    ),
  ])

  const nameById = new Map(
    ((agentsRes.data ?? []) as { id: string; pipefy_name: string | null }[]).map((a) => [
      a.id,
      a.pipefy_name ?? 'Sem nome',
    ])
  )

  // KPIs. A média do 1º contato ignora os retroativos (contato < criação → horas < 0):
  // são leads antigos com data real de contato anterior à entrada no pipe, não tempo de resposta.
  let open = 0
  const ftc: number[] = []
  for (const r of rows) {
    if (r.is_open) open++
    if (r.hours_to_first_contact != null && r.hours_to_first_contact >= 0)
      ftc.push(r.hours_to_first_contact)
  }
  const total = rows.length

  // Ganhos/mortos + split ciclo × retroativo, a partir de finalizedRows (por finalized_at).
  let won = 0
  let wonCycle = 0
  let dead = 0
  for (const r of finalizedRows) {
    const inCycle = r.created_at != null && r.created_at >= period.start && r.created_at < period.end
    if (r.is_won) {
      won++
      if (inCycle) wonCycle++
    }
    if (r.is_dead) dead++
  }
  const wonRetro = won - wonCycle

  // Funil (cumulativo): quem alcançou cada ordem ou além. A ordem 0 (Recebidos) é ancorada
  // em TODOS os recebidos — todo lead passou por Recebidos, mesmo o morto sem evento produtivo
  // (max_funnel_order = -1), que senão sumiria do funil.
  const reachedByOrder: Record<string, number> = {}
  for (const p of PRODUCTIVE_PHASES) {
    reachedByOrder[String(p.order)] =
      p.order === 0 ? total : rows.filter((r) => (r.max_funnel_order ?? -1) >= p.order).length
  }

  // Distribuição por fase atual (volume): quantos leads do período estão agora em cada fase.
  const phaseMap = new Map<string, PhaseDistribution>()
  for (const r of rows) {
    const phase = r.current_phase?.trim() || '—'
    const e =
      phaseMap.get(phase) ??
      { phase, kind: r.phase_kind, order: r.current_funnel_order, leads: 0 }
    e.leads++
    phaseMap.set(phase, e)
  }
  const phaseDistribution: PhaseDistribution[] = [...phaseMap.values()].sort(
    (a, b) => (a.order ?? 999) - (b.order ?? 999) || b.leads - a.leads
  )

  // Drill-down por responsável (mesma lógica das seções do RPC). agentId nulo → "Sem responsável".
  const resolveName = (agentId: string | null) =>
    agentId ? nameById.get(agentId) ?? 'Sem nome' : 'Sem responsável'
  const sortAgents = (m: Map<string, AgentCount>) =>
    [...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  // Por fase ATUAL × responsável (quem está parado ali agora).
  const phaseAgentMap = new Map<string, Map<string, AgentCount>>()
  for (const r of rows) {
    const phase = r.current_phase?.trim() || '—'
    const key = r.responsible_agent_id ?? 'orphan'
    let m = phaseAgentMap.get(phase)
    if (!m) {
      m = new Map()
      phaseAgentMap.set(phase, m)
    }
    const e =
      m.get(key) ??
      { agentId: r.responsible_agent_id ?? null, name: resolveName(r.responsible_agent_id), count: 0 }
    e.count++
    m.set(key, e)
  }
  const phaseByResponsible: Record<string, AgentCount[]> = {}
  for (const [phase, m] of phaseAgentMap) phaseByResponsible[phase] = sortAgents(m)

  // Por ordem ALCANÇADA × responsável (quem passou; ordem 0 = todos, igual ao funil).
  const funnelByResponsible: Record<string, AgentCount[]> = {}
  for (const p of PRODUCTIVE_PHASES) {
    const m = new Map<string, AgentCount>()
    for (const r of rows) {
      if (!(p.order === 0 || (r.max_funnel_order ?? -1) >= p.order)) continue
      const key = r.responsible_agent_id ?? 'orphan'
      const e =
        m.get(key) ??
        { agentId: r.responsible_agent_id ?? null, name: resolveName(r.responsible_agent_id), count: 0 }
      e.count++
      m.set(key, e)
    }
    funnelByResponsible[String(p.order)] = sortAgents(m)
  }

  // Motivos de descarte = FASE MORTA (não o texto livre discard_reason) + mortalidade por
  // ordem. Morto com max_funnel_order = -1 conta na ordem 0 (morreu em Recebidos).
  const reasonCount = new Map<string, number>()
  const deathByOrder: Record<string, number> = {}
  for (const r of rows) {
    if (!r.is_dead) continue
    const reason = r.current_phase?.trim() || 'Não informado'
    reasonCount.set(reason, (reasonCount.get(reason) ?? 0) + 1)
    const ord = Math.max(r.max_funnel_order ?? -1, 0)
    deathByOrder[String(ord)] = (deathByOrder[String(ord)] ?? 0) + 1
  }
  const deadReasons: DeadReason[] = [...reasonCount]
    .map(([reason, leads]) => ({ reason, leads }))
    .sort((a, b) => b.leads - a.leads || a.reason.localeCompare(b.reason))

  // Canal.
  let channelFilled = 0
  const chMap = new Map<string, ChannelAgg>()
  for (const r of rows) {
    const v = r.channel?.trim()
    if (v) channelFilled++
    const key = v || 'Não informado'
    const a = chMap.get(key) ?? { channel: key, total: 0, won: 0, dead: 0 }
    a.total++
    if (r.is_won) a.won++
    if (r.is_dead) a.dead++
    chMap.set(key, a)
  }
  const { channelBreakdown, channelFillRate } = buildChannels(
    [...chMap.values()],
    channelFilled,
    total
  )

  // Ranking (exclui sem-responsável e duplicados).
  const agMap = new Map<string, { agg: AgentAgg; ftc: number[] }>()
  for (const r of rows) {
    if (!r.responsible_agent_id || r.duplicate_responsible) continue
    const id = r.responsible_agent_id
    const e =
      agMap.get(id) ??
      {
        agg: {
          agentId: id,
          name: nameById.get(id) ?? 'Sem nome',
          total: 0,
          won: 0,
          dead: 0,
          avgHoursToFirstContact: null,
        },
        ftc: [] as number[],
      }
    e.agg.total++
    if (r.is_won) e.agg.won++
    if (r.is_dead) e.agg.dead++
    if (r.hours_to_first_contact != null && r.hours_to_first_contact >= 0)
      e.ftc.push(r.hours_to_first_contact)
    agMap.set(id, e)
  }
  const rankingAggs: AgentAgg[] = [...agMap.values()].map((e) => ({
    ...e.agg,
    avgHoursToFirstContact: avg1(e.ftc),
  }))

  return {
    kpis: kpisFromCounts(total, open, won, dead, avg1(ftc), wonCycle, wonRetro),
    funnel: buildFunnel(reachedByOrder),
    phaseDistribution,
    deadReasons,
    deathByAttempt: buildDeathByAttempt(deathByOrder),
    ranking: buildRanking(rankingAggs),
    channelBreakdown,
    channelFillRate,
    phaseByResponsible,
    funnelByResponsible,
  }
}

interface WonBySaleDate {
  won: number
  dead: number
  wonCycle: number
  wonRetro: number
}

// Ganhos/mortos por DATA DE VENDA (RPC get_leads_won_by_sale_date — migration 20260717),
// com split ciclo × retroativo. Substitui o won/dead de get_leads_dashboard (que conta por
// created_at) nos KPIs de topo. null se a migration ainda não rodou → getLeadsData degrada
// pro comportamento antigo (mesmo padrão de dashboardFromRpc/getLeadsTimeseries).
async function wonBySaleDate(
  supabase: SupabaseClient,
  period: LeadPeriod
): Promise<WonBySaleDate | null> {
  const { data, error } = await supabase.rpc('get_leads_won_by_sale_date', {
    p_start: period.start,
    p_end: period.end,
  })
  if (error || !data) return null
  return data as unknown as WonBySaleDate
}

interface ReachFunnel {
  funnelByOrder: Record<string, number>
  funnelByResponsible: Record<string, AgentCount[]>
}

// Funil de acionamento PRINCIPAL contado por ENTRADA REAL de fase (RPC
// get_leads_reach_funnel — migration 20260731), substituindo o funnelByOrder/
// funnelByResponsible que get_leads_dashboard calcula com `max_funnel_order >= ordem`
// (cumulativo, que "preenche" fases puladas). Regra do dono: acionamento só quando o
// card ENTRA na fase — um lead que pula de 1° pra Fechamento conta só nessas duas, não
// nas intermediárias. Ordem 0 = todo o cohort de recebidos (todos entram em Recebidos).
// null se a migration ainda não rodou → getLeadsData mantém o funil antigo (degradação
// graciosa, mesmo padrão de wonBySaleDate).
async function reachFunnel(
  supabase: SupabaseClient,
  period: LeadPeriod
): Promise<ReachFunnel | null> {
  const { data, error } = await supabase.rpc('get_leads_reach_funnel', {
    p_start: period.start,
    p_end: period.end,
  })
  if (error || !data) return null
  return data as unknown as ReachFunnel
}

// Tudo que deriva dos leads do período. RPC (contado no banco) ou fallback paginado, com o
// won/dead de topo corrigido por data de venda (ver wonBySaleDate) e o funil de acionamento
// contado por entrada real de fase (ver reachFunnel). Ranking/canal continuam vindo do
// dashboard base (fora de escopo desta correção).
export async function getLeadsData(periodInput: LeadPeriod): Promise<LeadsData> {
  const period = sanitizePeriod(periodInput) // saneia o período vindo do cliente
  const supabase = await createServerClient()
  const [base, sale, reach] = await Promise.all([
    (async () => (await dashboardFromRpc(supabase, period)) ?? dashboardFromScan(supabase, period))(),
    wonBySaleDate(supabase, period),
    reachFunnel(supabase, period),
  ])
  let out = base
  // Funil por entrada de fase sobrescreve o cumulativo do dashboard (barras + drill do
  // StepConversion). Ausente → mantém o funil antigo.
  if (reach) {
    out = {
      ...out,
      funnel: buildFunnel(reach.funnelByOrder),
      funnelByResponsible: reach.funnelByResponsible,
    }
  }
  if (sale) {
    out = {
      ...out,
      kpis: {
        ...out.kpis,
        wonLeads: sale.won,
        deadLeads: sale.dead,
        wonCycle: sale.wonCycle,
        wonRetro: sale.wonRetro,
        conversionRate: out.kpis.totalLeads > 0 ? sale.won / out.kpis.totalLeads : 0,
        deadRate: out.kpis.totalLeads > 0 ? sale.dead / out.kpis.totalLeads : 0,
      },
    }
  }
  return out
}

// ── Séries temporais (Sprint 2) ───────────────────────────────────────────────

// Evolução DIÁRIA dentro do período (RPC get_leads_timeseries). Vazio se a migration ainda não
// rodou → a linha da Visão Geral mostra estado vazio (degradação graciosa).
export async function getLeadsTimeseries(periodInput: LeadPeriod): Promise<DailyPoint[]> {
  const period = sanitizePeriod(periodInput)
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('get_leads_timeseries', {
    p_start: period.start,
    p_end: period.end,
  })
  if (error || !data) return []
  return data as DailyPoint[]
}

const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const TREND_CYCLES = 6

// Tendência ENTRE CICLOS (RPC get_leads_trend). Monta as janelas dos últimos N ciclos, agrega
// no banco numa chamada só e deriva as taxas + rótulos. Independe do período selecionado (é a
// leitura histórica "estamos melhorando?"). Vazio se a migration não rodou.
export async function getLeadsTrend(): Promise<TrendPoint[]> {
  const supabase = await createServerClient()
  const cycles = recentCycles(TREND_CYCLES).slice().reverse() // do mais antigo ao mais novo
  const windows = cycles.map((c) => ({ key: c.key, start: c.start, end: c.end }))
  const { data, error } = await supabase.rpc('get_leads_trend', { p_windows: windows })
  if (error || !data) return []
  const byKey = new Map(
    (
      data as {
        key: string
        received: number
        won: number
        dead: number
        avgHoursToFirstContact: number | null
      }[]
    ).map((r) => [r.key, r])
  )
  return cycles.map((c) => {
    const r = byKey.get(c.key)
    const received = Number(r?.received ?? 0)
    const won = Number(r?.won ?? 0)
    const dead = Number(r?.dead ?? 0)
    const month = Number(c.key.slice(5, 7))
    return {
      key: c.key,
      label: MONTHS_PT[month - 1] ?? c.key,
      received,
      won,
      dead,
      conversionRate: received > 0 ? won / received : 0,
      deadRate: received > 0 ? dead / received : 0,
      avgHoursToFirstContact: r?.avgHoursToFirstContact ?? null,
    }
  })
}

// ── Funil aprofundado (Sprint 3) ──────────────────────────────────────────────

// Tempo médio por etapa (RPC get_leads_dwell_time). Vazio/null se a migration ainda
// não rodou → a UI mostra estado vazio (mesma degradação graciosa das séries do S2).
// Só até a penúltima etapa produtiva (Venda é terminal, não tem "tempo até a próxima").
export async function getLeadsFunnelDepth(periodInput: LeadPeriod): Promise<StepDwellTime[]> {
  const period = sanitizePeriod(periodInput)
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('get_leads_dwell_time', {
    p_start: period.start,
    p_end: period.end,
  })
  const byOrder = new Map(
    (error || !data ? [] : (data as { funnel_order: number; avg_hours: number | null; sample_size: number }[])).map(
      (r) => [r.funnel_order, r]
    )
  )
  return PRODUCTIVE_PHASES.filter((p) => p.order < WON_ORDER).map((p) => {
    const r = byOrder.get(p.order)
    return { order: p.order, phase: p.name, avgHours: r?.avg_hours ?? null, sampleSize: r?.sample_size ?? 0 }
  })
}

interface ActivityRpc {
  funnelByOrder: Record<string, { total: number; cycle: number; retro: number }>
  phaseDistribution: { phase: string; kind: LeadPhaseKind | null; order: number | null; total: number; cycle: number; retro: number }[]
}

// Funil "geral" (RPC get_leads_activity — migration 20260731): cohort = leads que ENTRARAM
// em alguma fase no período (não "updated_at"); cada barra conta quem entrou naquela etapa
// no período (não cumulativo). Um lead de ciclo anterior que entrou numa fase hoje aparece
// aqui (lado retro). Vazio se a migration ainda não rodou (degradação graciosa).
export async function getLeadsActivity(periodInput: LeadPeriod): Promise<LeadActivity> {
  const period = sanitizePeriod(periodInput)
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('get_leads_activity', {
    p_start: period.start,
    p_end: period.end,
  })
  if (error || !data) return { funnel: [], phaseDistribution: [] }
  const d = data as unknown as ActivityRpc
  const funnel: StageActivity[] = PRODUCTIVE_PHASES.map((p) => {
    const r = d.funnelByOrder?.[String(p.order)]
    return { order: p.order, phase: p.name, total: r?.total ?? 0, cycle: r?.cycle ?? 0, retro: r?.retro ?? 0 }
  })
  const phaseDistribution: PhaseActivity[] = (d.phaseDistribution ?? []).map((r) => ({
    phase: r.phase,
    kind: r.kind,
    order: r.order,
    total: r.total,
    cycle: r.cycle,
    retro: r.retro,
  }))
  return { funnel, phaseDistribution }
}

// ── Drill de card por responsável (aba Funil) — lazy, 2 passos ───────────────
// Clicar numa barra abre os RESPONSÁVEIS daquele recorte (nível 1, leve); clicar num
// responsável carrega os CARDS dele (nível 2). Evita puxar milhares de cards de uma vez.
// RPCs get_leads_drill_agents/get_leads_drill_cards (reescritas na migration 20260731 para
// contar por ENTRADA de fase, casando com as barras). p_key: funnel* = ordem ("entrou na
// ordem", 0=todos os recebidos); phase* = nome da fase atual.
export type LeadDrillDimension = 'funnel' | 'phase' | 'funnel_activity' | 'phase_activity'

export interface LeadDrillAgent {
  agentId: string | null
  name: string
  count: number
}

export interface LeadDrillCard {
  pipefyCardId: string
  title: string | null
}

export async function getLeadsDrillAgents(
  dimension: LeadDrillDimension,
  key: string,
  periodInput: LeadPeriod,
): Promise<LeadDrillAgent[]> {
  const period = sanitizePeriod(periodInput)
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('get_leads_drill_agents', {
    p_dimension: dimension,
    p_key: key,
    p_start: period.start,
    p_end: period.end,
  })
  if (error || !data) return []
  return data as unknown as LeadDrillAgent[]
}

export async function getLeadsDrillCards(
  dimension: LeadDrillDimension,
  key: string,
  agentId: string | null,
  periodInput: LeadPeriod,
): Promise<LeadDrillCard[]> {
  const period = sanitizePeriod(periodInput)
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('get_leads_drill_cards', {
    p_dimension: dimension,
    p_key: key,
    p_agent: agentId,
    p_start: period.start,
    p_end: period.end,
  })
  if (error || !data) return []
  return data as unknown as LeadDrillCard[]
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
// O RLS escopa ao próprio agente. Paginado (fetchAllRows) para não truncar em 1000 se a
// carga do agente for grande; o order por is_stuck/created_at/lead_id é determinístico.
export async function getAgentLeads(periodInput: LeadPeriod): Promise<AgentLeadRow[]> {
  const period = sanitizePeriod(periodInput) // start/end entram num filtro .or() montado por string
  const supabase = await createServerClient()
  const rows = await fetchAllRows<LeadProgressRow>(
    (from, to) =>
      supabase
        .from('v_lead_progress')
        .select(AGENT_LEAD_COLS)
        .or(
          `finalized_at.is.null,and(finalized_at.gte.${period.start},finalized_at.lt.${period.end})`
        )
        .order('is_stuck', { ascending: false })
        .order('created_at', { ascending: true })
        .order('lead_id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: LeadProgressRow[] | null }>
  )

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
// Poucos leads (~15 na base real), então uma leitura basta — bem abaixo do teto.
export async function getDuplicateAlerts(): Promise<DuplicateAlert[]> {
  const supabase = await createServerClient()
  const { data } = await supabase
    .from('v_duplicate_responsibility')
    .select('lead_id, pipefy_card_id, title, current_phase, responsible, updated_at')
    .order('updated_at', { ascending: false })

  return ((data ?? []) as DuplicateResponsibilityRow[]).map((r) => ({
    leadId: r.lead_id,
    pipefyCardId: r.pipefy_card_id,
    title: r.title,
    currentPhase: r.current_phase,
    responsible: r.responsible,
    updatedAt: r.updated_at,
  }))
}

// ── Visão do supervisor (S3): métricas de ESTADO ATUAL (não por período) ─────
// "Parados agora" e "sem acionamento" são NOW-scoped: leem a base aberta via a MESMA
// v_lead_progress (o RLS deixa o supervisor ver tudo; a página nem chama isto para o papel
// agent). "Parados agora" é agregado no Postgres (RPC get_agent_stuck); os órfãos e o
// fallback de parados são paginados para não truncar em 1000.

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
  name: string // nome do agente (p/ montar linhas de agentes que só têm parados retroativos)
}

export interface TeamStuck {
  total: number
  cycle: number
  retro: number
}

export interface ForgottenLead {
  leadId: string
  title: string | null
  currentPhase: string | null
  responsible: string | null
  createdAt: string | null
}

// Leads sem responsável (órfãos), para o supervisor triar — estado atual, distribuído por
// fase. Supervisor+ vê todos os órfãos (não pertencem a nenhuma equipe). Ver a policy
// leads_select em 20260707_leads_supervisor_scope.sql.
export interface OrphanSummary {
  total: number
  open: number
  byPhase: { phase: string; leads: number }[]
}

export interface SupervisorMetrics {
  // Parados agora por agente (keyed by agentId) — exclui responsabilidade duplicada, para
  // casar com o ranking (que já os exclui). Estado atual; `cycle` reancorado ao período.
  stuckByAgent: Record<string, StuckSplit>
  // Total da equipe (inclui duplicados) com split ciclo × retroativo.
  teamStuck: TeamStuck
  // Leads abertos em Recebidos/1° Acionamento, sem 1º contato, há mais de X horas (os
  // FORGOTTEN_LIMIT mais antigos); forgottenTotal = quantos existem ao todo.
  forgotten: ForgottenLead[]
  forgottenTotal: number
  forgottenThresholdHours: number
  // Leads sem responsável (órfãos), distribuídos por fase — para triagem.
  orphans: OrphanSummary
}

// Só as colunas de v_lead_progress que cada agregação consome (egress enxuto).
const STUCK_COLS = 'responsible_agent_id, created_at, duplicate_responsible'
const FORGOTTEN_COLS = 'lead_id, title, current_phase, responsible_agent_id, created_at'

type NameById = Map<string, string>
interface StuckAgg {
  byAgent: Record<string, StuckSplit>
  team: TeamStuck
}

// Preferido: agrega "parados agora" NO POSTGRES (RPC get_agent_stuck) — devolve ~1 linha por
// agente + 1 linha "equipe" (agent_id NULL) em vez de puxar a base aberta inteira pro Worker
// (menos egress e CPU do Worker — mesma filosofia do fix do Error 1102). Retorna null se a
// função ainda não existir no banco (migration não rodada) → cai no fallback.
async function stuckFromRpc(
  supabase: SupabaseClient,
  period: LeadPeriod
): Promise<StuckAgg | null> {
  const { data, error } = await supabase.rpc('get_agent_stuck', {
    p_start: period.start,
    p_end: period.end,
  })
  if (error || !data) return null
  const rows = data as {
    agent_id: string | null
    pipefy_name: string | null
    stuck_now: number
    stuck_cycle: number
  }[]
  const byAgent: Record<string, StuckSplit> = {}
  let team: TeamStuck = { total: 0, cycle: 0, retro: 0 }
  for (const r of rows) {
    const now = Number(r.stuck_now)
    const cycle = Number(r.stuck_cycle)
    if (r.agent_id == null) {
      team = { total: now, cycle, retro: now - cycle } // linha "equipe"
    } else {
      byAgent[r.agent_id] = { now, cycle, name: r.pipefy_name ?? 'Sem nome' }
    }
  }
  return { byAgent, team }
}

// Fallback: agrega em memória a partir de v_lead_progress (is_stuck=true). Mais lento (puxa a
// base aberta), mas mantém a tela funcionando enquanto a migration do RPC não roda. Paginado
// para não truncar em 1000 (a base parada passa disso).
async function stuckFromScan(
  supabase: SupabaseClient,
  period: LeadPeriod,
  nameById: NameById
): Promise<StuckAgg> {
  const rows = await fetchAllRows<LeadProgressRow>(
    (from, to) =>
      supabase
        .from('v_lead_progress')
        .select(STUCK_COLS)
        .eq('is_stuck', true)
        .order('lead_id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: LeadProgressRow[] | null }>
  )
  const inPeriod = (c: string | null) => c != null && c >= period.start && c < period.end
  const byAgent: Record<string, StuckSplit> = {}
  let total = 0
  let cycle = 0
  for (const r of rows) {
    total++
    const cyc = inPeriod(r.created_at)
    if (cyc) cycle++
    if (!r.responsible_agent_id || r.duplicate_responsible) continue
    const s = (byAgent[r.responsible_agent_id] ??= {
      now: 0,
      cycle: 0,
      name: nameById.get(r.responsible_agent_id) ?? 'Sem nome',
    })
    s.now++
    if (cyc) s.cycle++
  }
  return { byAgent, team: { total, cycle, retro: total - cycle } }
}

export async function getSupervisorMetrics(periodInput: LeadPeriod): Promise<SupervisorMetrics> {
  const period = sanitizePeriod(periodInput) // saneia o período vindo do cliente
  const supabase = await createServerClient()
  const cutoff = new Date(Date.now() - FORGOTTEN_THRESHOLD_HOURS * 3_600_000).toISOString()

  const [forgottenRes, agentsRes, orphanRows, rpcStuck] = await Promise.all([
    // Esquecidos — abertos em Recebidos/1° Acionamento, sem 1º contato, mais velhos que o
    // limite. count exact traz o total mesmo com o teto de linhas (a lista é capada de propósito).
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
    // Órfãos — leads sem responsável (o RLS já deixa supervisor+ ver todos). Paginado para
    // não truncar em 1000 se crescerem; colunas enxutas para agregar por fase em memória.
    fetchAllRows<{ current_phase: string | null; is_open: boolean }>(
      (from, to) =>
        supabase
          .from('v_lead_progress')
          .select('current_phase, is_open')
          .is('responsible_agent_id', null)
          .order('lead_id', { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data: { current_phase: string | null; is_open: boolean }[] | null
        }>
    ),
    stuckFromRpc(supabase, period),
  ])

  const nameById: NameById = new Map(
    ((agentsRes.data ?? []) as { id: string; pipefy_name: string | null }[]).map((a) => [
      a.id,
      a.pipefy_name ?? 'Sem nome',
    ])
  )

  // Parados agora: RPC (agregado no banco) ou fallback (agregado em memória, paginado).
  const stuck = rpcStuck ?? (await stuckFromScan(supabase, period, nameById))

  // Esquecidos → resolve o nome do responsável para o alerta.
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

  // Órfãos → total, abertos e distribuição por fase (desc).
  const orphanByPhase = new Map<string, number>()
  let orphanOpen = 0
  for (const r of orphanRows) {
    if (r.is_open) orphanOpen++
    const phase = r.current_phase?.trim() || '—'
    orphanByPhase.set(phase, (orphanByPhase.get(phase) ?? 0) + 1)
  }
  const orphans: OrphanSummary = {
    total: orphanRows.length,
    open: orphanOpen,
    byPhase: [...orphanByPhase]
      .map(([phase, leads]) => ({ phase, leads }))
      .sort((a, b) => b.leads - a.leads),
  }

  return {
    stuckByAgent: stuck.byAgent,
    teamStuck: stuck.team,
    forgotten,
    forgottenTotal: forgottenRes.count ?? forgotten.length,
    forgottenThresholdHours: FORGOTTEN_THRESHOLD_HOURS,
    orphans,
  }
}
