import { type EmailOtpType } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

// Route handler do link de confirmação de email. Aceita dois formatos:
//  - ?code=...                  → template PADRÃO do Supabase ({{ .ConfirmationURL }});
//                                 o GoTrue redireciona pra cá com um code PKCE.
//  - ?token_hash=...&type=email → template customizado (exige SMTP próprio):
//                                 {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null

  const supabase = await createServerClient()

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Sessão criada. O middleware encaminha pendente → /aguardando.
      return NextResponse.redirect(new URL('/aguardando', request.url))
    }
  } else if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash })
    if (!error) {
      return NextResponse.redirect(new URL('/aguardando', request.url))
    }
  }

  // Token/code inválido ou expirado
  const url = new URL('/login', request.url)
  url.searchParams.set('erro', 'confirmacao')
  return NextResponse.redirect(url)
}
