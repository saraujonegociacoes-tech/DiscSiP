'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { BlueDeskLogo } from '@/components/brand/BlueDeskLogo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function CadastroPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSignUp = async () => {
    if (!name || !email || !password) return
    if (password.length < 6) {
      setError('A senha precisa ter pelo menos 6 caracteres.')
      return
    }
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    // Com confirmação de email ligada, não há sessão até o usuário confirmar.
    // Se o email já existir, o Supabase devolve um usuário sem identidades.
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      setError('Já existe uma conta com este email.')
      setLoading(false)
      return
    }

    router.replace('/verifique-email')
  }

  return (
    <div className="grid min-h-screen bg-background bg-gradient-mesh lg:grid-cols-2">
      {/* Hero — gradiente premium */}
      <div className="relative hidden overflow-hidden lg:block bg-gradient-premium">
        <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_30%_20%,white,transparent_40%)]" />
        <div className="relative flex h-full flex-col justify-between p-10 text-white">
          <BlueDeskLogo />
          <div className="max-w-md">
            <h2 className="text-4xl font-semibold leading-tight tracking-tight">
              Comece a discar com inteligência.
            </h2>
            <p className="mt-4 text-sm text-white/70">
              Crie sua conta e peça aprovação ao seu supervisor para entrar na operação.
            </p>
          </div>
          <div className="text-xs uppercase tracking-[0.32em] text-white/60">
            Power Dialer Platform
          </div>
        </div>
      </div>

      {/* Formulário */}
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex justify-center lg:hidden">
            <BlueDeskLogo />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Criar conta</h1>
          <p className="mt-2 text-sm text-muted-foreground">Leva menos de um minuto.</p>

          <div className="mt-8 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome</Label>
              <Input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Seu nome"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@empresa.com.br"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSignUp()}
                placeholder="mínimo 6 caracteres"
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button
              onClick={handleSignUp}
              disabled={loading || !name || !email || !password}
              className="w-full bg-primary hover:bg-primary/90"
            >
              {loading ? 'Criando...' : 'Criar conta'}
            </Button>
          </div>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Já tem conta?{' '}
            <Link href="/login" className="text-primary hover:underline">
              Entrar
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
