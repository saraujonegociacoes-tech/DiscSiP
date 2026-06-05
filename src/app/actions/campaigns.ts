'use server'

import { createServerClient } from '@/lib/supabase/server'
import type { Campaign, CampaignContact, CampaignStatus, ContactStatus } from '@/lib/types/database'

export async function getCampaigns(): Promise<Campaign[]> {
  const supabase = createServerClient()
  const { data } = await supabase
    .from('campaigns')
    .select('*')
    .order('created_at', { ascending: false })
  return (data ?? []) as Campaign[]
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  const supabase = createServerClient()
  const { data } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', id)
    .single()
  return data as Campaign | null
}

export async function createCampaign(
  name: string
): Promise<Campaign | { error: string }> {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('campaigns')
    .insert({ name })
    .select()
    .single()
  if (error) return { error: error.message }
  return data as Campaign
}

export async function updateCampaignStatus(
  id: string,
  status: CampaignStatus
): Promise<{ error?: string }> {
  const supabase = createServerClient()
  const { error } = await supabase
    .from('campaigns')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error: error.message }
  return {}
}

// Aceita linhas no formato "Número" ou "Nome,Número"
export async function addContactsToCampaign(
  campaignId: string,
  lines: string[]
): Promise<{ added: number; error?: string }> {
  const contacts = lines
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(',').map((p) => p.trim())
      if (parts.length >= 2) {
        return { campaign_id: campaignId, name: parts[0], phone_number: parts[1] }
      }
      return { campaign_id: campaignId, phone_number: parts[0], name: null }
    })

  if (contacts.length === 0) return { added: 0 }

  const supabase = createServerClient()
  const { error } = await supabase.from('campaign_contacts').insert(contacts)
  if (error) return { added: 0, error: error.message }
  return { added: contacts.length }
}

// Busca o próximo contato pendente e marca atomicamente como 'dialing'
export async function getNextContact(
  campaignId: string,
  agentId: string
): Promise<CampaignContact | null> {
  const supabase = createServerClient()

  const { data: pending } = await supabase
    .from('campaign_contacts')
    .select('id')
    .eq('campaign_id', campaignId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .single()

  if (!pending) return null

  // Claim atômico: só atualiza se ainda estiver 'pending' (evita race condition entre agentes)
  const { data: claimed } = await supabase
    .from('campaign_contacts')
    .update({
      status: 'dialing',
      assigned_agent_id: agentId,
      dialed_at: new Date().toISOString(),
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
  const supabase = createServerClient()
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
  const supabase = createServerClient()
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
