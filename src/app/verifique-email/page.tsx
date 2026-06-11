import Link from 'next/link'

export default function VerifiqueEmailPage() {
  return (
    <div className="min-h-screen bg-[#0f172a] flex items-center justify-center p-4">
      <div className="w-full max-w-sm text-center">
        <div className="text-3xl mb-4">📧</div>
        <h1 className="text-white text-xl font-semibold mb-2">Confirme seu email</h1>
        <p className="text-slate-400 text-sm leading-relaxed">
          Enviamos um link de confirmação para o seu email. Clique nele para ativar sua conta.
          Depois, um administrador precisa aprovar seu acesso.
        </p>
        <p className="text-slate-600 text-xs mt-4">
          Não recebeu? Verifique a caixa de spam.
        </p>
        <Link
          href="/login"
          className="inline-block mt-6 text-blue-400 hover:text-blue-300 text-sm transition-colors"
        >
          Voltar ao login
        </Link>
      </div>
    </div>
  )
}
