'use server'

import { createServerClient } from '@/lib/supabase/server'
import { fetchAllRows } from '@/lib/supabase/paginate'
import type { ColumnMapping, ContactStatus, List } from '@/lib/types/database'

export async function getLists(campaignId: string): Promise<List[]> {
  const supabase = await createServerClient()
  const { data } = await supabase
    .from('lists')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
  return (data ?? []) as List[]
}

// Mapa chave → rótulo dos campos extras das listas (para o dialer exibir os extra_data)
export async function getListFieldLabels(campaignId: string): Promise<Record<string, string>> {
  const supabase = await createServerClient()
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

// Traduz o erro cru do Postgres para algo acionável. O caso que mais custou tempo foi a RLS:
// "new row violates row-level security policy" não diz que o problema é o PAPEL do usuário, e
// a tela dá a entender que o arquivo está errado. Ver
// supabase/migrations/Migrations_rbac/20260807_tester_rls_effective_role.sql.
function explainError(error: { message: string } | null, acao: string): string {
  const msg = error?.message ?? `Falha ao ${acao}`
  if (/row-level security/i.test(msg)) {
    return `Sem permissão para ${acao}. Seu usuário precisa ser admin/gerente, ou supervisor do mesmo departamento da campanha — confira também se a campanha tem departamento definido.`
  }
  return msg
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
  const supabase = await createServerClient()

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
    return { inserted: 0, duplicates: 0, error: explainError(listError, 'criar a lista') }
  }

  // Telefones já existentes na campanha (dedup em nível de campanha). Paginado: sem isto o
  // PostgREST cortava em "Max Rows" (1000) e uma campanha maior deixava passar duplicados.
  // Ordena por id (PK) para a paginação ser determinística.
  const existing = await fetchAllRows<{ phone_number: string }>(
    (from, to) =>
      supabase
        .from('campaign_contacts')
        .select('phone_number')
        .eq('campaign_id', campaignId)
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: { phone_number: string }[] | null }>
  )

  const seen = new Set(existing.map((c) => c.phone_number))

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
        error: explainError(error, 'inserir os contatos'),
      }
    }
  }

  return { listId: list.id, inserted: toInsert.length, duplicates }
}

// Reciclagem de uma lista JÁ CRIADA. Sem isto, a única forma de mudar a regra de reciclagem
// era apagar a lista e reimportar o mailing — inviável com campanha em produção. Virou
// necessário quando a discadora passou a tabular sozinha como 'abandoned' (corte de toque):
// listas antigas não têm esse status em recycle_statuses e os contatos ficariam parados.
export async function updateListRecycle(
  listId: string,
  config: {
    recycle_enabled: boolean
    recycle_statuses: ContactStatus[]
    recycle_after_hours: number
    recycle_max_attempts: number
  }
): Promise<{ error?: string }> {
  const supabase = await createServerClient()
  const { error } = await supabase
    .from('lists')
    .update({
      recycle_enabled: config.recycle_enabled,
      recycle_statuses: config.recycle_enabled ? config.recycle_statuses : [],
      recycle_after_hours: Math.max(1, Math.round(config.recycle_after_hours)),
      recycle_max_attempts: Math.max(1, Math.round(config.recycle_max_attempts)),
    })
    .eq('id', listId)
  if (error) return { error: error.message }
  return {}
}

export async function deleteList(listId: string): Promise<{ error?: string }> {
  const supabase = await createServerClient()
  // Remove os contatos da lista e depois a lista
  await supabase.from('campaign_contacts').delete().eq('list_id', listId)
  const { error } = await supabase.from('lists').delete().eq('id', listId)
  if (error) return { error: error.message }
  return {}
}
