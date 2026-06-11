'use client'

import { useRouter } from 'next/navigation'
import { signOut } from '@/app/actions/auth'

export default function AguardandoPage() {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-[#0f172a] flex items-center justify-center p-4">
      <div className="w-full max-w-sm text-center">
        <div className="text-3xl mb-4">⏳</div>
        <h1 className="text-white text-xl font-semibold mb-2">Aguardando aprovação</h1>
        <p className="text-slate-400 text-sm leading-relaxed">
          Sua conta foi criada e confirmada. Um administrador precisa aprovar seu acesso e
          atribuir seu papel (e ramal, se for discar) antes de você usar o DiscSiP.
        </p>

        <div className="flex flex-col gap-2 mt-6">
          <button
            onClick={() => router.refresh()}
            className="bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
          >
            Já fui aprovado — verificar
          </button>
          <button
            onClick={() => signOut()}
            className="text-slate-500 hover:text-slate-300 text-xs transition-colors py-1"
          >
            Sair
          </button>
        </div>
      </div>
    </div>
  )
}
