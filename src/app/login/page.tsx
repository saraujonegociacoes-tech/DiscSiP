'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

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
    <div className="min-h-screen bg-[#0f172a] flex items-center justify-center p-4">
      <div className="w-full max-w-xs">
        <div className="text-center mb-8">
          <h1 className="text-3xl text-white tracking-tight">
            <span className="font-medium">Disc</span><span className="font-bold text-blue-500">SiP</span>
          </h1>
          <p className="text-slate-500 text-sm mt-1">Power Dialer</p>
        </div>

        <div className="bg-[#1e293b] border border-slate-700/60 rounded-2xl p-8 space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-2 uppercase tracking-wider">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              placeholder="voce@empresa.com"
              className="w-full bg-[#111827] border border-slate-600 rounded-xl px-4 py-3 text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-2 uppercase tracking-wider">Senha</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              placeholder="••••••••"
              className="w-full bg-[#111827] border border-slate-600 rounded-xl px-4 py-3 text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          {error && <p className="text-red-400 text-sm text-center">{error}</p>}

          <button
            onClick={handleLogin}
            disabled={loading || !email || !password}
            className="w-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </div>

        <p className="text-center text-slate-500 text-sm mt-6">
          Não tem conta?{' '}
          <Link href="/cadastro" className="text-blue-400 hover:text-blue-300 transition-colors">
            Cadastre-se
          </Link>
        </p>
      </div>
    </div>
  )
}
