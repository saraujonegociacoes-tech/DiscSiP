'use server'

import { createServerClient } from '@/lib/supabase/server'
import { hourInBRT, brtTodayStartUtcISO } from '@/lib/timezone'
import { DISPOSITIONS } from '@/lib/dispositions'

// Desempenho do PRÓPRIO agente (hoje). O agente é sempre derivado da sessão (auth.getUser),
// nunca de um id vindo do cliente — assim um agente não consegue ler os números de outro.
export interface MyPerformance {
  callsToday: number
  answeredToday: number
  talkSecondsToday: number
  byDisposition: { value: string; label: string; count: number }[]
  callsByHour: { hour: string; calls: number }[]
}

const EMPTY: MyPerformance = {
  callsToday: 0,
  answeredToday: 0,
  talkSecondsToday: 0,
  byDisposition: DISPOSITIONS.map((d) => ({ value: d.value, label: d.label, count: 0 })),
  callsByHour: [],
}

export async function getMyPerformance(): Promise<MyPerformance> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return EMPTY

  const { data } = await supabase
    .from('call_logs')
    .select('status, disposition, duration_seconds, created_at')
    .eq('agent_id', user.id)
    .gte('created_at', brtTodayStartUtcISO())

  const rows = (data ?? []) as {
    status: string
    disposition: string | null
    duration_seconds: number | null
    created_at: string
  }[]

  const callsToday = rows.length
  const answeredToday = rows.filter((r) => r.status === 'answered').length
  const talkSecondsToday = rows.reduce((sum, r) => sum + (r.duration_seconds ?? 0), 0)

  // Contagem por disposição tabulada (mantém a ordem de DISPOSITIONS; ignora logs sem tabulação)
  const counts: Record<string, number> = {}
  for (const r of rows) {
    if (r.disposition) counts[r.disposition] = (counts[r.disposition] ?? 0) + 1
  }
  const byDisposition = DISPOSITIONS.map((d) => ({
    value: d.value,
    label: d.label,
    count: counts[d.value] ?? 0,
  }))

  // Chamadas por hora (fuso de Brasília), de 00h até a hora atual — mesmo formato do CallsChart
  const buckets: Record<number, number> = {}
  for (let h = 0; h < 24; h++) buckets[h] = 0
  for (const r of rows) buckets[hourInBRT(new Date(r.created_at))]++
  const now = hourInBRT(new Date())
  const callsByHour = Array.from({ length: now + 1 }, (_, h) => ({
    hour: `${String(h).padStart(2, '0')}h`,
    calls: buckets[h] ?? 0,
  }))

  return { callsToday, answeredToday, talkSecondsToday, byDisposition, callsByHour }
}
