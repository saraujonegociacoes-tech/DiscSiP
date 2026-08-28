import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Rotas públicas (não exigem sessão). O fluxo de redefinição de senha entra aqui só
// pelo /esqueci-senha: as outras duas etapas (/auth/recuperar e /auth/redefinir-senha)
// vivem sob /auth/, que o matcher já exclui do middleware.
const PUBLIC_ROUTES = ['/login', '/cadastro', '/verifique-email', '/esqueci-senha']

// Tudo que o papel `ceo` alcança. Lista de PERMISSÃO (o oposto dos gates por área abaixo)
// porque `ceo` é uma trava lateral, não um nível: ele só tem o painel executivo e a ajuda.
// Ver docs/projetopainelceo-docs/updates/painel-ceo-sprints.md.
const CEO_ROUTES = ['/ceo', '/ajuda']

// Acesso total (vê tudo). 'tester' entra aqui de propósito — é um admin com seletor de visão.
const managerLevel = (role: string) => role === 'manager' || role === 'admin' || role === 'tester'

// "Casa" de cada papel/departamento: destino pós-login e fallback quando um gate barra. O
// Discador é exclusivo do Comercial, então CS/Negociação/Jurídico caem no próprio painel.
function homeFor(role: string, slug: string | null): string {
  if (managerLevel(role)) return '/softphone'
  if (slug === 'cs') return '/cs'
  if (slug === 'negociacao') return '/negociacao'
  if (slug === 'juridico') return '/minutas'
  return '/softphone' // comercial e sem-departamento
}

// Painéis por vertical: cada um exige o departamento correspondente (acesso total passa por
// tudo). Fecha o acesso por URL — a Sidebar só ESCONDE, isto BARRA de fato.
const VERTICAL_GATES: { prefix: string; slug: string }[] = [
  { prefix: '/leads', slug: 'comercial' },
  { prefix: '/cs', slug: 'cs' },
  { prefix: '/negociacao', slug: 'negociacao' },
  { prefix: '/minutas', slug: 'juridico' },
]

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

  // Toda navegação do app paga DUAS idas ao Supabase aqui: validar o token e ler
  // papel/departamento. Elas eram SEQUENCIAIS — a query do perfil esperava o getUser() só
  // para descobrir o id do usuário —, então cada clique carregava o dobro de latência de
  // rede antes de a página começar a ser montada. Isso valia para o app inteiro, inclusive
  // para os prefetches que o Next dispara ao passar o mouse nos links da sidebar.
  //
  // O id já está no cookie da sessão. Lemos ele LOCALMENTE (getSession não vai à rede) e
  // disparamos as duas chamadas EM PARALELO.
  //
  // ⚠️ getSession() NÃO autoriza nada — o cookie é do cliente e poderia ser forjado. Ele serve
  // só para ADIANTAR qual perfil buscar. Quem decide se existe sessão válida continua sendo o
  // getUser(), validado no servidor; e o perfil adiantado só é aceito se o id bater com o que
  // o getUser() confirmou (ver `profileRes` abaixo). Sem sessão no cookie, cai no caminho
  // sequencial de antes.
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const likelyId = session?.user?.id ?? null

  const [userRes, prefetchedProfile] = await Promise.all([
    supabase.auth.getUser(),
    likelyId
      ? supabase.from('profiles').select('role, departments(slug)').eq('id', likelyId).single()
      : Promise.resolve(null),
  ])

  const user = userRes.data.user

  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`))

  // Redireciona limpando a query (não arrasta ?aba= etc. para a nova rota).
  const redirectTo = (path: string) => {
    const url = request.nextUrl.clone()
    url.pathname = path
    url.search = ''
    return NextResponse.redirect(url)
  }

  // Sem sessão: só pode acessar rotas públicas (o matcher já exclui /auth e estáticos)
  if (!user) {
    return isPublic ? supabaseResponse : redirectTo('/login')
  }

  // Com sessão: papel + slug do departamento numa query só (embed da FK profiles→departments).
  // Usa o resultado adiantado lá de cima SÓ se ele for mesmo do usuário que o getUser()
  // validou. Se o cookie apontava para outro id (ou não havia cookie), busca agora — é o
  // caminho sequencial de antes, mantido como rede de segurança.
  const { data: profile } =
    prefetchedProfile && likelyId === user.id
      ? prefetchedProfile
      : await supabase.from('profiles').select('role, departments(slug)').eq('id', user.id).single()

  const role: string = profile?.role ?? ''
  const dep = (profile as { departments?: { slug?: string } | { slug?: string }[] } | null)?.departments
  const slug: string | null = (Array.isArray(dep) ? dep[0]?.slug : dep?.slug) ?? null

  // Pendente só pode ficar em /aguardando — ou abrir a ajuda (/ajuda), de onde o "Voltar"
  // o traz de volta.
  if (!profile || role === 'pending') {
    return pathname === '/aguardando' || pathname === '/ajuda' ? supabaseResponse : redirectTo('/aguardando')
  }

  // Papel `ceo`: trava LATERAL (só painel executivo + ajuda). Fica ANTES do redirect de
  // isPublic para que o destino pós-login seja /ceo. Ver painel-ceo-sprints.md.
  if (role === 'ceo') {
    const allowed = CEO_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`))
    return allowed ? supabaseResponse : redirectTo('/ceo')
  }

  // Aprovado em tela de auth/aguardando → vai pra "casa" do seu papel/departamento.
  if (isPublic || pathname === '/aguardando') {
    return redirectTo(homeFor(role, slug))
  }

  // Admin e Painel do CEO: só admin (suporte) e tester (visão de teste). O ceo já retornou.
  if ((pathname.startsWith('/admin') || pathname.startsWith('/ceo')) && role !== 'admin' && role !== 'tester') {
    return redirectTo(homeFor(role, slug))
  }

  // Operação COMERCIAL de gestão (Painel da Discadora + Campanhas + Warmup): acesso total ou
  // supervisor do Comercial. Supervisor de outro departamento vê só os painéis da própria equipe.
  const comercialOps =
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/campaigns') ||
    pathname.startsWith('/aquecimento')
  if (comercialOps && !managerLevel(role) && !(role === 'supervisor' && slug === 'comercial')) {
    return redirectTo(homeFor(role, slug))
  }

  // Discador: exclusivo do Comercial. Agente/supervisor de CS/Negociação/Jurídico têm o próprio
  // painel; comercial e sem-departamento entram, e o acesso total também.
  if (
    pathname.startsWith('/softphone') &&
    !managerLevel(role) &&
    ['cs', 'negociacao', 'juridico'].includes(slug ?? '')
  ) {
    return redirectTo(homeFor(role, slug))
  }

  // Painéis por vertical: cada um só para o próprio departamento (ou acesso total).
  const gate = VERTICAL_GATES.find((g) => pathname.startsWith(g.prefix))
  if (gate && !managerLevel(role) && slug !== gate.slug) {
    return redirectTo(homeFor(role, slug))
  }

  // Central de Aparelhos: TRANSVERSAL, não é vertical — por isso fica fora de
  // VERTICAL_GATES e não olha o departamento. Todo departamento tem celular da
  // empresa; quem NÃO entra é o agente (o `ceo` já retornou lá em cima). Escrita é
  // outra camada: supervisor entra em modo leitura e a RLS (inv_can_write) recusa
  // qualquer gravação dele.
  if (pathname.startsWith('/aparelhos') && !managerLevel(role) && role !== 'supervisor') {
    return redirectTo(homeFor(role, slug))
  }

  return supabaseResponse
}
