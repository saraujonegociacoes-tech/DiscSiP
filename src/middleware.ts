import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Roda em todas as rotas exceto:
     * - _next/static, _next/image (assets do Next)
     * - favicon e arquivos estáticos comuns
     * - /auth/* (route handlers de confirmação de email — devem rodar sem gate)
     * - /helper/* (código público do helper local — index.js/version.json que o
     *   helper baixa para se auto-atualizar; sem gate, senão cai no /login)
     */
    '/((?!_next/static|_next/image|favicon.ico|auth/|helper/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
