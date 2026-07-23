'use server'

import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { runWarmupTick, type TickSummary } from '@/lib/warmup/tick'
import type {
  WarmupNumber,
  WarmupSettings,
  WarmupTemplate,
  WarmupMessage,
  WarmupNumberStats,
  WarmupRampStage,
} from '@/lib/types/database'

const DAY_MS = 86_400_000

// Acesso ao módulo de aquecimento: supervisor, manager e admin (agente não).
async function canAccessWarmup(): Promise<boolean> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return false
  const { data } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return data?.role === 'supervisor' || data?.role === 'manager' || data?.role === 'admin'
}

// ── Configuração: números do pool ───────────────────────────────────────────

export async function getWarmupNumbers(): Promise<WarmupNumber[]> {
  const supabase = await createServerClient()
  const { data } = await supabase
    .from('warmup_numbers')
    .select('*')
    .order('added_at', { ascending: true })
  return (data ?? []) as WarmupNumber[]
}

export async function upsertWarmupNumber(
  input: Pick<WarmupNumber, 'sender_id' | 'phone_number'> &
    Partial<Pick<WarmupNumber, 'id' | 'display_name' | 'waba_id' | 'status' | 'participating' | 'quality_rating' | 'notes'>>
): Promise<{ error?: string }> {
  const supabase = await createServerClient()
  const row = {
    sender_id: input.sender_id.trim(),
    phone_number: input.phone_number.trim(),
    display_name: input.display_name ?? null,
    waba_id: input.waba_id ?? null,
    ...(input.status && { status: input.status }),
    ...(input.participating !== undefined && { participating: input.participating }),
    ...(input.quality_rating !== undefined && { quality_rating: input.quality_rating }),
    ...(input.notes !== undefined && { notes: input.notes }),
    updated_at: new Date().toISOString(),
  }
  const { error } = input.id
    ? await supabase.from('warmup_numbers').update(row).eq('id', input.id)
    : await supabase.from('warmup_numbers').insert(row)
  if (error) return { error: error.message }
  return {}
}

export async function deleteWarmupNumber(id: string): Promise<{ error?: string }> {
  const supabase = await createServerClient()
  const { error } = await supabase.from('warmup_numbers').delete().eq('id', id)
  if (error) return { error: error.message }
  return {}
}

// ── Configuração: settings (key/value) ──────────────────────────────────────

export async function getWarmupSettings(): Promise<WarmupSettings> {
  const supabase = await createServerClient()
  const { data } = await supabase.from('warmup_settings').select('key, value')
  const raw = Object.fromEntries((data ?? []).map((r) => [r.key as string, r.value]))
  const num = (k: string, d: number) => (typeof raw[k] === 'number' ? (raw[k] as number) : d)
  return {
    qntd_numbers: num('qntd_numbers', 6),
    max_numbers_cap: num('max_numbers_cap', 6),
    dry_run: raw['dry_run'] === true,
    tick_max_sends: num('tick_max_sends', 3),
    min_gap_minutes: num('min_gap_minutes', 4),
    max_gap_minutes: num('max_gap_minutes', 25),
    warmup_mode: raw['warmup_mode'] === 'gradual' ? 'gradual' : 'sessao',
    sessao_duracao_horas: num('sessao_duracao_horas', 24),
    sessao_msgs_por_numero: num('sessao_msgs_por_numero', 30),
    sessao_conversas_por_numero: num('sessao_conversas_por_numero', 3),
    sessao_iniciada_em: typeof raw['sessao_iniciada_em'] === 'string' ? (raw['sessao_iniciada_em'] as string) : null,
  }
}

