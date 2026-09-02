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

// ── Mês civil (1º ao último dia) ────────────────────────────────────────────
// O ciclo 11→10 acima é a convenção da OPERAÇÃO. O painel do CEO usa os dois: o
// executivo lê faturamento em mês de calendário (e é assim que bate com extrato e
// contabilidade), mas o dono quis poder comparar com o recorte da operação. Quem
// escolhe é o toggle do CeoPeriodPicker; o default é o mês civil.
// Mesmas garantias do ciclo: corte em BRT, `end` EXCLUSIVO, `key` estável.

// Mês civil de (year, month). `month` pode estar fora de 1..12 (Date.UTC normaliza).
export function civilMonthStartingAt(year: number, month: number): LeadPeriod {
  const start = brtMidnightUtcISO(year, month, 1)
  const end = brtMidnightUtcISO(year, month + 1, 1)
  const s = brtParts(new Date(start))
  return {
    start,
    end,
    key: start.slice(0, 10),
    label: `${MONTHS_PT[s.month - 1]}/${s.year}`,
  }
}

// Mês civil que contém `now` (default: agora), em BRT.
export function currentCivilMonth(now: Date = new Date()): LeadPeriod {
  const { year, month } = brtParts(now)
  return civilMonthStartingAt(year, month)
}

// Os N meses civis mais recentes (o corrente primeiro), para o seletor.
export function recentCivilMonths(count = 12, now: Date = new Date()): LeadPeriod[] {
  const { year, month } = brtParts(now)
  return Array.from({ length: count }, (_, i) => civilMonthStartingAt(year, month - i))
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

// ── Dia único (hoje / ontem) ────────────────────────────────────────────────
// Ciclo e mês respondem "como foi o período"; os painéis também precisam de "como está
// agora". Mesmas garantias: corte em BRT, `end` EXCLUSIVO, `key` estável. O prefixo `dia_`
// na key evita colisão com a key de ciclo/mês que começa no mesmo dia.

const DAY_NAMES = ['Hoje', 'Ontem'] as const

// Dia BRT `daysAgo` dias atrás (0 = hoje, 1 = ontem). Rótulo nomeado nos dois primeiros
// (ex.: "Hoje (24 ago)"), só a data nos demais.
export function dayPeriod(daysAgo: number, now: Date = new Date()): LeadPeriod {
  const { year, month, day } = brtParts(now)
  const start = brtMidnightUtcISO(year, month, day - daysAgo)
  const end = brtMidnightUtcISO(year, month, day - daysAgo + 1)
  const s = brtParts(new Date(start))
  const date = `${s.day} ${MONTHS_PT[s.month - 1]}`
  const name = DAY_NAMES[daysAgo]
  return {
    start,
    end,
    key: `dia_${ymd(s)}`,
    label: name ? `${name} (${date})` : date,
  }
}

// Os recortes de dia dos seletores: hoje e ontem, nessa ordem.
export function recentDays(now: Date = new Date()): LeadPeriod[] {
  return DAY_NAMES.map((_, i) => dayPeriod(i, now))
}

// ── Dias úteis do período ───────────────────────────────────────────────────
// Nasceu do card "Diária" da aba Financeiro do CEO (set/2026): a meta que a operação
// persegue no dia é o que falta dividido pelos dias que ainda restam para faturar — e
// sábado e domingo não faturam. Fica aqui, e não na aba, porque é aritmética de
// calendário em BRT: o mesmo motivo pelo qual todo o resto deste arquivo existe (o app
// roda em UTC no Cloudflare; contar dia com getDay() local erraria a virada).
//
// ⚠️ "Dia útil" aqui é SEGUNDA A SEXTA, sem tabela de feriados — o repo não tem uma, e
// inventar uma lista incompleta erraria em silêncio no feriado que faltasse. O efeito
// prático é conhecido: num mês com feriado a diária sai um pouco OTIMISTA (divide por
// um dia a mais do que a operação tem). Quando existir calendário de feriados, é aqui
// que ele entra — a aba não muda.

// Dias de semana (seg–sex) entre duas datas BRT 'YYYY-MM-DD', com `endYMD` EXCLUSIVO —
// mesma convenção de `end` do LeadPeriod. Itera em UTC de propósito: as datas já vêm
// como Y-M-D BRT, e o Brasil não tem horário de verão desde 2019, então somar 24h nunca
// pula nem repete dia.
export function businessDaysBetween(startYMD: string, endYMD: string): number {
  const [sy, sm, sd] = startYMD.split('-').map(Number)
  const [ey, em, ed] = endYMD.split('-').map(Number)
  const end = Date.UTC(ey, em - 1, ed)
  let count = 0
  for (let t = Date.UTC(sy, sm - 1, sd); t < end; t += 86_400_000) {
    const dow = new Date(t).getUTCDay()
    if (dow !== 0 && dow !== 6) count++
  }
  return count
}

/** Dias úteis de um período: quantos ainda restam (HOJE incluso) e quantos ele tem ao todo. */
export interface BusinessDaysLeft {
  /** Dias úteis de hoje (inclusive) até o fim do período. 0 se o período já acabou. */
  restantes: number
  /** Dias úteis do período inteiro — a base do "X de Y" na tela. */
  totais: number
  /** true quando o período inteiro já passou (`end` ≤ hoje): não há mais dia para faturar. */
  encerrado: boolean
  /** true quando o período ainda não começou: restantes = totais. */
  futuro: boolean
}

// Dias úteis que ainda contam num período, olhando de `now` (default: agora), em BRT.
//
// HOJE CONTA. A conta responde "quanto preciso fazer por dia, a partir de agora" — e
// hoje ainda dá para faturar. Excluir o dia corrente inflaria a diária todo santo dia
// da manhã, que é justo a hora em que o CEO pede o número.
export function businessDaysLeft(period: LeadPeriod, now: Date = new Date()): BusinessDaysLeft {
  // `period.end` é o limite EXCLUSIVO à meia-noite BRT — lido em BRT ele já é, exato, o
  // primeiro dia de fora. Nada de somar 1 dia à mão.
  const inicio = ymd(brtParts(new Date(period.start)))
  const fim = ymd(brtParts(new Date(period.end)))
  const hoje = ymd(brtParts(now))

  const totais = businessDaysBetween(inicio, fim)
  // Comparação de string funciona em 'YYYY-MM-DD' (ISO é lexicograficamente ordenado).
  const encerrado = hoje >= fim
  const futuro = hoje < inicio
  const desde = futuro ? inicio : hoje

  return {
    restantes: encerrado ? 0 : businessDaysBetween(desde, fim),
    totais,
    encerrado,
    futuro,
  }
}
