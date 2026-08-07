'use server'

import { createServerClient } from '@/lib/supabase/server'
import type { Profile, Campaign, CampaignContact, ContactStatus, Department } from '@/lib/types/database'

// Lê de v_campaigns (status calculado a partir do estado real da campanha — ver
// migration 20260715_campaign_status_archive.sql). includeArchived=false (padrão)
// esconde campanhas arquivadas da lista de gestão.
export async function getCampaigns(includeArchived = false): Promise<Campaign[]> {
  const supabase = await createServerClient()
  let query = supabase.from('v_campaigns').select('*').order('created_at', { ascending: false })
  if (!includeArchived) query = query.is('archived_at', null)
  const { data } = await query
  return (data ?? []) as Campaign[]
}

// Apenas as campanhas em que o agente participa (campaign_agents), excluindo arquivadas
export async function getCampaignsForAgent(agentId: string): Promise<Campaign[]> {
  const supabase = await createServerClient()
  const { data: links } = await supabase
    .from('campaign_agents')
    .select('campaign_id')
    .eq('agent_id', agentId)

  const ids = (links ?? []).map((l) => l.campaign_id as string)
  if (ids.length === 0) return []

  const { data } = await supabase
    .from('v_campaigns')
    .select('*')
    .in('id', ids)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
  return (data ?? []) as Campaign[]
}

export async function createCampaign(
  name: string
): Promise<Campaign | { error: string }> {
  const supabase = await createServerClient()

  // A campanha herda o departamento do criador (supervisor). Admin/manager não têm
  // departamento → fica null e é atribuído depois na configuração.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  let department_id: string | null = null
  if (user) {
    const { data: prof } = await supabase
      .from('profiles')
      .select('department_id')
      .eq('id', user.id)
      .single()
    department_id = (prof?.department_id as string | null) ?? null
  }

  const { data, error } = await supabase
    .from('campaigns')
    .insert({ name, department_id })
    .select()
    .single()
  if (error) return { error: error.message }
  return data as Campaign
}

// Exclui a campanha e tudo que depende dela. Removemos os filhos explicitamente
// (não dependemos de ON DELETE CASCADE no schema): contatos e listas primeiro,
// depois os vínculos de agentes, e por fim a própria campanha.
export async function deleteCampaign(id: string): Promise<{ error?: string }> {
  const supabase = await createServerClient()

  for (const step of [
    () => supabase.from('campaign_contacts').delete().eq('campaign_id', id),
    () => supabase.from('lists').delete().eq('campaign_id', id),
    () => supabase.from('campaign_agents').delete().eq('campaign_id', id),
    () => supabase.from('campaigns').delete().eq('id', id),
  ]) {
    const { error } = await step()
    if (error) return { error: error.message }
  }
  return {}
}

// Arquivamento reversível (distinto de deleteCampaign, que apaga tudo). Campanha
// arquivada some da lista do agente e do painel "ao vivo" do supervisor.
export async function archiveCampaign(id: string): Promise<{ error?: string }> {
  const supabase = await createServerClient()
  const { error } = await supabase
    .from('campaigns')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error: error.message }
  return {}
}

export async function unarchiveCampaign(id: string): Promise<{ error?: string }> {
  const supabase = await createServerClient()
  const { error } = await supabase
    .from('campaigns')
    .update({ archived_at: null })
    .eq('id', id)
  if (error) return { error: error.message }
  return {}
}

type SupabaseClient = Awaited<ReturnType<typeof createServerClient>>

interface PendingRow {
  id: string
  attempts: number
}

// Os `limit` contatos pendentes mais antigos da campanha. Uma leitura só — quem garante a
// exclusividade entre agentes é o claim (UPDATE ... WHERE status='pending'), não esta busca.
async function findPendingBatch(
  supabase: SupabaseClient,
  campaignId: string,
  limit: number
): Promise<PendingRow[]> {
  const { data } = await supabase
    .from('campaign_contacts')
    .select('id, attempts')
    .eq('campaign_id', campaignId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit)
  return (data ?? []) as PendingRow[]
}

async function findPending(supabase: SupabaseClient, campaignId: string) {
  const [row] = await findPendingBatch(supabase, campaignId, 1)
  return row ?? null
}

// Claim ATÔMICO de um contato: só vence se ele ainda estiver 'pending'. Devolve null quando
// outro agente levou a linha primeiro (a corrida é resolvida pelo Postgres, não aqui).
async function claimContact(
  supabase: SupabaseClient,
  pending: PendingRow,
  agentId: string
): Promise<CampaignContact | null> {
  const { data } = await supabase
    .from('campaign_contacts')
    .update({
      status: 'dialing',
      assigned_agent_id: agentId,
      dialed_at: new Date().toISOString(),
      attempts: pending.attempts + 1,
    })
    .eq('id', pending.id)
    .eq('status', 'pending')
    .select()
    .single()
  return (data as CampaignContact | null) ?? null
}

