'use client'

import { ComingSoon } from '@/components/bluedesk/ComingSoon'

// Placeholder do módulo de aquecimento de números WhatsApp. Enquanto
// NEXT_PUBLIC_WARMUP_ENABLED não estiver ligado, mostra "Em breve" (mesmo gate
// do /cs e /leads). Defina NEXT_PUBLIC_WARMUP_ENABLED=1 no .env.local para
// trabalhar nele localmente.
export function WarmupComingSoon() {
  return (
    <ComingSoon
      title="Aquecimento WhatsApp"
      description="Aquecimento automático de números novos antes das campanhas de disparo."
      message="O módulo de aquecimento está em preparação e chega logo."
    />
  )
}
