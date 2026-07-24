import Link from 'next/link'
import { Mail } from 'lucide-react'
import { BlueDeskLogo } from '@/components/brand/BlueDeskLogo'

export default function VerifiqueEmailPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background bg-gradient-mesh p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-gradient-card p-8 text-center shadow-elevated">
        <div className="mb-6 flex justify-center">
          <BlueDeskLogo />
        </div>
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-primary text-primary-foreground shadow-glow">
          <Mail className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold text-foreground">Confirme seu email</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Enviamos um link de confirmação para o seu email. Clique nele para ativar sua conta.
          Depois, um administrador precisa aprovar seu acesso.
        </p>
        <p className="mt-4 text-xs text-muted-foreground/70">
          Não recebeu? Verifique a caixa de spam.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-block text-sm text-primary transition-colors hover:underline"
        >
          Voltar ao login
        </Link>
      </div>
    </div>
  )
}
