import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Rotas públicas (não exigem sessão).
const PUBLIC_ROUTES = ['/login', '/cadastro', '/verifique-email']

// Tudo que o papel `ceo` alcança. Lista de PERMISSÃO (o oposto dos gates por área abaixo)
// porque `ceo` é uma trava lateral, não um nível: ele só tem o painel executivo e a ajuda.
// Ver docs/projetopainelceo-docs/updates/painel-ceo-sprints.md.
const CEO_ROUTES = ['/ceo', '/ajuda']

// Refresca a sessão (cookies) e aplica o gate de acesso:
//  - sem sessão → /login (exceto rotas públicas e /auth/*)
//  - sessão com role 'pending' → /aguardando
//  - sessão com role 'ceo' → só CEO_ROUTES; qualquer outra rota → /ceo
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
    // Pendente só pode ficar em /aguardando — ou abrir a ajuda (/ajuda), de onde
    // o botão "Voltar" o traz de volta para /aguardando.
    if (pathname !== '/aguardando' && pathname !== '/ajuda') {
      const url = request.nextUrl.clone()
      url.pathname = '/aguardando'
      return NextResponse.redirect(url)
    }
    return supabaseResponse
  }

  // Papel `ceo`: trava LATERAL, não um nível acima de admin (ver
  // docs/projetopainelceo-docs/updates/painel-ceo-sprints.md). Ele não opera o discador
  // nem gere usuários — só o painel executivo e a ajuda. Por isso este bloco é o inverso
  // dos gates abaixo: em vez de listar quem entra numa área, lista o que o ceo alcança, e
  // manda todo o resto pra /ceo (inclusive `/`, que redireciona pro softphone, e /login).
  // Fica ANTES do redirect de isPublic justamente pra que o destino pós-login seja /ceo.
  // Com NEXT_PUBLIC_CEO_ENABLED desligada ele cai no "Em breve" da própria /ceo.
  if (profile?.role === 'ceo') {
    const allowed = CEO_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`))
    if (!allowed) {
      const url = request.nextUrl.clone()
      url.pathname = '/ceo'
      url.search = ''
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

  // Painel do CEO: quem é `ceo` já retornou no bloco acima, então aqui só sobra o resto —
  // e só admin passa (suporte/depuração). Espelha o gate de /admin logo acima.
  if (pathname.startsWith('/ceo') && profile?.role !== 'admin') {
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

  // Aquecimento WhatsApp: módulo sensível (risco de bloqueio de conta/BM) — só
  // supervisor/manager/admin (defesa além do RLS e da navegação). Agente não entra.
  if (pathname.startsWith('/aquecimento') && !['supervisor', 'manager', 'admin'].includes(profile?.role ?? '')) {
    const url = request.nextUrl.clone()
    url.pathname = '/softphone'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
