// Helpers de fuso de Brasília. Em produção o runtime (Cloudflare Workers) roda em UTC, então
// new Date().getHours()/setHours() calculam em UTC e os recortes de hora/"hoje" saem deslocados.
// Estas funções fixam o cálculo em America/Sao_Paulo (Brasil é UTC−3, sem horário de verão desde
// 2019), independente do fuso do servidor. created_at continua em UTC e é comparado em UTC — só a
// LEITURA (hora do dia, recorte de "hoje") passa para o fuso de Brasília.
export const BRT_TZ = 'America/Sao_Paulo'

// Hora do dia (0–23) de um instante, no fuso de Brasília. formatToParts evita ambiguidade de
// locale; hourCycle 'h23' garante 00–23 (sem "24h" para meia-noite).
export function hourInBRT(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BRT_TZ,
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  return Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
}

// Início do dia de HOJE em Brasília, como instante UTC (00:00 BRT = 03:00 UTC) para filtrar
// created_at (que é UTC). Pega a data Y-M-D já no fuso de Brasília e fixa às 03:00Z.
export function brtTodayStartUtcISO(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BRT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}T03:00:00.000Z`
}
