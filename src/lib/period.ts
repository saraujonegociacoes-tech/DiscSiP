// Período genérico para filtros de intervalo de data (dashboards de leads e discadora).
// O ciclo de meta da operação NÃO é o mês civil: vai do dia 11 de um mês ao dia 10 do
// mês seguinte (ex.: 11/jun → 10/jul). Este helper calcula o ciclo corrente e vizinhos,
// sempre no fuso de Brasília (o app roda em UTC no Cloudflare, então o corte precisa ser
// fixado em BRT — mesmo motivo do lib/timezone.ts). `start`/`end` saem em UTC ISO para
// comparar direto com colunas created_at (UTC); `end` é EXCLUSIVO.
import { BRT_TZ } from '@/lib/timezone'

// Dia-âncora do ciclo: todo ciclo começa no dia 11 e termina no dia 10 do mês seguinte.
export const CYCLE_ANCHOR_DAY = 11

const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export interface LeadPeriod {
  /** Início do intervalo (UTC ISO), inclusivo. Compara com created_at (UTC). */
  start: string
  /** Fim do intervalo (UTC ISO), EXCLUSIVO. */
  end: string
  /** Rótulo curto para a UI, ex.: "11 jun – 10 jul". */
  label: string
  /** Identificador estável (início YYYY-MM-DD), útil como value/key do seletor. */
  key: string
}

// Componentes de data (ano, mês 1-12, dia) de um instante, lidos no fuso de Brasília.
function brtParts(d: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BRT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0')
  return { year: get('year'), month: get('month'), day: get('day') }
}

// Meia-noite BRT (UTC−3, sem horário de verão) de (ano, mês 1-12, dia), como instante UTC.
// 00:00 BRT = 03:00 UTC. Date.UTC normaliza mês/dia fora do intervalo (mês 0 = dez do ano
// anterior; 13 = jan do próximo; dia > fim do mês rola pro mês seguinte).
function brtMidnightUtcISO(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day, 3, 0, 0)).toISOString()
}

function ymd(p: { year: number; month: number; day: number }): string {
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

// Ciclo cujo início é dia 11 de (year, month). `month` pode estar fora de 1..12 (normaliza).
export function cycleStartingAt(year: number, month: number): LeadPeriod {
  const start = brtMidnightUtcISO(year, month, CYCLE_ANCHOR_DAY)
  const end = brtMidnightUtcISO(year, month + 1, CYCLE_ANCHOR_DAY)
  const s = brtParts(new Date(start))
  // Último dia inclusivo = véspera do fim exclusivo (dia 10 do mês de término).
  const e = brtParts(new Date(new Date(end).getTime() - 86_400_000))
  return {
    start,
    end,
    key: start.slice(0, 10),
    label: `${s.day} ${MONTHS_PT[s.month - 1]} – ${e.day} ${MONTHS_PT[e.month - 1]}`,
  }
}

// Ciclo que contém `now` (default: agora), em BRT.
export function currentCycle(now: Date = new Date()): LeadPeriod {
  const { year, month, day } = brtParts(now)
  const startMonth = day >= CYCLE_ANCHOR_DAY ? month : month - 1
  return cycleStartingAt(year, startMonth)
}

// Desloca um ciclo em `delta` meses (−1 = ciclo anterior, +1 = próximo).
export function shiftCycle(period: LeadPeriod, delta: number): LeadPeriod {
  const s = brtParts(new Date(period.start))
  return cycleStartingAt(s.year, s.month + delta)
}

// Os N ciclos mais recentes (o corrente primeiro), para o seletor de período.
export function recentCycles(count = 6, now: Date = new Date()): LeadPeriod[] {
  const cur = currentCycle(now)
  return Array.from({ length: count }, (_, i) => shiftCycle(cur, -i))
}

// Período arbitrário a partir de duas datas BRT ('YYYY-MM-DD', do <input type="date">).
// `endYMD` é o último dia INCLUSIVO; o `end` interno vira 00:00 BRT do dia seguinte.
export function customPeriod(startYMD: string, endYMD: string): LeadPeriod {
  const [sy, sm, sd] = startYMD.split('-').map(Number)
  const [ey, em, ed] = endYMD.split('-').map(Number)
  const start = brtMidnightUtcISO(sy, sm, sd)
  const end = brtMidnightUtcISO(ey, em, ed + 1)
  return {
    start,
    end,
    key: `${startYMD}_${endYMD}`,
    label: `${sd} ${MONTHS_PT[sm - 1]} – ${ed} ${MONTHS_PT[em - 1]}`,
  }
}

// Saneia um LeadPeriod vindo do CLIENTE antes de usar start/end em queries. As server
// actions recebem o período do browser; sem isto, um start/end forjado poderia se infiltrar
// num filtro montado por string (ex.: PostgREST .or(...)). Normaliza para ISO canônico (só
// dígitos e -:.TZ), lançando se a data for inválida. Idempotente para períodos válidos.
export function sanitizePeriod(period: LeadPeriod): LeadPeriod {
  const iso = (v: string, field: string): string => {
    const t = Date.parse(v)
    if (Number.isNaN(t)) throw new Error(`período inválido (${field})`)
    return new Date(t).toISOString()
  }
  return { ...period, start: iso(period.start, 'start'), end: iso(period.end, 'end') }
}

// Datas BRT ('YYYY-MM-DD') dos limites de um período, para preencher inputs de data.
// `endDate` é o último dia INCLUSIVO (véspera do `end` exclusivo).
export function periodBounds(p: LeadPeriod): { startDate: string; endDate: string } {
  return {
    startDate: ymd(brtParts(new Date(p.start))),
    endDate: ymd(brtParts(new Date(new Date(p.end).getTime() - 86_400_000))),
  }
}
