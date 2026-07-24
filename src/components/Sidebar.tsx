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

type NavItem = { href: string; label: string; icon: LucideIcon; roles: Role[] }

// Itens que não são específicos de uma vertical de negócio — todo mundo aprovado navega
// entre eles conforme o papel, igual sempre foi.
const OPERATION_ITEMS: NavItem[] = [
  { href: '/softphone', label: 'Discador', icon: PhoneCall, roles: ['agent', 'supervisor', 'manager', 'admin'] },
  { href: '/aquecimento', label: 'Warmup Whatsapp', icon: Flame, roles: ['supervisor', 'manager', 'admin'] },
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['supervisor', 'manager', 'admin'] },
  { href: '/campaigns', label: 'Campanhas', icon: Megaphone, roles: ['supervisor', 'manager', 'admin'] },
  { href: '/admin', label: 'Admin', icon: Shield, roles: ['admin'] },
  { href: '/ajuda', label: 'Como usar?', icon: HelpCircle, roles: ['agent', 'supervisor', 'manager', 'admin'] },
]

// Painéis por vertical de negócio (departamento). Comercial, CS e Negociação são
// departamentos SEPARADOS (não subdivisão de um maior) — cada grupo só aparece pra quem é
// do respectivo departamento (department_slug) ou é manager/admin (vê tudo). Ver
// docs/updates/painel-sucesso-cliente-cs.md.
const VERTICAL_GROUPS: { slug: 'comercial' | 'cs' | 'negociacao' | 'ti'; label: string; items: NavItem[] }[] = [
  {
    slug: 'comercial',
    label: 'Comercial',
    items: [{ href: '/leads', label: 'Leads', icon: Target, roles: ['agent', 'supervisor', 'manager', 'admin'] }],
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
}

export function Sidebar() {
  const pathname = usePathname()
  const { state } = useSidebar()
  const collapsed = state === 'collapsed'
  const { agentId, agentName, extension, role, departmentSlug, helperOnline, setProfile } = useSoftphoneStore()

  // Hidrata o perfil da sessão se ainda não estiver no store (páginas que não são
  // o softphone montam a Sidebar sem o perfil carregado)
  useEffect(() => {
    if (agentId) return
    getCurrentProfile().then((p) => {
      if (p) setProfile(p)
    })
  }, [agentId, setProfile])

  // Enquanto o papel não carregou, mostra o mínimo (Discador) pra não piscar links proibidos
  const operationItems = OPERATION_ITEMS.filter((item) => item.roles.includes(role ?? 'agent'))

  // Manager/admin veem as 3 verticais; agente/supervisor só a do próprio departamento.
  // Sem departamento reconhecido (slug null/não mapeado), nenhum grupo de vertical aparece.
  const isManagerLevel = role === 'manager' || role === 'admin'
  const verticalGroups = VERTICAL_GROUPS.filter((group) => isManagerLevel || group.slug === departmentSlug)
    .map((group) => ({ ...group, items: group.items.filter((item) => item.roles.includes(role ?? 'agent')) }))
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
