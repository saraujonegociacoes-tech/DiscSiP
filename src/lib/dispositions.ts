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
  // Caixa postal e bloqueio de spam atendem a chamada, então chegam aqui como "atendida" e
  // derrubam o resto do lote paralelo. Tempo não separa esses casos de gente de verdade (o
  // bloqueio medido atendeu em 8,9s), mas o agente ouve a gravação e sabe na hora — esta opção
  // é o único classificador confiável que temos hoje. Cai em `abandoned` para voltar à fila
  // na reciclagem, e `value: 'voicemail'` permite medir depois a frequência real do problema.
  { label: 'Caixa postal / Bloqueio', status: 'abandoned', value: 'voicemail' },
  { label: 'Não Perturbe', status: 'do_not_call', value: 'do_not_call' },
]
