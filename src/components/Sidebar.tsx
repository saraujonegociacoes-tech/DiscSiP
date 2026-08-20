'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  PhoneCall,
  LayoutDashboard,
  Megaphone,
  Target,
  Shield,
  HelpCircle,
  HeartHandshake,
  Handshake,
  Flame,
  FolderKanban,
  Scale,
  Crown,
  Smartphone,
  type LucideIcon,
} from 'lucide-react'
import { useSoftphoneStore } from '@/store/softphoneStore'
import { getCurrentProfile } from '@/app/actions/auth'
import type { Role } from '@/lib/types/database'
import {
  Sidebar as UiSidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from '@/components/ui/sidebar'
import { BlueDeskLogo, Mark } from '@/components/brand/BlueDeskLogo'
import { cn } from '@/lib/utils'

// Slugs de departamento REAL (para escopar itens de operação); 'ti' é um grupo sem depto.
type DeptSlug = 'comercial' | 'cs' | 'negociacao' | 'juridico'
type GroupSlug = DeptSlug | 'ti'

// `depts` (opcional): além do papel, o item só aparece para quem é daquele(s) departamento(s)
// — ou para quem tem acesso total (manager/admin). Sem `depts`, vale só o filtro de papel.
type NavItem = { href: string; label: string; icon: LucideIcon; roles: Role[]; depts?: DeptSlug[] }

// Itens de operação (topo). Discador, Warmup e Campanhas são da operação COMERCIAL
// (depts: comercial): só a equipe comercial (+ acesso total) os vê — cada supervisor enxerga
// apenas os painéis do próprio departamento. Admin/CEO/Ajuda são transversais por papel.
const OPERATION_ITEMS: NavItem[] = [
  { href: '/softphone', label: 'Discador', icon: PhoneCall, roles: ['agent', 'supervisor', 'manager', 'admin'], depts: ['comercial'] },
  { href: '/aquecimento', label: 'Warmup Whatsapp', icon: Flame, roles: ['supervisor', 'manager', 'admin'], depts: ['comercial'] },
  { href: '/campaigns', label: 'Campanhas', icon: Megaphone, roles: ['supervisor', 'manager', 'admin'], depts: ['comercial'] },
  // Central de Aparelhos: TRANSVERSAL de propósito — sem `depts`, porque todo
  // departamento tem celular da empresa. Fora dela ficam agente (não precisa
  // consultar o parque) e ceo (trava lateral, só /ceo e /ajuda). O supervisor
  // entra em modo leitura; quem cadastra é manager/admin (RLS: inv_can_write).
  { href: '/aparelhos', label: 'Central de Aparelhos', icon: Smartphone, roles: ['supervisor', 'manager', 'admin'] },
  { href: '/admin', label: 'Admin', icon: Shield, roles: ['admin'] },
  // Painel do CEO: papel `ceo` (dono da área) + admin, pra suporte. Único item que o ceo
  // enxerga além da ajuda — o middleware devolve qualquer outra rota pra cá.
  { href: '/ceo', label: 'Painel do CEO', icon: Crown, roles: ['ceo', 'admin'] },
  { href: '/ajuda', label: 'Como usar?', icon: HelpCircle, roles: ['agent', 'supervisor', 'manager', 'admin', 'ceo'] },
]

// Painéis por vertical de negócio (departamento). Cada grupo só aparece pra quem é do
// respectivo departamento (department_slug) ou tem acesso total (manager/admin). O Comercial
// reúne o Painel da Discadora (métricas do discador, supervisor+) e o Painel de Leads.
const VERTICAL_GROUPS: { slug: GroupSlug; label: string; items: NavItem[] }[] = [
  {
    slug: 'comercial',
    label: 'Comercial',
    items: [
      { href: '/dashboard', label: 'Painel da Discadora', icon: LayoutDashboard, roles: ['supervisor', 'manager', 'admin'] },
      { href: '/leads', label: 'Painel de Leads', icon: Target, roles: ['agent', 'supervisor', 'manager', 'admin'] },
    ],
  },
  {
    slug: 'cs',
    label: 'Sucesso do Cliente',
    items: [
      { href: '/cs', label: 'Painel CS', icon: HeartHandshake, roles: ['agent', 'supervisor', 'manager', 'admin'] },
    ],
  },
  {
    slug: 'negociacao',
    label: 'Negociação',
    items: [
      {
        href: '/negociacao',
        label: 'Painel de Negociação',
        icon: Handshake,
        roles: ['agent', 'supervisor', 'manager', 'admin'],
      },
    ],
  },
  {
    slug: 'juridico',
    label: 'Jurídico',
    items: [
      {
        href: '/minutas',
        label: 'Minutas Processuais',
        icon: Scale,
        roles: ['agent', 'supervisor', 'manager', 'admin'],
      },
    ],
  },
  {
    slug: 'ti',
    label: 'Desenvolvimento / TI',
    items: [{ href: '/projects', label: 'Projetos', icon: FolderKanban, roles: ['manager', 'admin'] }],
  },
]

const ROLE_LABEL: Record<string, string> = {
  agent: 'Agente',
  supervisor: 'Supervisor',
  manager: 'Gerente',
  admin: 'Admin',
  ceo: 'CEO',
  tester: 'Tester',
}

export function Sidebar() {
  const pathname = usePathname()
  const { state } = useSidebar()
  const collapsed = state === 'collapsed'
  const { agentId, agentName, extension, role, departmentSlug, viewAsRole, viewAsSlug, helperOnline, setProfile } =
    useSoftphoneStore()

  // Hidrata o perfil da sessão se ainda não estiver no store (páginas que não são
  // o softphone montam a Sidebar sem o perfil carregado)
  useEffect(() => {
    if (agentId) return
    getCurrentProfile().then((p) => {
      if (p) setProfile(p)
    })
  }, [agentId, setProfile])

  // Papel/departamento EFETIVOS. Só o papel real 'tester' pode impersonar: sem seleção age
  // como admin (acesso total); com seleção, navega exatamente como o papel/depto escolhido.
  // Para todos os outros papéis, efetivo = real.
  const isTester = role === 'tester'
  const effRole: Role = isTester ? (viewAsRole ?? 'admin') : (role ?? 'agent')
  const effSlug: string | null = isTester ? (viewAsRole ? viewAsSlug : departmentSlug) : departmentSlug
  const fullAccess = effRole === 'manager' || effRole === 'admin'

  // Item com `depts` só aparece pra acesso total, pra quem é de um dos deptos, ou quando o
  // depto é desconhecido (null) — fallback pra não travar um agente sem departamento.
  const deptOk = (item: NavItem) =>
    !item.depts || fullAccess || effSlug === null || item.depts.includes(effSlug as DeptSlug)
  const operationItems = OPERATION_ITEMS.filter((item) => item.roles.includes(effRole) && deptOk(item))

  // Acesso total vê todas as verticais; os demais só a do próprio departamento.
  const verticalGroups = VERTICAL_GROUPS.filter((group) => fullAccess || group.slug === effSlug)
    .map((group) => ({ ...group, items: group.items.filter((item) => item.roles.includes(effRole)) }))
    .filter((group) => group.items.length > 0)

  const initials = (agentName ?? '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <UiSidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border px-3 py-4">
        {collapsed ? <Mark className="mx-auto" /> : <BlueDeskLogo />}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          {!collapsed && <SidebarGroupLabel>Operação</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {operationItems.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                      <Link href={item.href} className="flex items-center gap-3">
                        <item.icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {verticalGroups.map((group) => (
          <SidebarGroup key={group.slug}>
            {!collapsed && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                        <Link href={item.href} className="flex items-center gap-3">
                          <item.icon className="h-4 w-4" />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        {agentName ? (
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-glow text-xs font-semibold text-primary-foreground">
              {initials}
              <span
                className={cn(
                  'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-sidebar',
                  helperOnline ? 'bg-success' : 'bg-muted-foreground'
                )}
                title={helperOnline ? 'Helper online' : 'Helper offline'}
              />
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">{agentName}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {(role && ROLE_LABEL[role]) ?? ''}
                  {extension ? `${role && ROLE_LABEL[role] ? ' · ' : ''}Ramal ${extension}` : ''}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </SidebarFooter>
    </UiSidebar>
  )
}