// Atualiza um subconjunto das settings. max_numbers_cap não é editável aqui
// (teto duro, só muda por migração/decisão manual). qntd_numbers é clampado ao teto.
export async function updateWarmupSettings(
  patch: Partial<
    Pick<
      WarmupSettings,
      | 'qntd_numbers'
      | 'dry_run'
      | 'tick_max_sends'
      | 'min_gap_minutes'
      | 'max_gap_minutes'
      | 'warmup_mode'
      | 'sessao_duracao_horas'
      | 'sessao_msgs_por_numero'
      | 'sessao_conversas_por_numero'
    >
  >
): Promise<{ error?: string }> {
  const supabase = await createServerClient()
  const current = await getWarmupSettings()

  const next: Record<string, number | boolean | string> = {}
  if (patch.qntd_numbers !== undefined)
    next.qntd_numbers = Math.min(current.max_numbers_cap, Math.max(1, Math.round(patch.qntd_numbers)))
  if (patch.dry_run !== undefined) next.dry_run = patch.dry_run
  if (patch.tick_max_sends !== undefined) next.tick_max_sends = Math.max(1, Math.round(patch.tick_max_sends))
  if (patch.min_gap_minutes !== undefined) next.min_gap_minutes = Math.max(0, Math.round(patch.min_gap_minutes))
  if (patch.max_gap_minutes !== undefined) next.max_gap_minutes = Math.max(0, Math.round(patch.max_gap_minutes))
  if (patch.warmup_mode !== undefined) next.warmup_mode = patch.warmup_mode === 'gradual' ? 'gradual' : 'sessao'
  if (patch.sessao_duracao_horas !== undefined)
    next.sessao_duracao_horas = Math.max(1, Math.round(patch.sessao_duracao_horas))
  if (patch.sessao_msgs_por_numero !== undefined)
    next.sessao_msgs_por_numero = Math.max(1, Math.round(patch.sessao_msgs_por_numero))
  if (patch.sessao_conversas_por_numero !== undefined)
    next.sessao_conversas_por_numero = Math.max(1, Math.round(patch.sessao_conversas_por_numero))

  const rows = Object.entries(next).map(([key, value]) => ({
    key,
    value: value as unknown as WarmupSettings[keyof WarmupSettings],
    updated_at: new Date().toISOString(),
  }))
  if (rows.length === 0) return {}
  const { error } = await supabase.from('warmup_settings').upsert(rows, { onConflict: 'key' })
  if (error) return { error: error.message }
  return {}
}

