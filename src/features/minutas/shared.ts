// Helpers e constantes compartilhados pelas abas de Minutas Processuais (Jurídico).
// Domínio SEPARADO das "Minutas" do CS. Centralizado aqui (dentro do feature) pra as três
// abas não duplicarem formatação/labels — módulo puro, importável por Client Components.
import type { ProcAcordo, ProcParcela, ProcParcelaStatus, Recorrencia } from '@/lib/types/database'

export const nf = (n: number) => n.toLocaleString('pt-BR')
export const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

// ISO 'YYYY-MM-DD' → 'DD/MM/YYYY'. '—' quando nulo.
export function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return y && m && d ? `${d}/${m}/${y}` : iso
}

// Hoje em Brasília, como 'YYYY-MM-DD' (en-CA formata nesse layout). Usado pra marcar
// pagamento e comparar vencimentos no cliente.
export function todayBRT(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

// ── Recorrência ──────────────────────────────────────────────────────────────
// `dias` espelha proc_recorrencia_dias no banco (mensal = 30). null = intervalo não fixo
// (avulsa) ou definido pelo usuário (personalizada).
export const RECORRENCIAS: { value: Recorrencia; label: string; dias: number | null }[] = [
  { value: 'mensal', label: 'Mensal (30 dias)', dias: 30 },
  { value: 'bimestral', label: 'Bimestral (60 dias)', dias: 60 },
  { value: 'trimestral', label: 'Trimestral (90 dias)', dias: 90 },
  { value: 'semestral', label: 'Semestral (180 dias)', dias: 180 },
  { value: 'anual', label: 'Anual (365 dias)', dias: 365 },
  { value: 'avulsa', label: 'Avulsa (parcela única)', dias: null },
  { value: 'personalizada', label: 'Personalizada…', dias: null },
]
const RECORRENCIA_CURTA: Record<Recorrencia, string> = {
  mensal: 'Mensal',
  bimestral: 'Bimestral',
  trimestral: 'Trimestral',
  semestral: 'Semestral',
  anual: 'Anual',
  avulsa: 'Avulsa',
  personalizada: 'Personalizada',
}
export function recorrenciaCurta(r: Recorrencia): string {
  return RECORRENCIA_CURTA[r] ?? r
}

// ── Status da parcela ────────────────────────────────────────────────────────
export const STATUS_META: Record<
  ProcParcelaStatus,
  { label: string; dot: string; text: string; chip: string }
> = {
  pago: { label: 'Pago', dot: 'bg-success', text: 'text-success', chip: 'bg-success/10 text-success' },
  pendente: { label: 'A pagar', dot: 'bg-primary', text: 'text-primary', chip: 'bg-primary/10 text-primary' },
  vencida: {
    label: 'Vencida',
    dot: 'bg-status-stuck',
    text: 'text-status-stuck',
    chip: 'bg-status-stuck/10 text-status-stuck',
  },
}

export function dueLabel(days: number | null): string {
  if (days === null) return 'sem vencimento'
  if (days < 0) return `venceu há ${nf(Math.abs(days))}d`
  if (days === 0) return 'vence hoje'
  return `vence em ${nf(days)}d`
}

// ── Linhas achatadas (parcela + seu acordo) — base das tabelas/calendário ────
export type MinutaRow = { acordo: ProcAcordo; parcela: ProcParcela }

export function flattenRows(acordos: ProcAcordo[]): MinutaRow[] {
  const out: MinutaRow[] = []
  for (const a of acordos) for (const p of a.parcelas) out.push({ acordo: a, parcela: p })
  return out
}

export function nomeCliente(a: ProcAcordo): string {
  return a.cliente || a.titulo || 'Sem cliente'
}

// ── Buckets por proximidade do vencimento (só parcelas em aberto) ────────────
// Mesmas faixas do controle de minutas do CS (decisão de produto reaproveitada).
export const BUCKETS = [
  { key: 'vencidas', label: 'Vencidas', hint: 'já venceu', tone: 'text-destructive', test: (d: number) => d < 0 },
  { key: 'mensal', label: 'Até 30 dias', hint: '≤ 30 dias', tone: 'text-warning', test: (d: number) => d >= 0 && d <= 30 },
  { key: 'trimestral', label: 'Trimestral', hint: '31–90 dias', tone: 'text-primary', test: (d: number) => d > 30 && d <= 90 },
  { key: 'semestral', label: 'Semestral', hint: '91–180 dias', tone: 'text-foreground', test: (d: number) => d > 90 && d <= 180 },
  { key: 'longo', label: '180+ dias', hint: '> 180 dias', tone: 'text-muted-foreground', test: (d: number) => d > 180 },
] as const

export type BucketKey = (typeof BUCKETS)[number]['key']

export function bucketOf(days: number): BucketKey {
  return BUCKETS.find((b) => b.test(days))?.key ?? 'longo'
}

// ── Meses (chave 'YYYY-MM') pro gráfico de série ─────────────────────────────
export function monthKey(ymd: string): string {
  return ymd.slice(0, 7)
}
export function addMonthsKey(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return `${MONTHS_PT[m - 1]}/${String(y).slice(2)}`
}
export function monthsRange(fromKey: string, toKey: string): string[] {
  const out: string[] = []
  let k = fromKey
  // guarda de segurança contra range absurdo (máx. 60 meses)
  for (let i = 0; i < 60 && k <= toKey; i++) {
    out.push(k)
    k = addMonthsKey(k, 1)
  }
  return out
}