// Reciclagem: por lista com reciclagem ligada, esgota quem atingiu o limite de
// tentativas e devolve à fila ('pending') quem ainda pode e já esperou o suficiente
async function recycleCampaign(supabase: SupabaseClient, campaignId: string) {
  const { data: lists } = await supabase
    .from('lists')
    .select('id, recycle_statuses, recycle_after_hours, recycle_max_attempts')
    .eq('campaign_id', campaignId)
    .eq('recycle_enabled', true)

  for (const l of lists ?? []) {
    const statuses = (l.recycle_statuses ?? []) as string[]
    if (statuses.length === 0) continue

    // esgota os que bateram o limite (sai da fila permanentemente)
    await supabase
      .from('campaign_contacts')
      .update({ status: 'exhausted' })
      .eq('list_id', l.id)
      .in('status', statuses)
      .gte('attempts', l.recycle_max_attempts)

    // revive os que ainda têm tentativas e já esperaram recycle_after_hours
    const threshold = new Date(Date.now() - l.recycle_after_hours * 3_600_000).toISOString()
    await supabase
      .from('campaign_contacts')
      .update({ status: 'pending' })
      .eq('list_id', l.id)
      .in('status', statuses)
      .lt('attempts', l.recycle_max_attempts)
      .lt('dialed_at', threshold)
  }
}

// Busca o próximo contato pendente e marca atomicamente como 'dialing'.
// Se não houver pendentes, tenta reciclar e busca de novo.
export async function getNextContact(
  campaignId: string,
  agentId: string
): Promise<CampaignContact | null> {
  const supabase = await createServerClient()

  let pending = await findPending(supabase, campaignId)
  if (!pending) {
    await recycleCampaign(supabase, campaignId)
    pending = await findPending(supabase, campaignId)
  }
  if (!pending) return null

  // Claim atômico: só atualiza se ainda estiver 'pending' (evita race condition entre agentes)
  return claimContact(supabase, pending, agentId)
}

// Quantas rodadas de (buscar candidatos → tentar claim) antes de desistir. Cada rodada só
// acontece se a anterior perdeu corrida para outro agente; com a fila cheia, UMA basta.
const CLAIM_ROUNDS = 3

// Reserva ATÔMICA de até N contatos pendentes para discagem paralela.
//
// Cada contato continua sendo reservado por um UPDATE ... WHERE status='pending' individual —
// é ele que garante exclusividade entre agentes, e isso NÃO mudou. O que mudou é o formato do
// laço: antes era estritamente sequencial (1 SELECT + 1 UPDATE por contato, um de cada vez),
// então N=10 linhas paralelas custavam até 20 idas e voltas ENFILEIRADAS ao Supabase antes de
// a primeira discagem sair — com ~80 ms de RTT, ~1,6 s de agente parado olhando a tela.
//
// Agora: 1 SELECT traz os N candidatos mais antigos de uma vez e os claims saem em PARALELO
// (Promise.all). O custo vira ~2 RTTs em vez de 2N. Se algum claim perder a corrida, repete a
// rodada com os candidatos restantes (até CLAIM_ROUNDS) — a distinção entre "perdi a corrida"
// e "acabaram os pendentes" continua sendo feita pela busca, não pelo claim. Recicla uma vez
// se a fila zerar no meio, igual antes. Retorna de 0 a N contatos já marcados como 'dialing'.
export async function getNextContacts(
  campaignId: string,
  agentId: string,
  n: number
): Promise<CampaignContact[]> {
  const supabase = await createServerClient()
  const want = Math.max(1, n)
  const claimed: CampaignContact[] = []
  const tried = new Set<string>()
  let recycled = false

  for (let round = 0; round < CLAIM_ROUNDS && claimed.length < want; round++) {
    const missing = want - claimed.length
    // Busca com folga: alguns candidatos podem ter sido levados por outro agente entre o
    // SELECT e o UPDATE, e os já tentados nesta chamada precisam ser pulados.
    let candidates = (await findPendingBatch(supabase, campaignId, missing + tried.size)).filter(
      (c) => !tried.has(c.id)
    )

    if (candidates.length === 0) {
      if (recycled) break
      await recycleCampaign(supabase, campaignId)
      recycled = true
      candidates = (await findPendingBatch(supabase, campaignId, missing + tried.size)).filter(
        (c) => !tried.has(c.id)
      )
      if (candidates.length === 0) break
    }

    const batch = candidates.slice(0, missing)
    for (const c of batch) tried.add(c.id)

    const results = await Promise.all(batch.map((c) => claimContact(supabase, c, agentId)))
    for (const row of results) if (row) claimed.push(row)
  }

  return claimed
}

