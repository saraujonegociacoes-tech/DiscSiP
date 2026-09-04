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

// ── Janela de comparação, casada por dias úteis ─────────────────────────────
// Pedido do dono (04/set/2026): *"filtrei os últimos 15 dias de meta; quero comparar com os
// últimos 15 dias de meta da meta passada"*. A régua antiga (dentro de `get_ceo_financeiro`)
// era `início − quantidade de dias corridos`, e ela mente em dois casos que acontecem todo
// dia na tela:
//
//   · **Ciclo em andamento.** Escolher o ciclo corrente comparava o que entrou em ~18 dias
//     úteis contra o ciclo anterior INTEIRO (23). O delta nascia negativo por construção.
//   · **Recorte livre.** "Últimos 15 dias" caía nos 15 dias corridos imediatamente
//     anteriores, que podem carregar 9, 10 ou 11 dias úteis conforme os fins de semana.
//
// A régua nova: a janela de comparação **começa um ciclo antes** (menos um mês — como o
// ciclo é ancorado no dia 11, um mês atrás é exatamente o ciclo passado) e vai até completar
// **a mesma quantidade de dias úteis** que a janela escolhida tem até hoje.

const pad2 = (n: number) => String(n).padStart(2, '0')

// Desloca uma data BRT 'YYYY-MM-DD' em `days` dias. Date.UTC normaliza virada de mês e ano.
function shiftYMD(s: string, days: number): string {
  const [y, m, d] = s.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`
}

// Mesma data `n` meses atrás, com o dia GRAMPEADO ao último do mês de destino: 31/mar menos
// um mês é 28/fev, e não 3/mar (que é onde o Date.UTC cru cairia, rolando para frente).
function monthsBackYMD(s: string, n: number): string {
  const [y, m, d] = s.split('-').map(Number)
  const ultimoDia = new Date(Date.UTC(y, m - n, 0)).getUTCDate()
  const t = new Date(Date.UTC(y, m - 1 - n, Math.min(d, ultimoDia)))
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`
}

function isBusinessDay(s: string): boolean {
  const [y, m, d] = s.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return dow !== 0 && dow !== 6
}

/** Fim EXCLUSIVO da janela que começa em `startYMD` e contém exatamente `n` dias úteis. */
export function businessDaysEnd(startYMD: string, n: number): string {
  if (n <= 0) return startYMD
  let cur = startYMD
  let count = 0
  while (count < n) {
    if (isBusinessDay(cur)) count++
    cur = shiftYMD(cur, 1)
  }
  return cur
}

/** Início da janela que termina (EXCLUSIVO) em `endYMD` e contém exatamente `n` dias úteis. */
export function businessDaysStart(endYMD: string, n: number): string {
  let cur = endYMD
  let count = 0
  while (count < n) {
    cur = shiftYMD(cur, -1)
    if (isBusinessDay(cur)) count++
  }
  return cur
}

/** A janela anterior comparável, e por que ela tem esse tamanho. */
export interface ComparableWindow {
  /** A janela em si, pronta para ir à RPC (start/end UTC ISO, `end` EXCLUSIVO). */
  period: LeadPeriod
  /** Dias úteis dos dois lados da comparação — é o que a torna justa. */
  businessDays: number
  /**
   * true quando a janela teve de recuar para ficar colada na selecionada, em vez de um
   * ciclo cheio atrás. Acontece com recorte maior que um mês, em que "um ciclo antes"
   * invadiria o próprio período escolhido e contaria o mesmo dinheiro dos dois lados.
   */
  adjusted: boolean
}

// A janela de comparação de um período, casada em DIAS ÚTEIS.
//
// `now` (default: agora) entra na conta porque um período em andamento só realizou o que já
// passou: a contagem vai até HOJE, inclusive. Escolher o ciclo corrente no dia 4 compara os
// dias úteis decorridos contra os mesmos N dias úteis do ciclo passado, em vez do ciclo
// passado inteiro.
//
// Devolve `null` quando não há dia útil nenhum a comparar (janela só de fim de semana) — aí
// a tela simplesmente não mostra variação, em vez de inventar uma base.
export function previousBusinessWindow(
  period: LeadPeriod,
  now: Date = new Date(),
): ComparableWindow | null {
  const inicio = ymd(brtParts(new Date(period.start)))
  const fim = ymd(brtParts(new Date(period.end))) // EXCLUSIVO
  // Amanhã em BRT: o limite exclusivo que faz HOJE contar.
  const limite = shiftYMD(ymd(brtParts(now)), 1)

  // Período em andamento → conta só o decorrido. Período inteiro no passado → `fim` manda.
  const fimEfetivo = fim < limite ? fim : limite
  // Período inteiramente no futuro não tem decorrido: aí a janela cheia é a única medida
  // possível, e a comparação vira "mesmo tamanho, um ciclo antes".
  const dias =
    businessDaysBetween(inicio, fimEfetivo) || businessDaysBetween(inicio, fim)
  if (dias === 0) return null

  // Começa no primeiro DIA ÚTIL a partir de um mês atrás. Sem isso, um início que cai no
  // sábado arrastaria o fim de semana para dentro só de um dos lados da comparação — e
  // pagamento datado em sábado existe na base. Contar N dias úteis a partir do sábado ou da
  // segunda seguinte termina no mesmo dia, então o corte só enxuga a ponta.
  let prevStart = monthsBackYMD(inicio, 1)
  while (!isBusinessDay(prevStart)) prevStart = shiftYMD(prevStart, 1)
  let prevEnd = businessDaysEnd(prevStart, dias) // EXCLUSIVO
  let adjusted = false

  // Recorte maior que um mês: a janela de um ciclo atrás entraria dentro da selecionada e o
  // mesmo dinheiro apareceria nos dois lados. Nesse caso ela encosta no início do período.
  if (prevEnd > inicio) {
    prevEnd = inicio
    prevStart = businessDaysStart(inicio, dias)
    adjusted = true
  }

  return {
    // customPeriod recebe o último dia INCLUSIVO e já monta rótulo ("11 jul – 4 ago").
    period: customPeriod(prevStart, shiftYMD(prevEnd, -1)),
    businessDays: dias,
    adjusted,
  }
}
