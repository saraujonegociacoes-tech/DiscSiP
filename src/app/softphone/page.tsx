'use client'

import dynamic from 'next/dynamic'

// ssr:false precisa estar em um Client Component — SIP.js acessa APIs de browser no import
const SoftphoneClient = dynamic(() => import('./SoftphoneClient'), { ssr: false })

export default function SoftphonePage() {
  return <SoftphoneClient />
}
