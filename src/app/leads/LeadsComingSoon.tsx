'use client'

import { ComingSoon } from '@/components/bluedesk/ComingSoon'

// Placeholder de lançamento do dashboard de leads. Enquanto NEXT_PUBLIC_LEADS_ENABLED não
// estiver ligado, /leads mostra este "Em breve" (gate em src/app/leads/page.tsx).
export function LeadsComingSoon() {
  return (
    <ComingSoon
      title="Leads"
      description="Dashboard de leads do funil Pipefy."
      message="O dashboard de leads está em preparação e chega logo. Enquanto isso, tudo do discador segue funcionando normalmente."
    />
  )
}
