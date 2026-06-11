'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

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
    <div className="min-h-screen bg-[#0f172a] flex items-center justify-center p-4">
      <div className="w-full max-w-xs">
        <div className="text-center mb-8">
          <h1 className="text-3xl text-white tracking-tight">
            <span className="font-medium">Disc</span><span className="font-bold text-blue-500">SiP</span>
          </h1>
          <p className="text-slate-500 text-sm mt-1">Criar conta</p>
        </div>

        <div className="bg-[#1e293b] border border-slate-700/60 rounded-2xl p-8 space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-2 uppercase tracking-wider">Nome</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Seu nome"
              className="w-full bg-[#111827] border border-slate-600 rounded-xl px-4 py-3 text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-2 uppercase tracking-wider">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
              onKeyDown={(e) => e.key === 'Enter' && handleSignUp()}
              placeholder="mínimo 6 caracteres"
              className="w-full bg-[#111827] border border-slate-600 rounded-xl px-4 py-3 text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          {error && <p className="text-red-400 text-sm text-center">{error}</p>}

          <button
            onClick={handleSignUp}
            disabled={loading || !name || !email || !password}
            className="w-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            {loading ? 'Criando...' : 'Criar conta'}
          </button>
        </div>

        <p className="text-center text-slate-500 text-sm mt-6">
          Já tem conta?{' '}
          <Link href="/login" className="text-blue-400 hover:text-blue-300 transition-colors">
            Entrar
          </Link>
        </p>
      </div>
    </div>
  )
}
