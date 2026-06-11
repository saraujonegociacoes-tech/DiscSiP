import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Rotas públicas (não exigem sessão).
const PUBLIC_ROUTES = ['/login', '/cadastro', '/verifique-email']

// Refresca a sessão (cookies) e aplica o gate de acesso:
//  - sem sessão → /login (exceto rotas públicas e /auth/*)
//  - sessão com role 'pending' → /aguardando
//  - sessão aprovada acessando login/cadastro/aguardando → /softphone
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`))

  // Sem sessão: só pode acessar rotas públicas (o matcher já exclui /auth e estáticos)
  if (!user) {
    if (isPublic) return supabaseResponse
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Com sessão: verifica o papel para decidir entre app e "aguardando aprovação"
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const isPending = !profile || profile.role === 'pending'

  if (isPending) {
    // Pendente só pode ficar em /aguardando
    if (pathname !== '/aguardando') {
      const url = request.nextUrl.clone()
      url.pathname = '/aguardando'
      return NextResponse.redirect(url)
    }
    return supabaseResponse
  }

  // Aprovado: não faz sentido ficar em telas de auth/aguardando
  if (isPublic || pathname === '/aguardando') {
    const url = request.nextUrl.clone()
    url.pathname = '/softphone'
    return NextResponse.redirect(url)
  }

  // Área do admin: só admin entra (defesa além do RLS)
  if (pathname.startsWith('/admin') && profile?.role !== 'admin') {
    const url = request.nextUrl.clone()
    url.pathname = '/softphone'
    return NextResponse.redirect(url)
  }

  // Dashboard e gestão de campanhas: só supervisor/manager/admin (agente fica no dialer)
  const managerArea = pathname.startsWith('/dashboard') || pathname.startsWith('/campaigns')
  if (managerArea && !['supervisor', 'manager', 'admin'].includes(profile?.role ?? '')) {
    const url = request.nextUrl.clone()
    url.pathname = '/softphone'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
