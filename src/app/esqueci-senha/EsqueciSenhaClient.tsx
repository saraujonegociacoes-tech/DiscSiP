'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MailCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { AuthShell } from '@/components/auth/AuthShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function EsqueciSenhaClient({ erro }: { erro: string | null }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    if (!email) return
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      // O GoTrue valida o token e redireciona pra cá com ?code= (PKCE). Quem troca o
      // code por sessão é o route handler /auth/recuperar.
      redirectTo: `${window.location.origin}/auth/recuperar`,
    })

    setLoading(false)

    // Erro de verdade (rate limit, SMTP fora do ar) a gente mostra. O que NÃO mostramos
    // é "esse email não existe": confirmar cadastro pra quem não está logado entrega a
    // lista de quem trabalha aqui. Por isso o sucesso é sempre a mesma frase genérica —
    // e o próprio Supabase, por padrão, também não diferencia os dois casos.
    if (error) {
      setError(
        error.message.toLowerCase().includes('rate limit') ||
          error.message.toLowerCase().includes('security purposes')
          ? 'Muitas tentativas seguidas. Espere um minuto e tente de novo.'
          : error.message
      )
      return
    }

    setSent(true)
  }

  if (sent) {
    return (
      <AuthShell
        title="Verifique seu email"
        description="O link vale por uma hora."
        heroTitle="Link a caminho."
        heroText="Abra o email no mesmo navegador em que você pediu a redefinição."
      >
        <div className="mt-8 rounded-2xl border border-border bg-gradient-card p-6 text-center shadow-card">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-primary text-primary-foreground shadow-glow">
            <MailCheck className="h-6 w-6" />
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Se existir uma conta com <span className="font-medium text-foreground">{email}</span>,
            enviamos um link para você criar uma senha nova.
          </p>
          <p className="mt-4 text-xs text-muted-foreground/70">
            Não recebeu? Verifique a caixa de spam.
          </p>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link href="/login" className="text-primary hover:underline">
            Voltar ao login
          </Link>
        </p>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Redefinir senha"
      description="Enviamos um link para o seu email."
      heroTitle="Esqueceu a senha? Acontece."
      heroText="Em dois cliques você volta para a operação, sem perder nada do seu histórico."
    >
      <div className="mt-8 space-y-4">
        {erro === 'link' && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Esse link expirou ou já foi usado. Peça um novo abaixo.
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            placeholder="voce@empresa.com.br"
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button
          onClick={handleSubmit}
          disabled={loading || !email}
          className="w-full bg-primary hover:bg-primary/90"
        >
          {loading ? 'Enviando...' : 'Enviar link de redefinição'}
        </Button>
      </div>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Lembrou?{' '}
        <Link href="/login" className="text-primary hover:underline">
          Entrar
        </Link>
      </p>
    </AuthShell>
  )
}
