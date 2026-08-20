// Helpers e constantes compartilhados pelas abas da Central de Aparelhos.
// Centralizado aqui (dentro do feature) pras quatro abas não duplicarem
// formatação/rótulos — módulo puro, importável por Client Components.
//
// É réplica local do padrão de features/minutas/shared.ts, não import dele:
// domínios separados replicam o padrão em vez de compartilhar um módulo (mesma
// decisão registrada em MinutasTabNav sobre o CsTabNav). O que É compartilhado de
// verdade continua vindo de fora — `downloadCsv` de @/lib/csv, `cn` de @/lib/utils.
import type { InvAparelho, InvChip, InvChipTipo, InvPessoa, InvStatus } from '@/lib/types/database'

export const nf = (n: number) => n.toLocaleString('pt-BR')

// Hoje em Brasília, como 'YYYY-MM-DD' (en-CA formata nesse layout). Só é usado pra
// nomear o arquivo do CSV — o inventário não tem datas de negócio.
export function todayBRT(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

// ── Status do aparelho ───────────────────────────────────────────────────────
// O banco guarda o SLUG ('em_uso'); o rótulo é decisão de tela e mora aqui. As
// classes seguem os tokens do tema (funcionam em claro e escuro), no mesmo
// formato do STATUS_META das Minutas.
export const STATUS_META: Record<InvStatus, { label: string; dot: string; chip: string }> = {
  em_uso: { label: 'Em uso', dot: 'bg-success', chip: 'bg-success/10 text-success' },
  estoque: { label: 'Estoque', dot: 'bg-muted-foreground', chip: 'bg-muted/40 text-muted-foreground' },
  manutencao: { label: 'Manutenção', dot: 'bg-destructive', chip: 'bg-destructive/10 text-destructive' },
}

export const STATUS_OPCOES: InvStatus[] = ['em_uso', 'estoque', 'manutencao']

// Ordem de leitura da coluna Status: quem precisa de ação primeiro. Manutenção é
// o que exige providência, estoque é o que está parado, em uso é o normal.
export const STATUS_ORDEM: Record<InvStatus, number> = { manutencao: 0, estoque: 1, em_uso: 2 }

// ── Tipo de plano do chip ────────────────────────────────────────────────────
export const TIPO_META: Record<InvChipTipo, { label: string; chip: string }> = {
  pos: { label: 'Pós-pago', chip: 'bg-primary/10 text-primary' },
  pre: { label: 'Pré-pago', chip: 'bg-warning/10 text-warning' },
}

export const TIPO_OPCOES: InvChipTipo[] = ['pre', 'pos']

// ── Formatação ───────────────────────────────────────────────────────────────
const soDigitos = (s: string) => s.replace(/\D/g, '')

/**
 * Número de linha em formato brasileiro para leitura: (11) 91234-5678. Fora dos
 * tamanhos conhecidos (10 e 11 dígitos), devolve o que foi digitado — inventário
 * também guarda linha de dados e número curto, e mascarar à força esconderia o
 * dado real de quem está conferindo.
 */
export function fmtNumero(numero: string): string {
  const d = soDigitos(numero)
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return numero
}

/** IMEI em grupos de 4, que é como se confere dígito a dígito contra o aparelho. */
export function fmtImei(imei: string | null): string {
  if (!imei) return '—'
  const d = soDigitos(imei)
  if (d.length !== 15) return imei
  return `${d.slice(0, 2)} ${d.slice(2, 8)} ${d.slice(8, 14)} ${d.slice(14)}`
}

export const ouTraco = (s: string | null | undefined) => (s && s.trim() !== '' ? s : '—')

// ── Junções (o dado vem em três listas planas de getInventario) ───────────────
export function pessoaDoAparelho(a: InvAparelho, pessoas: InvPessoa[]): InvPessoa | null {
  return a.pessoaId ? (pessoas.find((p) => p.id === a.pessoaId) ?? null) : null
}

export function aparelhoDoChip(c: InvChip, aparelhos: InvAparelho[]): InvAparelho | null {
  return c.aparelhoId ? (aparelhos.find((a) => a.id === c.aparelhoId) ?? null) : null
}

export function aparelhosDaPessoa(pessoaId: string, aparelhos: InvAparelho[]): InvAparelho[] {
  return aparelhos.filter((a) => a.pessoaId === pessoaId)
}

/** Rótulo de um aparelho num select/coluna: modelo + IMEI, que é o que desambigua. */
export function rotuloAparelho(a: InvAparelho): string {
  return a.imei ? `${a.modelo} · ${fmtImei(a.imei)}` : a.modelo
}

/** Quantos slots livres o aparelho ainda tem (o banco limita em 2). */
export function slotsLivres(a: InvAparelho): number {
  return Math.max(0, 2 - a.chips.length)
}

/**
 * Ocupação dos dois slots do aparelho. A Visão Geral do arquivo original mostrava
 * isso como barrinhas de sinal de celular; aqui vira o mesmo dado no vocabulário
 * do Blue Desk (dois traços, um por slot), que lê igual de rápido e usa os tokens
 * do tema em vez de cor fixa. `true` = slot ocupado.
 */
export function ocupacaoSlots(a: InvAparelho): [boolean, boolean] {
  return [a.chips.some((c) => c.slot === 1), a.chips.some((c) => c.slot === 2)]
}
