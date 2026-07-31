'use client'

import { ComingSoon } from '@/components/bluedesk/ComingSoon'

// Placeholder do Painel do CEO, exibido enquanto NEXT_PUBLIC_CEO_ENABLED estiver desligada.
// Também é onde o papel `ceo` aterrissa após o login nesse estado (o middleware manda toda
// rota que não seja /ceo ou /ajuda para cá) — por isso a mensagem fala com o executivo, não
// com o time de dev. Ver docs/projetopainelceo-docs/updates/painel-ceo-sprints.md (Sprint 0).
export function CeoComingSoon() {
  return (
    <ComingSoon
      title="Painel do CEO"
      description="Visão executiva do negócio: entradas do mês, projeções de pagamento e saúde da empresa e da equipe."
      message="O painel executivo está em preparação. O primeiro bloco a entrar no ar é o Financeiro — entradas do mês."
    />
  )
}
