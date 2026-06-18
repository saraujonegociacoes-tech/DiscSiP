'use server'

import { createServerClient } from '@/lib/supabase/server'
import type { Profile, Campaign, CampaignContact, CampaignStatus, ContactStatus, Department } from '@/lib/types/database'

export async function getCampaigns(): Promise<Campaign[]> {
  const supabase = await createServerClient()
  const { data } = await supabase
    .from('campaigns')
    .select('*')
    .order('created_at', { ascending: false })
  return (data ?? []) as Campaign[]
}

// Apenas as campanhas em que o agente participa (campaign_agents)
export async function getCampaignsForAgent(agentId: string): Promise<Campaign[]> {
  const supabase = await createServerClient()
  const { data: links } = await supabase
    .from('campaign_agents')
    .select('campaign_id')
    .eq('agent_id', agentId)

  const ids = (links ?? []).map((l) => l.campaign_id as string)
  if (ids.length === 0) return []

  const { data } = await supabase
    .from('campaigns')
    .select('*')
    .in('id', ids)
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

export async function updateCampaignStatus(
  id: string,
  status: CampaignStatus
): Promise<{ error?: string }> {
  const supabase = await createServerClient()
  const { error } = await supabase
    .from('campaigns')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error: error.message }
  return {}
}

type SupabaseClient = Awaited<ReturnType<typeof createServerClient>>

async function findPending(supabase: SupabaseClient, campaignId: string) {
  const { data } = await supabase
    .from('campaign_contacts')
    .select('id, attempts')
    .eq('campaign_id', campaignId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .single()
  return data as { id: string; attempts: number } | null
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
  const { data: claimed } = await supabase
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

  return claimed as CampaignContact | null
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
  }
): Promise<{ error?: string }> {
  const supabase = await createServerClient()
  const { error } = await supabase
    .from('campaigns')
    .update({
      department_id: config.department_id,
      schedule_start: config.schedule_start,
      schedule_end: config.schedule_end,
      visible_fields: config.visible_fields,
      notify_dispositions: config.notify_dispositions,
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
}> {
  const supabase = await createServerClient()
  const { data } = await supabase
    .from('campaign_contacts')
    .select('status')
    .eq('campaign_id', campaignId)

  const stats = {
    total: 0,
    pending: 0,
    dialing: 0,
    answered: 0,
    no_answer: 0,
    busy: 0,
    failed: 0,
    do_not_call: 0,
  }

  for (const row of data ?? []) {
    stats.total++
    const s = row.status as keyof typeof stats
    if (s in stats) stats[s]++
  }

  return stats
}
