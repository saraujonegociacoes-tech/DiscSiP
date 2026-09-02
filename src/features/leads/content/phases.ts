// Catálogo de fases do funil de leads. Espelha o seed de lead_phases em
// supabase/manual/leads_dashboard_setup.sql (fonte de verdade é o id no Pipefy; aqui
// guardamos só o rótulo + ordem para montar o funil e classificar produtiva × morta).
// Usado tanto no server (cálculo do funil na action) quanto no client (rótulos).
import type { LeadPhaseKind } from '@/lib/types/database'

export interface ProductivePhase {
  order: number
  name: string
}

// Caminho produtivo, em ordem (0 = Recebidos … 9 = Venda). O funil conta, em cada etapa,
// quantos leads ALCANÇARAM aquela ordem ou além (max_funnel_order >= order).
export const PRODUCTIVE_PHASES: ProductivePhase[] = [
  { order: 0, name: 'Recebidos' },
  { order: 1, name: '1° Acionamento' },
  { order: 2, name: '2° Acionamento' },
  { order: 3, name: '3° Acionamento' },
  { order: 4, name: '4° Acionamento' },
  { order: 5, name: '5° Acionamento' },
  { order: 6, name: '6° Acionamento' },
  { order: 7, name: 'Procedimento' },
  { order: 8, name: 'Fechamento' },
  { order: 9, name: 'Venda' },
]

// Ordem em que o lead é considerado ganho (Venda).
export const WON_ORDER = 9

// Fases improdutivas (lead morto). Qualquer lead nelas conta como perdido.
export const DEAD_PHASES = ['Quitação/Negociação', 'Empréstimo', 'Sem Finalidade']

// Remarketing: estacionamento de RE-TRABALHO. Não é caminho produtivo (não tem degrau no
// funil, então não entra em PRODUCTIVE_PHASES) e não é lead morto (o Pipefy marca a fase
// como done=false e os cards saem dela de volta pro acionamento) — por isso também não
// entra em DEAD_PHASES. No banco é kind='produtiva' com funnel_order NULL.
// Quem passa por aqui vira REAPROVEITADO e fica assim PARA SEMPRE, mesmo depois de voltar
// ao acionamento (leads.reaproveitado → v_lead_progress.is_reaproveitado). A regra de qual
// fase marca é dado, não código: lead_phases.marks_reaproveitado.
// Ver supabase/migrations/Migrations_painelleads/20260901_leads_remarketing_reaproveitado.sql.
export const REUSE_PHASE = 'Remarketing'

export function phaseKindLabel(kind: LeadPhaseKind | null): string {
  if (kind === 'produtiva') return 'Produtiva'
  if (kind === 'morta') return 'Lead morto'
  return '—'
}
