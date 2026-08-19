import type { ReactNode } from 'react'
import { BlueDeskLogo } from '@/components/brand/BlueDeskLogo'

// Moldura das telas de autenticação: hero com o gradiente premium à esquerda (só em
// lg+) e o conteúdo à direita. É o mesmo layout que /login e /cadastro montam à mão —
// aquelas duas seguem com o markup próprio (não quis mexer em tela que já está no ar),
// e este componente existe pra que as telas NOVAS do fluxo de senha não repetissem o
// bloco do hero uma terceira e uma quarta vez.
export function AuthShell({
  title,
  description,
  heroTitle,
  heroText,
  children,
}: {
  title: string
  description: string
  heroTitle: string
  heroText: string
  children: ReactNode
}) {
  return (
    <div className="grid min-h-screen bg-background bg-gradient-mesh lg:grid-cols-2">
      <div className="relative hidden overflow-hidden lg:block bg-gradient-premium">
        <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_30%_20%,white,transparent_40%)]" />
        <div className="relative flex h-full flex-col justify-between p-10 text-white">
          <BlueDeskLogo />
          <div className="max-w-md">
            <h2 className="text-4xl font-semibold leading-tight tracking-tight">{heroTitle}</h2>
            <p className="mt-4 text-sm text-white/70">{heroText}</p>
          </div>
          <div className="text-xs uppercase tracking-[0.32em] text-white/60">
            Power Dialer Platform
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex justify-center lg:hidden">
            <BlueDeskLogo />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
          {children}
        </div>
      </div>
    </div>
  )
}
