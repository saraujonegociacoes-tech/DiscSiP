'use client'

import dynamic from 'next/dynamic'

// ssr:false precisa estar em um Client Component — o softphone depende de estado de
// browser (Zustand, fetch ao helper local) e não deve ser renderizado no servidor
const SoftphoneClient = dynamic(() => import('./SoftphoneClient'), { ssr: false })

export default function SoftphonePage() {
  return <SoftphoneClient />
}
