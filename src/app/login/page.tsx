'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { BlueLineLogo } from '@/components/brand/BlueLineLogo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    if (!email || !password) return
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(
        error.message === 'Invalid login credentials'
          ? 'Email ou senha inválidos.'
          : error.message === 'Email not confirmed'
            ? 'Confirme seu email antes de entrar (verifique sua caixa de entrada).'
            : error.message
      )
      setLoading(false)
      return
    }

    // O middleware decide o destino conforme o papel (app ou /aguardando)
    router.refresh()
    router.replace('/softphone')
  }

  return (
    <div className="grid min-h-screen bg-background bg-gradient-mesh lg:grid-cols-2">
      {/* Hero — gradiente premium */}
      <div className="relative hidden overflow-hidden lg:block bg-gradient-premium">
        <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_30%_20%,white,transparent_40%)]" />
        <div className="relative flex h-full flex-col justify-between p-10 text-white">
          <BlueLineLogo />
          <div className="max-w-md">
            <h2 className="text-4xl font-semibold leading-tight tracking-tight">
              Conectando conversas que geram resultados.
            </h2>
            <p className="mt-4 text-sm text-white/70">
              Operação comercial em tempo real. Filas inteligentes, agentes focados,
              indicadores que importam.
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
            <BlueLineLogo />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Entrar na plataforma</h1>
          <p className="mt-2 text-sm text-muted-foreground">Use suas credenciais corporativas.</p>

          <div className="mt-8 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
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
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                placeholder="••••••••"
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button
              onClick={handleLogin}
              disabled={loading || !email || !password}
              className="w-full bg-primary hover:bg-primary/90"
            >
              {loading ? 'Entrando...' : 'Acessar painel'}
            </Button>
          </div>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Não tem conta?{' '}
            <Link href="/cadastro" className="text-primary hover:underline">
              Cadastre-se
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
