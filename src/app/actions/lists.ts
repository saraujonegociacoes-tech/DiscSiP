'use server'

import { createServerClient } from '@/lib/supabase/server'
import type { ColumnMapping, ContactStatus, List } from '@/lib/types/database'

export async function getLists(campaignId: string): Promise<List[]> {
  const supabase = createServerClient()
  const { data } = await supabase
    .from('lists')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
  return (data ?? []) as List[]
}

// Mapa chave → rótulo dos campos extras das listas (para o dialer exibir os extra_data)
export async function getListFieldLabels(campaignId: string): Promise<Record<string, string>> {
  const supabase = createServerClient()
  const { data } = await supabase
    .from('lists')
    .select('column_mapping')
    .eq('campaign_id', campaignId)

  const labels: Record<string, string> = {}
  for (const row of data ?? []) {
    const cm = row.column_mapping as ColumnMapping | null
    for (const ex of cm?.extras ?? []) labels[ex.key] = ex.label
  }
  return labels
}

interface ListConfig {
  name: string
  column_mapping: ColumnMapping
  recycle_enabled: boolean
  recycle_statuses: ContactStatus[]
  recycle_after_hours: number
  recycle_max_attempts: number
}

interface IncomingContact {
  phone_number: string
  name: string | null
  extra_data: Record<string, string>
}

export interface CreateListResult {
  listId?: string
  inserted: number
  duplicates: number
  error?: string
}

// Cria a lista e insere os contatos já normalizados pelo cliente.
// Duplicados (mesmo telefone já presente na campanha) são ignorados.
export async function createList(
  campaignId: string,
  config: ListConfig,
  contacts: IncomingContact[]
): Promise<CreateListResult> {
  const supabase = createServerClient()

  const { data: list, error: listError } = await supabase
    .from('lists')
    .insert({
      campaign_id: campaignId,
      name: config.name,
      column_mapping: config.column_mapping,
      recycle_enabled: config.recycle_enabled,
      recycle_statuses: config.recycle_statuses,
      recycle_after_hours: config.recycle_after_hours,
      recycle_max_attempts: config.recycle_max_attempts,
    })
    .select('id')
    .single()

  if (listError || !list) {
    return { inserted: 0, duplicates: 0, error: listError?.message ?? 'Falha ao criar lista' }
  }

  // Telefones já existentes na campanha (dedup em nível de campanha)
  const { data: existing } = await supabase
    .from('campaign_contacts')
    .select('phone_number')
    .eq('campaign_id', campaignId)

  const seen = new Set((existing ?? []).map((c) => c.phone_number as string))

  const toInsert: Array<{
    campaign_id: string
    list_id: string
    phone_number: string
    name: string | null
    extra_data: Record<string, string>
    status: ContactStatus
  }> = []
  let duplicates = 0

  for (const c of contacts) {
    if (seen.has(c.phone_number)) {
      duplicates++
      continue
    }
    seen.add(c.phone_number) // evita duplicados dentro do próprio arquivo
    toInsert.push({
      campaign_id: campaignId,
      list_id: list.id,
      phone_number: c.phone_number,
      name: c.name,
      extra_data: c.extra_data,
      status: 'pending',
    })
  }

  // Insere em lotes para não estourar limites de payload
  const CHUNK = 500
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const { error } = await supabase
      .from('campaign_contacts')
      .insert(toInsert.slice(i, i + CHUNK))
    if (error) {
      return {
        listId: list.id,
        inserted: i,
        duplicates,
        error: error.message,
      }
    }
  }

  return { listId: list.id, inserted: toInsert.length, duplicates }
}

export async function deleteList(listId: string): Promise<{ error?: string }> {
  const supabase = createServerClient()
  // Remove os contatos da lista e depois a lista
  await supabase.from('campaign_contacts').delete().eq('list_id', listId)
  const { error } = await supabase.from('lists').delete().eq('id', listId)
  if (error) return { error: error.message }
  return {}
}