// Inicia/encerra a sessão de aquecimento (modo 'sessao'). Iniciar grava o
// timestamp de partida; o tick só age enquanto now < inicio + duração. Encerrar
// limpa o timestamp (o tick para de agir imediatamente).
export async function startWarmupSession(): Promise<{ error?: string }> {
  const supabase = await createServerClient()
  const { error } = await supabase
    .from('warmup_settings')
    .upsert(
      { key: 'sessao_iniciada_em', value: new Date().toISOString() as unknown as WarmupSettings[keyof WarmupSettings], updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    )
  if (error) return { error: error.message }
  return {}
}

export async function stopWarmupSession(): Promise<{ error?: string }> {
  const supabase = await createServerClient()
  const { error } = await supabase
    .from('warmup_settings')
    .upsert(
      { key: 'sessao_iniciada_em', value: null as unknown as WarmupSettings[keyof WarmupSettings], updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    )
  if (error) return { error: error.message }
  return {}
}

// ── Configuração: templates / snippets ──────────────────────────────────────

export async function getWarmupTemplates(): Promise<WarmupTemplate[]> {
  const supabase = await createServerClient()
  const { data } = await supabase
    .from('warmup_templates')
    .select('*')
    .order('created_at', { ascending: true })
  return (data ?? []) as WarmupTemplate[]
}

export async function upsertWarmupTemplate(
  input: Pick<WarmupTemplate, 'kind' | 'body'> &
    Partial<Pick<WarmupTemplate, 'id' | 'meta_template_name' | 'meta_template_language' | 'active'>>
): Promise<{ error?: string }> {
  if (input.kind === 'template' && !input.meta_template_name?.trim()) {
    return { error: 'Template de abertura exige o nome aprovado na Meta.' }
  }
  const supabase = await createServerClient()
  const row = {
    kind: input.kind,
    body: input.body.trim(),
    meta_template_name: input.kind === 'template' ? (input.meta_template_name?.trim() ?? null) : null,
    meta_template_language:
      input.kind === 'template' ? (input.meta_template_language?.trim() || 'pt_BR') : null,
    ...(input.active !== undefined && { active: input.active }),
  }
  const { error } = input.id
    ? await supabase.from('warmup_templates').update(row).eq('id', input.id)
    : await supabase.from('warmup_templates').insert(row)
  if (error) return { error: error.message }
  return {}
}

export async function deleteWarmupTemplate(id: string): Promise<{ error?: string }> {
  const supabase = await createServerClient()
  const { error } = await supabase.from('warmup_templates').delete().eq('id', id)
  if (error) return { error: error.message }
  return {}
}

// ── Histórico e estatísticas ────────────────────────────────────────────────

const HISTORY_PAGE_SIZE = 50

export async function getWarmupHistory(
  page = 0
): Promise<{ rows: WarmupMessage[]; hasMore: boolean }> {
  const supabase = await createServerClient()
  const from = page * HISTORY_PAGE_SIZE
  const { data } = await supabase
    .from('warmup_messages')
    .select('*')
    .order('sent_at', { ascending: false })
    .range(from, from + HISTORY_PAGE_SIZE)
  const rows = (data ?? []) as WarmupMessage[]
  const hasMore = rows.length > HISTORY_PAGE_SIZE
  return { rows: hasMore ? rows.slice(0, HISTORY_PAGE_SIZE) : rows, hasMore }
}

export async function getWarmupStats(): Promise<Record<string, WarmupNumberStats>> {
  const supabase = await createServerClient()
  const now = Date.now()
  const startOfTodayIso = new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z'

  const [{ data: numbers }, { data: stages }, { data: msgs }] = await Promise.all([
    supabase.from('warmup_numbers').select('id, added_at'),
    supabase.from('warmup_ramp_stages').select('*').order('day_from', { ascending: true }),
    supabase.from('warmup_messages').select('from_number_id, dispatch_mode, sent_at'),
  ])

  const rampStages = (stages ?? []) as WarmupRampStage[]
  const out: Record<string, WarmupNumberStats> = {}

  for (const n of numbers ?? []) {
    const id = n.id as string
    const daysWarming = Math.floor((now - new Date(n.added_at as string).getTime()) / DAY_MS)
    const stage = rampStages.find(
      (s) => daysWarming >= s.day_from && (s.day_to === null || daysWarming <= s.day_to)
    )
    out[id] = {
      numberId: id,
      daysWarming,
      sentTotal: 0,
      sentLive: 0,
      sentDryRun: 0,
      sentToday: 0,
      dailyCap: stage?.daily_message_cap ?? 0,
    }
  }

  const todayStart = new Date(startOfTodayIso).getTime()
  for (const m of msgs ?? []) {
    const id = m.from_number_id as string
    const s = out[id]
    if (!s) continue
    s.sentTotal++
    if (m.dispatch_mode === 'live') s.sentLive++
    else s.sentDryRun++
    if (new Date(m.sent_at as string).getTime() >= todayStart) s.sentToday++
  }

  return out
}

// ── Tick manual (botão "rodar tick agora") ──────────────────────────────────
// Roda a mesma orquestração do cron. Usa service_role (a escrita nas tabelas de
// execução não passa pela RLS de usuário), mas só depois de confirmar que o
// chamador é manager/admin — a action é reachable por qualquer sessão.
export async function runWarmupTickManually(): Promise<TickSummary | { error: string }> {
  if (!(await canAccessWarmup())) return { error: 'Sem permissão.' }
  const service = createServiceClient()
  return runWarmupTick(service)
}
