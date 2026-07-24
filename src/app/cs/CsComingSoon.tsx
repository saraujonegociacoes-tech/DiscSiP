'use client'

import { ComingSoon } from '@/components/bluedesk/ComingSoon'

// Placeholder do painel de Sucesso do Cliente (CS) — domínio separado do Leads/comercial.
// Sprint 0: só a rota e o gate de navegação existem; dado e dashboard chegam nas próximas
// sprints (ver docs/updates/painel-sucesso-cliente-cs.md).
export function CsComingSoon() {
  return (
    <ComingSoon
      title="Sucesso do Cliente"
      description="Painel de acompanhamento do funil de Sucesso do Cliente (Pipefy)."
      message="O painel de CS está em preparação e chega logo."
    />
  )
}