// Devolve à fila contatos que foram reservados ('dialing') mas nunca chegaram a ser discados
// de verdade — lote paralelo que o helper recusou, ou pausa do agente com as linhas ainda
// tocando. Sem isso eles ficam presos em 'dialing' para sempre: a reciclagem só olha os
// status configurados na lista e nenhum agente pega um contato que não está 'pending'.
// O `attempts` NÃO é decrementado: o claim já contou a tentativa e mexer nisso abriria porta
// para laço infinito num número problemático.
export async function releaseContacts(contactIds: string[]): Promise<{ error?: string }> {
  if (contactIds.length === 0) return {}
  const supabase = await createServerClient()
  const { error } = await supabase
    .from('campaign_contacts')
    .update({ status: 'pending', assigned_agent_id: null })
    .in('id', contactIds)
    .eq('status', 'dialing')
  if (error) return { error: error.message }
  return {}
}

export async function updateContactStatus(
  contactId: string,
  status: ContactStatus,
  disposition?: string,
  callLogId?: string
): Promise<{ error?: string }> {
  const supabase = await createServerClient()
  const { error } = await supabase
    .from('campaign_contacts')
    .update({
      status,
      ...(disposition !== undefined && { disposition }),
      ...(callLogId !== undefined && { call_log_id: callLogId }),
    })
    .eq('id', contactId)
  if (error) return { error: error.message }
  return {}
}

// ─── Configuração de campanha (supervisor) ──────────────────────────────────

export async function getDepartments(): Promise<Department[]> {
  const supabase = await createServerClient()
  const { data } = await supabase.from('departments').select('*').order('name')
  return (data ?? []) as Department[]
}

// Usuários aprovados (não 'pending') que podem participar de campanhas
export async function getAgents(): Promise<Pick<Profile, 'id' | 'name' | 'extension'>[]> {
  const supabase = await createServerClient()
  const { data } = await supabase
    .from('profiles')
    .select('id, name, extension')
    .neq('role', 'pending')
    .order('name')
  return (data ?? []) as Pick<Profile, 'id' | 'name' | 'extension'>[]
}

export async function getCampaignConfig(
  campaignId: string
): Promise<{ campaign: Campaign; agentIds: string[] } | null> {
  const supabase = await createServerClient()
  const [{ data: campaign }, { data: links }] = await Promise.all([
    supabase.from('campaigns').select('*').eq('id', campaignId).single(),
    supabase.from('campaign_agents').select('agent_id').eq('campaign_id', campaignId),
  ])
  if (!campaign) return null
  return {
    campaign: campaign as Campaign,
    agentIds: (links ?? []).map((l) => l.agent_id as string),
  }
}

export async function updateCampaignConfig(
  campaignId: string,
  config: {
    department_id: string | null
    schedule_start: string | null
    schedule_end: string | null
    visible_fields: string[]
    notify_dispositions: string[]
    parallel_lines: number
  }
): Promise<{ error?: string }> {
  const supabase = await createServerClient()
  // Clamp defensivo (a CHECK do banco é 1..10): garante valor válido vindo da UI.
  const parallel = Math.min(10, Math.max(1, Math.round(config.parallel_lines || 1)))
  const { error } = await supabase
    .from('campaigns')
    .update({
      department_id: config.department_id,
      schedule_start: config.schedule_start,
      schedule_end: config.schedule_end,
      visible_fields: config.visible_fields,
      notify_dispositions: config.notify_dispositions,
      parallel_lines: parallel,
      updated_at: new Date().toISOString(),
    })
    .eq('id', campaignId)
  if (error) return { error: error.message }
  return {}
}

// Substitui o conjunto de agentes participantes da campanha
export async function setCampaignAgents(
  campaignId: string,
  agentIds: string[]
): Promise<{ error?: string }> {
  const supabase = await createServerClient()
  const { error: delError } = await supabase
    .from('campaign_agents')
    .delete()
    .eq('campaign_id', campaignId)
  if (delError) return { error: delError.message }

  if (agentIds.length === 0) return {}

  const rows = agentIds.map((agent_id) => ({ campaign_id: campaignId, agent_id }))
  const { error } = await supabase.from('campaign_agents').insert(rows)
  if (error) return { error: error.message }
  return {}
}

export async function getCampaignStats(campaignId: string): Promise<{
  total: number
  pending: number
  dialing: number
  answered: number
  no_answer: number
  busy: number
  failed: number
  do_not_call: number
  abandoned: number
}> {
  const supabase = await createServerClient()

  // Contagem por status agregada no banco (view v_campaign_status_counts): o Worker
  // lê 1 linha em vez de varrer todos os contatos da campanha em JS. Sem contatos
  // (campanha vazia) → maybeSingle devolve null → zeros.
  const { data } = await supabase
    .from('v_campaign_status_counts')
    .select('*')
    .eq('campaign_id', campaignId)
    .maybeSingle()

  return {
    total: data?.total ?? 0,
    pending: data?.pending ?? 0,
    dialing: data?.dialing ?? 0,
    answered: data?.answered ?? 0,
    no_answer: data?.no_answer ?? 0,
    busy: data?.busy ?? 0,
    failed: data?.failed ?? 0,
    do_not_call: data?.do_not_call ?? 0,
    abandoned: data?.abandoned ?? 0,
  }
}
