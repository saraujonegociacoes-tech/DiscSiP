import type { SupabaseClient } from '@supabase/supabase-js'
import {
  sendWarmupNotification,
  type WarmupMessagePayload,
} from '@/app/actions/warmup-notifications'
import type {
  WarmupNumber,
  WarmupSettings,
  WarmupRampStage,
  WarmupTemplate,
  WarmupConversation,
} from '@/lib/types/database'

// Orquestração do aquecimento — decide, a cada "tick", quais números trocam
// mensagem agora, respeitando pacing humano (gap aleatório por número, teto de
// envios por tick, rampa de volume por dias aquecendo) e a regra da janela de
// 24h (template para abrir conversa fria, texto livre dentro da janela).
//
// Recebe um client service_role (bypassa RLS): escreve em warmup_conversations/
// warmup_messages, que não têm policy de escrita para authenticated. NÃO é um
// módulo 'use server' de propósito — é chamado tanto pelo endpoint do cron
// quanto pela server action do botão "rodar tick agora".

const DAY_MS = 86_400_000
const MINUTE_MS = 60_000

export interface TickSummary {
  sent: number
  dryRun: boolean
  opened: number
  continued: number
  eligible: number
  selected: number
  skipped: string[]
}

type Client = SupabaseClient

// uuid do gen_random_uuid vem lowercase; comparação de string bate com o `<` de
// uuid do Postgres (usado no CHECK number_a_id < number_b_id).
function normalizePair(id1: string, id2: string): [string, string] {
  return id1 < id2 ? [id1, id2] : [id2, id1]
}

