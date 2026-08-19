import { type EmailOtpType } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

// Route handler do link de redefinição de senha — irmão de /auth/confirm, mesmo par de
// formatos, mesmo motivo de existir: só um route handler pode ESCREVER o cookie da
// sessão (Server Component não pode), e é a sessão recém-criada que autoriza o
// updateUser({ password }) na tela seguinte.
//
//  - ?code=...                     → template PADRÃO ({{ .ConfirmationURL }}); o GoTrue
//                                    redireciona pra cá com um code PKCE.
//  - ?token_hash=...&type=recovery → template customizado (exige SMTP próprio):
//                                    {{ .SiteURL }}/auth/recuperar?token_hash={{ .TokenHash }}&type=recovery
//
// Como o matcher do middleware exclui /auth/, esta rota e a /auth/redefinir-senha rodam
// sem gate — que é o necessário: quem chega aqui ainda não tem sessão, e quem já tem é
// mandado pra "casa" do papel dele se passar pelo gate.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null

  const supabase = await createServerClient()

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(new URL('/auth/redefinir-senha', request.url))
    }
  } else if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash })
    if (!error) {
      return NextResponse.redirect(new URL('/auth/redefinir-senha', request.url))
    }
  }

  // Link expirado, já usado, ou aberto em outro navegador (o verifier do PKCE fica num
  // cookie do navegador que PEDIU a redefinição). Em todos os casos o conserto é o mesmo:
  // pedir um link novo, com o aviso na tela.
  const url = new URL('/esqueci-senha', request.url)
  url.searchParams.set('erro', 'link')
  return NextResponse.redirect(url)
}
