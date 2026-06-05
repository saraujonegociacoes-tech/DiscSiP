import dynamic from 'next/dynamic'

// SIP.js usa WebRTC APIs que só existem no browser — desabilita SSR para o componente inteiro
const SoftphoneClient = dynamic(() => import('./SoftphoneClient'), { ssr: false })

export default function SoftphonePage() {
  return (
    <main className="min-h-screen bg-[#070d1a] flex items-center justify-center p-4">
      <SoftphoneClient />
    </main>
  )
}
