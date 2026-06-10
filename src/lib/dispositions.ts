import type { ContactStatus } from './types/database'

export interface Disposition {
  label: string
  status: ContactStatus
  value: string
}

// Resultados que o agente registra ao fim de uma chamada.
// `value` é o identificador estável (usado em notify_dispositions e nas notificações).
export const DISPOSITIONS: Disposition[] = [
  { label: 'Interessado', status: 'answered', value: 'interested' },
  { label: 'Sem Interesse', status: 'answered', value: 'not_interested' },
  { label: 'Ligar Depois', status: 'no_answer', value: 'callback' },
  { label: 'Não Atendeu', status: 'no_answer', value: 'no_answer' },
  { label: 'Ocupado', status: 'busy', value: 'busy' },
  { label: 'Não Perturbe', status: 'do_not_call', value: 'do_not_call' },
]
