'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ShieldCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { AuthShell } from '@/components/auth/AuthShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Mesma regra do /cadastro — se mudar lá, muda aqui.
const MIN_SENHA = 6

type Estado = 'verificando' | 'pronto' | 'invalido' | 'concluido'

export default function RedefinirSenhaPage() {
  const [estado, setEstado] = useState<Estado>('verificando')
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // /auth/recuperar já trocou o code pela sessão de recuperação antes de mandar pra cá.
  // Se não há sessão, a pessoa chegou por link torto/expirado ou digitou a URL na mão —
  // sem isso, o form apareceria e só falharia no submit.
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      setEstado(data.user ? 'pronto' : 'invalido')
    })
  }, [])

  const handleSubmit = async () => {
    if (senha.length < MIN_SENHA) {
      setError(`A senha precisa ter pelo menos ${MIN_SENHA} caracteres.`)
      return
    }
    if (senha !== confirmacao) {
      setError('As senhas não conferem.')
      return
    }

    setSaving(true)
    setError('')

    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password: senha })

    if (error) {
      setSaving(false)
      setError(
        error.message.includes('should be different')
          ? 'A senha nova precisa ser diferente da atual.'
          : error.message
      )
      return
    }

    // Encerra a sessão de recuperação de propósito: o link do email vira uma sessão viva,
    // e deixá-la aberta significaria que quem abriu o email continua logado. Trocar a
    // senha e voltar pro login também confirma pra pessoa que a senha nova funciona.
    await supabase.auth.signOut()
    setSaving(false)
    setEstado('concluido')
  }

  if (estado === 'verificando') {
    return (
      <AuthShell
        title="Redefinir senha"
        description="Verificando o link..."
        heroTitle="Só um instante."
        heroText="Estamos validando o link que você abriu."
      >
        <div className="mt-8 h-28 animate-pulse rounded-2xl border border-border bg-card/60" />
      </AuthShell>
    )
  }

  if (estado === 'invalido') {
    return (
      <AuthShell
        title="Link inválido"
        description="Ele expirou ou já foi usado."
        heroTitle="Esse link não vale mais."
        heroText="Links de redefinição são de uso único e expiram por segurança."
      >
        <div className="mt-8 space-y-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Peça um link novo — leva alguns segundos. Se você abriu o email em outro
            navegador ou celular, tente de novo no mesmo aparelho em que fez o pedido.
          </p>
          <Button asChild className="w-full bg-primary hover:bg-primary/90">
            <Link href="/esqueci-senha">Pedir um link novo</Link>
          </Button>
        </div>
      </AuthShell>
    )
  }

  if (estado === 'concluido') {
    return (
      <AuthShell
        title="Senha alterada"
        description="Já pode entrar com a senha nova."
        heroTitle="Pronto."
        heroText="Sua senha foi atualizada e as outras sessões foram encerradas."
      >
        <div className="mt-8 rounded-2xl border border-border bg-gradient-card p-6 text-center shadow-card">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-primary text-primary-foreground shadow-glow">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Senha redefinida com sucesso.
          </p>
        </div>

        <Button asChild className="mt-6 w-full bg-primary hover:bg-primary/90">
          <Link href="/login">Ir para o login</Link>
        </Button>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Criar senha nova"
      description="Escolha uma senha que você não use em outro lugar."
      heroTitle="Quase lá."
      heroText="Depois de salvar, você entra na plataforma com a senha nova."
    >
      <div className="mt-8 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="senha">Nova senha</Label>
          <Input
            id="senha"
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            placeholder={`mínimo ${MIN_SENHA} caracteres`}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmacao">Confirme a nova senha</Label>
          <Input
            id="confirmacao"
            type="password"
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            placeholder="repita a senha"
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button
          onClick={handleSubmit}
          disabled={saving || !senha || !confirmacao}
          className="w-full bg-primary hover:bg-primary/90"
        >
          {saving ? 'Salvando...' : 'Salvar senha'}
        </Button>
      </div>
    </AuthShell>
  )
}