function pairKey(id1: string, id2: string): string {
  const [a, b] = normalizePair(id1, id2)
  return `${a}:${b}`
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function pick<T>(arr: T[]): T | null {
  return arr.length === 0 ? null : arr[Math.floor(Math.random() * arr.length)]
}

async function readSettings(supabase: Client): Promise<WarmupSettings> {
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

function stageFor(stages: WarmupRampStage[], daysWarming: number): WarmupRampStage | null {
  return (
    stages.find(
      (s) => daysWarming >= s.day_from && (s.day_to === null || daysWarming <= s.day_to)
    ) ?? null
  )
}

interface NumberState {
  number: WarmupNumber
  dailyCap: number
  newConvoCap: number
  sentToday: number
  newConvosToday: number
  lastSentTodayAt: number | null // epoch ms do último envio HOJE (para o gap)
  recentContent: Set<string>
}

interface QueuedSend {
  from: WarmupNumber
  to: WarmupNumber
  type: 'template' | 'session'
  template: WarmupTemplate
  conversationId: string | null // null = criar nova conversa (template)
}

export async function runWarmupTick(supabase: Client): Promise<TickSummary> {
  const now = Date.now()
  const startOfTodayIso = new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z'
  const skipped: string[] = []

  const settings = await readSettings(supabase)
  const maxSends = Math.max(1, settings.tick_max_sends)

  // ── Modo de operação ──────────────────────────────────────────────────────
  // 'sessao': aquecimento intensivo num período fixo (ex.: 24h). O tick só age
  //   enquanto a sessão está dentro da duração; o volume por número é contado
  //   desde o INÍCIO da sessão (não por dia). Fora da janela, encerra cedo.
  // 'gradual': rampa multi-dia (warmup_ramp_stages), volume contado por dia.
  const sessionMode = settings.warmup_mode === 'sessao'
  // Início do "período" de contagem de volume: a sessão (modo sessao) ou o começo
  // do dia (modo gradual).
  let periodStartIso = startOfTodayIso
  if (sessionMode) {
    if (!settings.sessao_iniciada_em) {
      return { sent: 0, dryRun: settings.dry_run, opened: 0, continued: 0, eligible: 0, selected: 0, skipped: ['sessão de aquecimento não iniciada'] }
    }
    const endsAt = new Date(settings.sessao_iniciada_em).getTime() + settings.sessao_duracao_horas * 60 * MINUTE_MS
    if (now >= endsAt) {
      return { sent: 0, dryRun: settings.dry_run, opened: 0, continued: 0, eligible: 0, selected: 0, skipped: ['sessão de aquecimento encerrada (duração atingida)'] }
    }
    periodStartIso = settings.sessao_iniciada_em
  }

  // Pool participante, limitado por qntd_numbers (nunca acima do teto).
  const cap = Math.min(settings.qntd_numbers, settings.max_numbers_cap)
  const { data: numbersData } = await supabase
    .from('warmup_numbers')
    .select('*')
    .eq('status', 'active')
    .eq('participating', true)
    .order('added_at', { ascending: true })
    .limit(Math.max(0, cap))
  const numbers = (numbersData ?? []) as WarmupNumber[]

  if (numbers.length < 2) {
    return { sent: 0, dryRun: settings.dry_run, opened: 0, continued: 0, eligible: 0, selected: numbers.length, skipped: ['pool < 2 números elegíveis'] }
  }

  const numberIds = numbers.map((n) => n.id)
  const numberById = new Map(numbers.map((n) => [n.id, n]))

  const [{ data: stagesData }, { data: templatesData }, { data: todayMsgs }, { data: convosData }] =
    await Promise.all([
      supabase.from('warmup_ramp_stages').select('*').order('day_from', { ascending: true }),
      supabase.from('warmup_templates').select('*').eq('active', true),
      supabase
        .from('warmup_messages')
        .select('from_number_id, content, sent_at')
        .in('from_number_id', numberIds)
        .gte('sent_at', periodStartIso),
      supabase
        .from('warmup_conversations')
        .select('*')
        .in('status', ['active', 'idle'])
        .in('number_a_id', numberIds),
    ])

  const stages = (stagesData ?? []) as WarmupRampStage[]
  const templates = (templatesData ?? []) as WarmupTemplate[]
  const openers = templates.filter((t) => t.kind === 'template' && t.meta_template_name)
  const snippets = templates.filter((t) => t.kind === 'session_snippet')

  // Conta hoje: envios por número e novas conversas abertas por número.
  const sentTodayBy = new Map<string, number>()
  const lastSentTodayBy = new Map<string, number>()
  const recentContentBy = new Map<string, Set<string>>()
  for (const m of todayMsgs ?? []) {
    const id = m.from_number_id as string
    sentTodayBy.set(id, (sentTodayBy.get(id) ?? 0) + 1)
    const t = new Date(m.sent_at as string).getTime()
    lastSentTodayBy.set(id, Math.max(lastSentTodayBy.get(id) ?? 0, t))
    if (m.content) {
      if (!recentContentBy.has(id)) recentContentBy.set(id, new Set())
      recentContentBy.get(id)!.add(m.content as string)
    }
  }

  const periodStartMs = new Date(periodStartIso).getTime()
  const newConvosTodayBy = new Map<string, number>()
  for (const c of (convosData ?? []) as WarmupConversation[]) {
    if (new Date(c.opened_at).getTime() >= periodStartMs) {
      newConvosTodayBy.set(c.opener_number_id, (newConvosTodayBy.get(c.opener_number_id) ?? 0) + 1)
    }
  }

  // Estado por número + elegibilidade (headroom diário + gap aleatório).
  const state = new Map<string, NumberState>()
  const eligible = new Set<string>()
  for (const n of numbers) {
    const daysWarming = Math.floor((now - new Date(n.added_at).getTime()) / DAY_MS)
    const stage = stageFor(stages, daysWarming)
    // Modo sessao: cap fixo por número no período todo. Modo gradual: cap do dia
    // conforme a faixa da rampa (dias aquecendo).
    const dailyCap = sessionMode ? settings.sessao_msgs_por_numero : (stage?.daily_message_cap ?? 0)
    const newConvoCap = sessionMode
      ? settings.sessao_conversas_por_numero
      : (stage?.new_conversations_per_day_cap ?? 0)
    const sentToday = sentTodayBy.get(n.id) ?? 0
    const lastSent = lastSentTodayBy.get(n.id) ?? null
    state.set(n.id, {
      number: n,
      dailyCap,
      newConvoCap,
      sentToday,
      newConvosToday: newConvosTodayBy.get(n.id) ?? 0,
      lastSentTodayAt: lastSent,
      recentContent: recentContentBy.get(n.id) ?? new Set(),
    })

    const hasHeadroom = sentToday < dailyCap
    const gapMin =
      settings.min_gap_minutes +
      Math.random() * Math.max(0, settings.max_gap_minutes - settings.min_gap_minutes)
    const gapOk = lastSent === null || now - lastSent >= gapMin * MINUTE_MS
    if (hasHeadroom && gapOk) eligible.add(n.id)
  }

  const queue: QueuedSend[] = []
  let continued = 0
  let opened = 0

  const consume = (id: string) => {
    eligible.delete(id)
    const st = state.get(id)
    if (st) st.sentToday += 1
  }

  const chooseSnippet = (fromId: string): WarmupTemplate | null => {
    const recent = state.get(fromId)?.recentContent ?? new Set<string>()
    const fresh = snippets.filter((s) => !recent.has(s.body))
    return pick(fresh.length > 0 ? fresh : snippets)
  }

  // ── Prioridade 1: continuar conversas ativas (é a vez de quem NÃO mandou a
  // última). Sempre 'session' — a janela está aberta pois o outro lado acabou de
  // falar. Conversa parada > 24h vira 'idle' e será reaberta com template. ──
  const activeConvos = ((convosData ?? []) as WarmupConversation[])
    .filter((c) => c.status === 'active')
    .sort((a, b) => new Date(a.last_message_at).getTime() - new Date(b.last_message_at).getTime())

  for (const convo of activeConvos) {
    if (queue.length >= maxSends) break
    if (snippets.length === 0) {
      skipped.push('sem session_snippet ativo para continuar conversas')
      break
    }
    if (now - new Date(convo.last_message_at).getTime() > DAY_MS) {
      await supabase.from('warmup_conversations').update({ status: 'idle' }).eq('id', convo.id)
      continue
    }
    const lastSender = convo.last_sender_id
    if (!lastSender) continue
    const responderId = lastSender === convo.number_a_id ? convo.number_b_id : convo.number_a_id
    const responder = numberById.get(responderId)
    const target = numberById.get(lastSender)
    if (!responder || !target) continue
    if (!eligible.has(responderId)) continue

    const snippet = chooseSnippet(responderId)
    if (!snippet) continue
    queue.push({ from: responder, to: target, type: 'session', template: snippet, conversationId: convo.id })
    consume(responderId)
    continued++
  }

  // ── Prioridade 2: abrir novas conversas com o que sobrou do teto do tick. ──
  // Só bloqueia pares com conversa ATIVA (evita 2 threads simultâneas). Pares
  // cuja última thread virou idle podem ser reabertos com um novo template — a
  // janela de 24h fechou, então template é o correto.
  const existingPairs = new Set(
    ((convosData ?? []) as WarmupConversation[])
      .filter((c) => c.status === 'active')
      .map((c) => pairKey(c.number_a_id, c.number_b_id))
  )

  if (queue.length < maxSends && openers.length > 0) {
    const openable = shuffle(
      [...eligible].filter((id) => {
        const st = state.get(id)!
        return st.newConvosToday < st.newConvoCap
      })
    )
    for (let i = 0; i + 1 < openable.length && queue.length < maxSends; i += 2) {
      const aId = openable[i]
      const bId = openable[i + 1]
      if (!eligible.has(aId) || !eligible.has(bId)) continue
      if (existingPairs.has(pairKey(aId, bId))) continue

      const openerId = Math.random() < 0.5 ? aId : bId
      const otherId = openerId === aId ? bId : aId
      const opener = numberById.get(openerId)!
      const other = numberById.get(otherId)!
      const template = pick(openers)
      if (!template) break

      const [na, nb] = normalizePair(openerId, otherId)
      const { data: created } = await supabase
        .from('warmup_conversations')
        .insert({
          number_a_id: na,
          number_b_id: nb,
          opener_number_id: openerId,
          last_sender_id: openerId,
          last_message_at: new Date(now).toISOString(),
        })
        .select('id')
        .single()
      if (!created) continue

      existingPairs.add(pairKey(aId, bId))
      const st = state.get(openerId)!
      st.newConvosToday += 1
      queue.push({ from: opener, to: other, type: 'template', template, conversationId: created.id as string })
      consume(openerId)
      opened++
    }
  } else if (openers.length === 0) {
    skipped.push('sem template ativo para abrir novas conversas')
  }

  // ── Executar a fila: grava histórico, atualiza a conversa e dispara o Make. ──
  let sent = 0
  for (const item of queue) {
    const { data: msg } = await supabase
      .from('warmup_messages')
      .insert({
        conversation_id: item.conversationId,
        from_number_id: item.from.id,
        to_number_id: item.to.id,
        message_type: item.type,
        template_id: item.template.id,
        content: item.template.body,
        dispatch_mode: settings.dry_run ? 'dry_run' : 'live',
      })
      .select('id')
      .single()
    if (!msg) continue

    if (item.conversationId) {
      // Incrementa message_count lendo o valor atual (sem RPC dedicado).
      const { data: conv } = await supabase
        .from('warmup_conversations')
        .select('message_count')
        .eq('id', item.conversationId)
        .single()
      await supabase
        .from('warmup_conversations')
        .update({
          last_message_at: new Date(now).toISOString(),
          last_sender_id: item.from.id,
          message_count: (conv?.message_count ?? 0) + 1,
          status: 'active',
        })
        .eq('id', item.conversationId)
    }

    const payload: WarmupMessagePayload = {
      message_log_id: msg.id as string,
      conversation_id: item.conversationId,
      message_type: item.type,
      sender: {
        sender_id: item.from.sender_id,
        waba_id: item.from.waba_id,
        phone_number: item.from.phone_number,
      },
      receiver: { receiver_number: item.to.phone_number },
      template:
        item.type === 'template'
          ? {
              name: item.template.meta_template_name!,
              language: item.template.meta_template_language ?? 'pt_BR',
            }
          : null,
      session_text: item.type === 'session' ? item.template.body : null,
      dry_run: settings.dry_run,
      occurred_at: new Date(now).toISOString(),
    }

    const result = await sendWarmupNotification(payload)
    // Sucesso real chega pelo callback; marca falha imediata (rede/URL ausente).
    if (!settings.dry_run && !result.ok) {
      await supabase
        .from('warmup_messages')
        .update({ make_dispatch_ok: false, error_detail: 'falha ao disparar webhook do Make' })
        .eq('id', msg.id)
    }
    sent++
  }

  // ── Housekeeping: conversas ativas paradas > 24h viram idle. ──
  const staleIso = new Date(now - DAY_MS).toISOString()
  await supabase
    .from('warmup_conversations')
    .update({ status: 'idle' })
    .eq('status', 'active')
    .lt('last_message_at', staleIso)

  return {
    sent,
    dryRun: settings.dry_run,
    opened,
    continued,
    eligible: eligible.size + queue.length, // aproximação: elegíveis antes de consumir
    selected: numbers.length,
    skipped,
  }
}
