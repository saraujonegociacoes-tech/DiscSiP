'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Clock } from 'lucide-react'
import { signOut } from '@/app/actions/auth'
import { BlueDeskLogo } from '@/components/brand/BlueDeskLogo'
import { Button } from '@/components/ui/button'

export default function AguardandoPage() {
  const router = useRouter()

  return (
    <div className="flex min-h-screen items-center justify-center bg-background bg-gradient-mesh p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-gradient-card p-8 text-center shadow-elevated">
        <div className="mb-6 flex justify-center">
          <BlueDeskLogo />
        </div>
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-primary text-primary-foreground shadow-glow">
          <Clock className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold text-foreground">Aguardando aprovação</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Sua conta foi criada e confirmada. Um administrador precisa aprovar seu acesso e
          atribuir seu papel (e ramal, se for discar) antes de você usar o Blue Desk.
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <Button onClick={() => router.refresh()} className="w-full bg-primary hover:bg-primary/90">
            Já fui aprovado — verificar
          </Button>
          <Link
            href="/ajuda"
            className="py-1 text-xs text-primary transition-colors hover:text-primary/80"
          >
            Como usar o sistema?
          </Link>
          <button
            onClick={() => signOut()}
            className="py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Sair
          </button>
        </div>
      </div>
    </div>
  )
}
